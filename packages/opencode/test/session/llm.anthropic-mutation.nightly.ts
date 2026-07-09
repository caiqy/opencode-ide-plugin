import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import path from "path"
import { LLM } from "../../src/session/llm"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ModelsDev } from "../../src/provider/models"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"
import { createEventResponse } from "../fixture/sse"
import type { Agent } from "../../src/agent/agent"
import type { MessageV2 } from "../../src/session/message-v2"
import { SessionID, MessageID } from "../../src/session/schema"

const ModelID = ModelV2.ID
const ProviderID = ProviderV2.ID

type Capture = {
  url: URL
  headers: Headers
  body: Record<string, unknown>
}

const state = {
  server: null as ReturnType<typeof Bun.serve> | null,
  queue: [] as Array<{ path: string; response: Response; resolve: (value: Capture) => void }>,
}

function deferred<T>() {
  const result = {} as { promise: Promise<T>; resolve: (value: T) => void }
  result.promise = new Promise((resolve) => {
    result.resolve = resolve
  })
  return result
}

function waitRequest(pathname: string, response: Response) {
  const pending = deferred<Capture>()
  state.queue.push({ path: pathname, response, resolve: pending.resolve })
  return pending.promise
}

async function loadFixture(providerID: string, modelID: string) {
  const fixturePath = path.join(import.meta.dir, "../tool/fixtures/models-api.json")
  const data = await Filesystem.readJson<Record<string, ModelsDev.Provider>>(fixturePath)
  const provider = data[providerID]
  if (!provider) throw new Error(`Missing provider in fixture: ${providerID}`)
  const model = provider.models[modelID]
  if (!model) throw new Error(`Missing model in fixture: ${modelID}`)
  return { provider, model }
}

function base() {
  return [
    {
      type: "message_start",
      message: {
        id: "msg-mutation",
        model: "claude-3-5-sonnet-20241022",
        usage: {
          input_tokens: 3,
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
        },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: "A" },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "content_block_start",
      index: 1,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 1,
      delta: { type: "text_delta", text: "B" },
    },
    { type: "content_block_stop", index: 1 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: {
        input_tokens: 3,
        output_tokens: 2,
        cache_creation_input_tokens: null,
        cache_read_input_tokens: null,
      },
    },
    { type: "message_stop" },
  ]
}

const rules = ["drop-content_block.text", "drop-message-delta.stop_reason"] as const

function mutate(chunks: Array<Record<string, unknown>>, rule: (typeof rules)[number]) {
  const out = chunks.map((x) => structuredClone(x))
  const start = out.find((x) => x.type === "content_block_start" && x.index === 0)
  const msg = out.find((x) => x.type === "message_delta")

  if (rule === "drop-content_block.text") {
    if (start && typeof start.content_block === "object" && start.content_block) {
      delete (start.content_block as Record<string, unknown>).text
    }
    return out
  }

  if (rule === "drop-message-delta.stop_reason") {
    if (msg && typeof msg.delta === "object" && msg.delta) {
      delete (msg.delta as Record<string, unknown>).stop_reason
    }
    return out
  }

  return out
}

function countTypeErr(part: unknown) {
  if (!part || typeof part !== "object") return 0
  const rec = part as Record<string, unknown>
  if (rec.type !== "error") return 0
  const err = rec.error
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  return msg.includes("AI_TypeValidationError") ? 1 : 0
}

async function run(rule: (typeof rules)[number]) {
  const server = state.server
  if (!server) throw new Error("Server not initialized")

  const providerID = "anthropic"
  const modelID = "claude-3-5-sonnet-20241022"
  const fixture = await loadFixture(providerID, modelID)
  const chunks = mutate(base() as Array<Record<string, unknown>>, rule)
  const request = waitRequest(
    "/messages",
    createEventResponse(
      chunks.map((chunk) => ({
        event: String(chunk.type ?? "message"),
        data: chunk,
      })),
    ),
  )

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
          enabled_providers: [providerID],
          provider: {
            [providerID]: {
              options: {
                apiKey: "test-anthropic-key",
                baseURL: `${server.url.origin}/v1`,
              },
            },
          },
        }),
      )
    },
  })

  return await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const resolved = await Provider.getModel(ProviderID.make(providerID), ModelID.make(fixture.model.id))
      const sessionID = SessionID.make(`session-mutation-${rule}`)
      const agent = {
        name: "test",
        mode: "primary",
        options: {},
        permission: [{ permission: "*", pattern: "*", action: "allow" }],
        temperature: 0.4,
        topP: 0.9,
      } satisfies Agent.Info

      const user = {
        id: MessageID.make(`msg-mutation-${rule}`),
        sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: agent.name,
        model: { providerID: ProviderID.make(providerID), modelID: resolved.id },
      } satisfies MessageV2.User

      const stream = await LLM.stream({
        user,
        sessionID,
        model: resolved,
        agent,
        system: ["You are a helpful assistant."],
        abort: new AbortController().signal,
        messages: [{ role: "user", content: "Hello" }],
        tools: {},
      })

      let done = false
      let text = ""
      let typeErrs = 0
      let thrown = ""

      try {
        for await (const part of stream.fullStream) {
          typeErrs += countTypeErr(part)
          if (!part || typeof part !== "object") continue
          const rec = part as Record<string, unknown>
          const t = rec.type
          if (t === "text-delta" && typeof rec.text === "string") text += rec.text
        }
        done = true
      } catch (err) {
        thrown = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
        if (thrown.includes("AI_TypeValidationError")) typeErrs += 1
      }

      const capture = await request
      expect(capture.url.pathname.endsWith("/messages")).toBe(true)
      return { done, text, typeErrs, thrown }
    },
  })
}

beforeAll(() => {
  state.server = Bun.serve({
    port: 0,
    async fetch(req) {
      const next = state.queue.shift()
      if (!next) return new Response("unexpected request", { status: 500 })

      const url = new URL(req.url)
      const body = (await req.json()) as Record<string, unknown>
      next.resolve({ url, headers: req.headers, body })

      if (!url.pathname.endsWith(next.path)) return new Response("not found", { status: 404 })
      return next.response
    },
  })
})

beforeEach(() => {
  state.queue.length = 0
})

afterAll(() => {
  state.server?.stop()
})

describe("session.llm.anthropic.mutation", () => {
  for (const rule of rules) {
    test(`@mutation @slow ${rule}`, async () => {
      const out = await run(rule)
      expect(out.typeErrs).toBe(0)
      expect(out.thrown).toBe("")
      expect(out.done).toBe(true)
      expect(out.text).toBe("AB")
    })
  }
})
