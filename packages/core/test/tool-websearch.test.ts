import { beforeEach, describe, expect, test } from "bun:test"
import { DateTime, Effect, Layer, Schema, Stream } from "effect"
import { LLM, LLMClient, LLMEvent, LLMResponse } from "@opencode-ai/llm"
import { responses } from "@opencode-ai/llm/providers/openai"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { LayerNodePlatform } from "@opencode-ai/core/effect/app-node-platform"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionV2 } from "@opencode-ai/core/session"
import { ProjectV2 } from "@opencode-ai/core/project"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { WebSearchTool } from "@opencode-ai/core/tool/websearch"
import { ToolOutputStore } from "@opencode-ai/core/tool-output-store"
import { Config } from "@opencode-ai/core/config"
import { SessionRunnerModel } from "@opencode-ai/core/session/runner/model"
import { testEffect } from "./lib/effect"
import { toolIdentity, executeTool, settleTool, toolDefinitions } from "./lib/tool"

const sessionID = SessionV2.ID.make("ses_websearch_test")
const payload = (text: string) =>
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: { content: [{ type: "text", text }] },
  })

describe("WebSearchTool provider selection", () => {
  test("accepts an explicit alpha-search mode", () => {
    const info = Schema.decodeUnknownSync(Config.Info)({
      websearch: { mode: "alpha-search", models: ["openai/gpt-5"] },
    })
    expect(info.websearch?.mode).toBe("alpha-search")
  })

  test("builds an OpenAI alpha search request", () => {
    expect(
      WebSearchTool.buildAlphaSearchRequest({
        id: sessionID,
        model: "gpt-5",
        query: "latest OpenAI news",
      }),
    ).toMatchObject({
      id: sessionID,
      model: "gpt-5",
      commands: { search_query: [{ q: "latest OpenAI news" }] },
      settings: { allowed_callers: ["direct"], external_web_access: true },
    })
  })

  test("parses the official alpha search response shape", async () => {
    const parsed = await Effect.runPromise(
      WebSearchTool.parseAlphaSearchResponse({
        encrypted_output: "opaque-token",
        output: "search result",
        results: [{ type: "text_result", ref_id: "turn0search0", url: "https://example.com/result" }],
      }),
    )
    expect(parsed.output).toBe("search result")
    expect(parsed.results?.[0]).toMatchObject({ url: "https://example.com/result" })
  })

  test("prefers the active provider and keeps configured fallback order", () => {
    expect(WebSearchTool.prioritizeNativeSearchModels(["xai/grok", "openai/gpt-5", "anthropic/claude"], "openai")).toEqual([
      "openai/gpt-5",
      "xai/grok",
      "anthropic/claude",
    ])
  })

  test("projects native identity and citations into model text", () => {
    expect(
      WebSearchTool.nativeSearchOutput({
        provider: "openai",
        model: "openai/gpt-5",
        text: "results",
        citations: [{ title: "Source", url: "https://example.com" }],
      }),
    ).toBe("results\n\nSources:\n- [Source](https://example.com)\n\nSearch model: openai/gpt-5")
  })

  test("removes Alpha Search private citation markers", () => {
    expect(
      WebSearchTool.nativeSearchOutput({
        provider: "openai",
        model: "openai/gpt-5",
        text: "Answer\uE200cite\uE202turn0news12\uE201 [wordlim: 100] continued",
      }),
    ).toContain("Answer continued")
  })

  test("falls back after a native provider failure", async () => {
    const result = await Effect.runPromise(
      WebSearchTool.executeNativeSearch(["openai/gpt-5", "anthropic/claude"], "openai", (model) =>
        model.startsWith("openai") ? Effect.fail(new Error("down")) : Effect.succeed("ok"),
      ),
    )
    expect(result).toEqual({ model: "anthropic/claude", result: "ok" })
  })

  test("rejects out-of-range numeric controls", () => {
    const decode = Schema.decodeUnknownSync(WebSearchTool.Input)
    expect(() => decode({ query: "x", numResults: 0 })).toThrow()
    expect(() => decode({ query: "x", numResults: WebSearchTool.MAX_NUM_RESULTS + 1 })).toThrow()
    expect(() => decode({ query: "x", contextMaxCharacters: WebSearchTool.MAX_CONTEXT_CHARACTERS + 1 })).toThrow()
  })
  test("selects a stable provider per session", () => {
    expect(WebSearchTool.selectProvider(sessionID)).toBe(WebSearchTool.selectProvider(sessionID))
  })

  test("supports an explicit operational override", () => {
    expect(WebSearchTool.selectProvider(sessionID, { enableExa: false, enableParallel: false }, "parallel")).toBe(
      "parallel",
    )
    expect(WebSearchTool.selectProvider(sessionID, { enableExa: false, enableParallel: false }, "exa")).toBe("exa")
  })

  test("prefers Parallel when both explicit flags are enabled", () => {
    expect(WebSearchTool.selectProvider(sessionID, { enableExa: true, enableParallel: true })).toBe("parallel")
  })

  test("prefers Exa when only its explicit flag is enabled", () => {
    expect(WebSearchTool.selectProvider(sessionID, { enableExa: true, enableParallel: false })).toBe("exa")
  })
})

describe("WebSearchTool MCP response parser", () => {
  test("parses plain JSON-RPC responses", async () => {
    expect(await Effect.runPromise(WebSearchTool.parseResponse(payload("search results")))).toBe("search results")
  })

  test("parses SSE JSON-RPC responses and ignores non-JSON frames", async () => {
    expect(
      await Effect.runPromise(
        WebSearchTool.parseResponse(`data: [DONE]\nevent: message\ndata: ${payload("search results")}\n\n`),
      ),
    ).toBe("search results")
  })
})

interface Request {
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: unknown
}

const requests: Request[] = []
const assertions: PermissionV2.AssertInput[] = []
let responseBody = payload("search results")
let makeResponse = () => new Response(responseBody, { status: 200 })
let config: WebSearchTool.Config = { enableExa: false, enableParallel: false }
let nativeModels: string[] = []
const searchModel = responses("gpt-5")
const nativeResponse = LLMResponse.fromEvents([
  LLMEvent.textStart({ id: "search-text" }),
  LLMEvent.textDelta({ id: "search-text", text: "native results" }),
  LLMEvent.textEnd({ id: "search-text" }),
  LLMEvent.finish({ reason: "stop" }),
])!

beforeEach(() => {
  responseBody = payload("search results")
  makeResponse = () => new Response(responseBody, { status: 200 })
  nativeModels = []
})

const http = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.sync(() => {
      if (request.body._tag !== "Uint8Array") throw new Error(`Unexpected request body: ${request.body._tag}`)
      requests.push({
        url: request.url,
        headers: request.headers,
        body: JSON.parse(new TextDecoder().decode(request.body.body)),
      })
      return HttpClientResponse.fromWeb(request, makeResponse())
    }),
  ),
)
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) => Effect.sync(() => assertions.push(input)),
     setApproval: () => Effect.die("unused"),
     ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const websearchConfig = Layer.succeed(
  WebSearchTool.ConfigService,
  WebSearchTool.ConfigService.of({
    get provider() {
      return config.provider
    },
    get enableExa() {
      return config.enableExa
    },
    get enableParallel() {
      return config.enableParallel
    },
    get exaApiKey() {
      return config.exaApiKey
    },
    get parallelApiKey() {
      return config.parallelApiKey
    },
  }),
)
const configLayer = Layer.succeed(
  Config.Service,
  Config.Service.of({
    entries: () =>
      Effect.succeed(
        nativeModels.length === 0
          ? []
          : [new Config.Document({ type: "document", info: new Config.Info({ websearch: { models: nativeModels } }) })],
      ),
  }),
)
const modelLayer = Layer.succeed(
  SessionRunnerModel.Service,
  SessionRunnerModel.Service.of({
    resolve: () => Effect.succeed(searchModel),
    resolveReference: () => Effect.succeed(searchModel),
  }),
)
const llm = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die("unused"),
    stream: () => Stream.die("unused"),
    generate: () => Effect.succeed(nativeResponse),
  }),
)
const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([
      ToolRegistry.node,
      ToolRegistry.toolsNode,
      WebSearchTool.configNode,
      WebSearchTool.node,
      LayerNodePlatform.llmClient,
    ]),
    [
      [PermissionV2.node, permission],
      [LayerNodePlatform.httpClient, http],
      [LayerNodePlatform.llmClient, llm],
      [WebSearchTool.configNode, websearchConfig],
      [Config.node, configLayer],
      [SessionRunnerModel.node, modelLayer],
      [ToolOutputStore.node, ToolOutputStore.nodeWithoutConfig],
    ],
  ),
)

describe("WebSearchTool registration", () => {
  it.effect("registers websearch, asserts query permission, and calls Exa", () =>
    Effect.gen(function* () {
      requests.length = 0
      assertions.length = 0
      responseBody = payload("exa results")
      config = { provider: "exa", enableExa: false, enableParallel: false }
      const registry = yield* ToolRegistry.Service

      expect((yield* toolDefinitions(registry)).map((tool) => tool.name)).toEqual(["websearch"])
      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: {
            type: "tool-call",
            id: "call-exa",
            name: "websearch",
            input: {
              query: "effect typescript",
              numResults: 3,
              livecrawl: "preferred",
              type: "fast",
              contextMaxCharacters: 2500,
            },
          },
        }),
      ).toEqual({ type: "text", value: "exa results" })
      expect(assertions).toMatchObject([
        {
          sessionID,
          action: "websearch",
          resources: ["effect typescript"],
          save: ["*"],
          metadata: {
            query: "effect typescript",
            numResults: 3,
            livecrawl: "preferred",
            type: "fast",
            contextMaxCharacters: 2500,
            provider: "exa",
          },
        },
      ])
      expect(requests).toEqual([
        {
          url: WebSearchTool.EXA_URL,
          headers: expect.any(Object),
          body: {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: {
              name: "web_search_exa",
              arguments: {
                query: "effect typescript",
                type: "fast",
                numResults: 3,
                livecrawl: "preferred",
                contextMaxCharacters: 2500,
              },
            },
          },
        },
      ])
    }),
  )

  it.effect("executes configured native search through the local tool", () =>
    Effect.gen(function* () {
      nativeModels = ["openai/gpt-5"]
      const registry = yield* ToolRegistry.Service
      const client = yield* LLMClient.Service
      expect(yield* client.generate(LLM.request({ model: searchModel, prompt: "probe" }))).toBe(nativeResponse)
      const session = SessionV2.Info.make({
        id: sessionID,
        projectID: ProjectV2.ID.global,
        title: "native search",
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: DateTime.makeUnsafe(0), updated: DateTime.makeUnsafe(0) },
        location: { directory: AbsolutePath.make("/project") },
      })
      const settled = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        model: searchModel,
        session,
        call: { type: "tool-call", id: "call-native", name: "websearch", input: { query: "native" } },
      })
      expect(settled).toMatchObject({ result: { type: "text", value: expect.stringContaining("native") } })
    }),
  )

  it.effect("calls Parallel with session ID and keeps bearer credentials out of output", () =>
    Effect.gen(function* () {
      requests.length = 0
      assertions.length = 0
      responseBody = payload("parallel results")
      config = { provider: "parallel", enableExa: false, enableParallel: false, parallelApiKey: "parallel-secret" }
      const registry = yield* ToolRegistry.Service

      const settled = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-parallel", name: "websearch", input: { query: "effect layers" } },
      })

      expect(requests[0]).toMatchObject({
        url: WebSearchTool.PARALLEL_URL,
        headers: { authorization: "Bearer parallel-secret" },
        body: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: "web_search",
            arguments: { objective: "effect layers", search_queries: ["effect layers"], session_id: sessionID },
          },
        },
      })
      expect(requests[0]?.body).not.toHaveProperty("params.arguments.model_name")
      expect(settled).toEqual({
        result: { type: "text", value: "parallel results" },
        output: {
          structured: { provider: "parallel", text: "parallel results" },
          content: [{ type: "text", text: "parallel results" }],
        },
      })
      expect(JSON.stringify(settled)).not.toContain("parallel-secret")
    }),
  )

  it.effect("keeps an Exa credential in the transport URL and out of model output", () =>
    Effect.gen(function* () {
      requests.length = 0
      assertions.length = 0
      responseBody = payload("credentialed exa results")
      config = { provider: "exa", enableExa: false, enableParallel: false, exaApiKey: "exa secret" }
      const registry = yield* ToolRegistry.Service

      const settled = yield* settleTool(registry, {
        sessionID,
        ...toolIdentity,
        call: { type: "tool-call", id: "call-exa-key", name: "websearch", input: { query: "effect schema" } },
      })

      expect(requests[0]?.url).toBe(`${WebSearchTool.EXA_URL}?exaApiKey=exa+secret`)
      expect(JSON.stringify(settled)).not.toContain("exa secret")
    }),
  )

  it.effect("returns the legacy no-results fallback as concise model text", () =>
    Effect.gen(function* () {
      requests.length = 0
      assertions.length = 0
      responseBody = ""
      config = { provider: "exa", enableExa: false, enableParallel: false }
      const registry = yield* ToolRegistry.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-empty", name: "websearch", input: { query: "nothing" } },
        }),
      ).toEqual({ type: "text", value: WebSearchTool.NO_RESULTS })
    }),
  )

  it.effect("rejects oversized MCP response bodies", () =>
    Effect.gen(function* () {
      requests.length = 0
      assertions.length = 0
      let chunksRead = 0
      let cancelled = false
      makeResponse = () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              chunksRead++
              if (chunksRead === 10) throw new Error("response was not stopped at the byte limit")
              controller.enqueue(new Uint8Array(64 * 1024))
            },
            cancel() {
              cancelled = true
            },
          }),
          { status: 200 },
        )
      config = { provider: "exa", enableExa: false, enableParallel: false }
      const registry = yield* ToolRegistry.Service

      expect(
        yield* executeTool(registry, {
          sessionID,
          ...toolIdentity,
          call: { type: "tool-call", id: "call-large-response", name: "websearch", input: { query: "too much" } },
        }),
      ).toEqual({ type: "error", value: "Unable to search the web for too much" })
      expect(chunksRead).toBeLessThan(10)
      expect(cancelled).toBe(true)
    }),
  )
})
