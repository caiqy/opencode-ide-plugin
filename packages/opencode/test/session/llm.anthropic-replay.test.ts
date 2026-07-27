import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { afterAll, beforeAll, beforeEach, describe, expect } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import path from "path"
import { tool, type ToolSet } from "ai"
import { Cause, Effect, Exit, Layer, Stream } from "effect"
import z from "zod"
import { LLM } from "../../src/session/llm"
import { Provider } from "../../src/provider/provider"
import { createEventResponse } from "../fixture/sse"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Plugin } from "@/plugin"
import { testEffect } from "../lib/effect"
import type { Agent } from "../../src/agent/agent"
import type { MessageV2 } from "../../src/session/message-v2"
import { SessionID, MessageID } from "../../src/session/schema"

const ProviderID = ProviderV2.ID
const modelID = ModelV2.ID.make("claude-sonnet-4-5")
const plugin = Layer.mock(Plugin.Service)({
  init: () => Effect.void,
  list: () => Effect.succeed([]),
  trigger: <Name extends string, Input, Output>(_name: Name, _input: Input, output: Output) => Effect.succeed(output),
})
const it = testEffect(
  AppNodeBuilder.build(LayerNode.group([LLM.node, Provider.node]), [
    [RuntimeFlags.node, RuntimeFlags.layer()],
    [Plugin.node, plugin],
  ]),
)

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

async function loadChunks(name: string) {
  const file = path.join(import.meta.dir, `../fixtures/anthropic-sse/${name}.jsonl`)
  const text = await Bun.file(file).text()
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as unknown)
    .map((chunk) => {
      if (!chunk || typeof chunk !== "object") return chunk
      const rec = chunk as Record<string, unknown>
      if (typeof rec.type !== "string") return chunk
      return {
        event: rec.type,
        data: chunk,
      }
    })
}

function config(): Partial<ConfigV1.Info> {
  const server = state.server
  if (!server) throw new Error("Server not initialized")
  return {
    enabled_providers: ["anthropic"],
    provider: {
      anthropic: {
        npm: "@ai-sdk/anthropic",
        api: "https://api.anthropic.com/v1",
        models: {
          [modelID]: {
            name: "Claude Sonnet 4.5",
            temperature: true,
            tool_call: true,
            limit: { context: 1_000_000, output: 64_000 },
            modalities: { input: ["text"], output: ["text"] },
          },
        },
        options: {
          apiKey: "test-anthropic-key",
          baseURL: `${server.url.origin}/v1`,
        },
      },
    },
  }
}

function run(name: string, tools: ToolSet = {}) {
  return Effect.gen(function* () {
    const providerID = ProviderID.make("anthropic")
    const chunks = yield* Effect.promise(() => loadChunks(name))
    const request = waitRequest("/messages", createEventResponse(chunks))
    const provider = yield* Provider.Service
    const llm = yield* LLM.Service
    const resolved = yield* provider.getModel(providerID, modelID)
    const sessionID = SessionID.make(`session-${name}`)
    const agent = {
      name: "test",
      mode: "primary",
      options: {},
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
      temperature: 0.4,
      topP: 0.9,
    } satisfies Agent.Info

    const result = yield* llm
      .stream({
        user: {
          id: MessageID.make(`msg-${name}`),
          sessionID,
          role: "user",
          time: { created: Date.now() },
          agent: agent.name,
          model: { providerID, modelID: resolved.id },
        } satisfies MessageV2.User,
        sessionID,
        model: resolved,
        agent,
        system: ["You are a helpful assistant."],
        messages: [{ role: "user", content: "Hello" }],
        tools,
      })
      .pipe(Stream.runCollect, Effect.exit)
    const capture = yield* Effect.promise(() => request)
    expect(capture.url.pathname.endsWith("/messages")).toBe(true)

    const events = Exit.isSuccess(result) ? Array.from(result.value) : []
    const thrown = Exit.isFailure(result)
      ? Cause.prettyErrors(result.cause)
          .map((error) => `${error.name}: ${error.message}`)
          .join("\n")
      : ""
    const calls = events.filter((event) => event.type === "tool-call")
    return {
      done: Exit.isSuccess(result),
      text: events
        .filter((event) => event.type === "text-delta")
        .map((event) => event.text)
        .join(""),
      calls: calls.length,
      input: calls[0]?.input,
      typeErrs: thrown.includes("AI_TypeValidationError") ? 1 : 0,
      thrown,
    }
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

describe("session.llm.anthropic.replay", () => {
  it.instance(
    "normal replay should finish with text output",
    () =>
      Effect.gen(function* () {
        const out = yield* run("normal")
        expect(out.typeErrs).toBe(0)
        expect(out.thrown).toBe("")
        expect(out.done).toBe(true)
        expect(out.text).toBe("Hello")
      }),
    { config },
  )

  it.instance(
    "missing-text replay should not throw AI_TypeValidationError",
    () =>
      Effect.gen(function* () {
        const out = yield* run("missing-text")
        expect(out.thrown).toBe("")
        expect(out.typeErrs).toBe(0)
        expect(out.done).toBe(true)
        expect(out.text.includes("你好")).toBe(true)
      }),
    { config },
  )

  it.instance(
    "tool-mixed replay should preserve tool calls",
    () =>
      Effect.gen(function* () {
        const out = yield* run("tool-mixed", {
          question: tool({
            description: "answer question",
            inputSchema: z.object({ q: z.string() }),
            execute: async () => "ok",
          }),
        })
        expect(out.typeErrs).toBe(0)
        expect(out.thrown).toBe("")
        expect(out.done).toBe(true)
        expect(out.calls > 0).toBe(true)
        const q = out.input && typeof out.input === "object" ? (out.input as Record<string, unknown>).q : undefined
        expect(q).toBe("hi")
      }),
    { config },
  )
})
