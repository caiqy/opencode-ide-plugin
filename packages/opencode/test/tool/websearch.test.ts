import { describe, expect, test } from "bun:test"
import { Cause, Effect, Schema } from "effect"
import { parseResponse } from "../../src/tool/mcp-websearch"
import * as WebSearch from "../../src/tool/websearch"

import { webSearchEnabled } from "../../src/tool/registry"
import { it } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { ProviderTest } from "../fake/provider"
import { MockLanguageModelV3 } from "ai/test"
import type { LanguageModelV3GenerateResult } from "@ai-sdk/provider"

const SESSION_ID = "ses_0196aabbccddeeff001122334455"

describe("websearch provider", () => {
  test("accepts an explicit alpha-search mode", () => {
    const config = Schema.decodeUnknownSync(ConfigV1.Info)({
      websearch: { mode: "alpha-search", models: ["openai/gpt-5.6"] },
    })
    expect(config.websearch?.mode).toBe("alpha-search")
  })

  test("uses the provider base URL when the model URL is empty", () => {
    expect(
      WebSearch.alphaSearchUrl(
        ProviderTest.model({ api: { id: "gpt-5.6-luna", url: "", npm: "@ai-sdk/openai" } }),
        ProviderTest.info({ options: { baseURL: "https://sub.200911.xyz/v1" } }),
      ),
    ).toBe("https://sub.200911.xyz/v1/alpha/search")
  })

  test("prefers the provider base URL over the model URL", () => {
    expect(
      WebSearch.alphaSearchUrl(
        ProviderTest.model({ api: { id: "gpt-5.6-luna", url: "https://api.openai.com/v1", npm: "@ai-sdk/openai" } }),
        ProviderTest.info({ options: { baseURL: "https://sub.200911.xyz/v1" } }),
      ),
    ).toBe("https://sub.200911.xyz/v1/alpha/search")
  })

  test("prefers the configured API key over the provider key", () => {
    expect(
      WebSearch.alphaSearchApiKey(
        ProviderTest.info({ key: "account-key", options: { apiKey: "configured-key" } }),
      ),
    ).toBe("configured-key")
  })

  test("selects a stable provider per session", () => {
    expect(WebSearch.selectWebSearchProvider(SESSION_ID)).toBe(WebSearch.selectWebSearchProvider(SESSION_ID))
  })

  test("supports an operational override", () => {
    const original = process.env.OPENCODE_WEBSEARCH_PROVIDER

    try {
      process.env.OPENCODE_WEBSEARCH_PROVIDER = "parallel"
      expect(WebSearch.selectWebSearchProvider(SESSION_ID)).toBe("parallel")

      process.env.OPENCODE_WEBSEARCH_PROVIDER = "exa"
      expect(WebSearch.selectWebSearchProvider(SESSION_ID)).toBe("exa")
    } finally {
      if (original === undefined) delete process.env.OPENCODE_WEBSEARCH_PROVIDER
      else process.env.OPENCODE_WEBSEARCH_PROVIDER = original
    }
  })

  test("routes to Exa when the Exa flag is enabled", () => {
    expect(WebSearch.selectWebSearchProvider(SESSION_ID, { exa: true, parallel: false })).toBe("exa")
  })

  test("routes to Parallel when the Parallel flag is enabled", () => {
    expect(WebSearch.selectWebSearchProvider(SESSION_ID, { exa: false, parallel: true })).toBe("parallel")
  })

  test("is only enabled for opencode or explicit websearch provider flags", () => {
    expect(webSearchEnabled(ProviderV2.ID.opencode, { exa: false, parallel: false })).toBe(true)
    expect(webSearchEnabled(ProviderV2.ID.openai, { exa: false, parallel: false })).toBe(false)
    expect(webSearchEnabled(ProviderV2.ID.openai, { exa: true, parallel: false })).toBe(true)
    expect(webSearchEnabled(ProviderV2.ID.openai, { exa: false, parallel: true })).toBe(true)
    expect(webSearchEnabled(ProviderV2.ID.anthropic, { exa: false, parallel: false }, true)).toBe(true)
  })

  test("uses branded labels", () => {
    expect(WebSearch.webSearchProviderLabel("parallel")).toBe("Parallel Web Search")
    expect(WebSearch.webSearchProviderLabel("exa")).toBe("Exa Web Search")
    expect(WebSearch.webSearchProviderLabel(undefined)).toBe("Web Search")
  })

  test("uses the provider API model id for Parallel analytics", () => {
    expect(
      WebSearch.webSearchModelName({
        model: {
          id: "claude-opus-4-7",
          api: { id: "claude-opus-4.7" },
        },
      }),
    ).toBe("claude-opus-4.7")
  })

  test("preserves configured native search models", () => {
    const config = Schema.decodeUnknownSync(ConfigV1.Info)({
      websearch: {
        models: ["openai/gpt-5.6", "anthropic/claude-sonnet-4-6", "xai/grok-4.6"],
      },
    })

    expect(config.websearch).toEqual({
      models: ["openai/gpt-5.6", "anthropic/claude-sonnet-4-6", "xai/grok-4.6"],
    })
  })

  test("rejects unsupported native search model references", () => {
    expect(() =>
      Schema.decodeUnknownSync(ConfigV1.Info)({
        websearch: { models: ["google/gemini-3", "openai/"] },
      }),
    ).toThrow()
  })

  test("uses each provider's native web search tool", async () => {
    const nativeSearchTool = (
      WebSearch as unknown as {
        nativeSearchTool: (providerID: string) => Promise<{ type: string; id: string }>
      }
    ).nativeSearchTool

    expect(await nativeSearchTool("openai")).toMatchObject({ type: "provider", id: "openai.web_search" })
    expect(await nativeSearchTool("anthropic")).toMatchObject({
      type: "provider",
      id: "anthropic.web_search_20250305",
    })
    expect(await nativeSearchTool("xai")).toMatchObject({ type: "provider", id: "xai.web_search" })
  })

  test("only accepts official direct provider routes", () => {
    const supported = (
      WebSearch as unknown as {
        supportsNativeSearchModel: (model: ReturnType<typeof ProviderTest.model>) => boolean
      }
    ).supportsNativeSearchModel

    expect(
      supported(
        ProviderTest.model({
          providerID: ProviderV2.ID.openai,
          api: { id: "gpt-5.6", url: "", npm: "@ai-sdk/openai" },
        }),
      ),
    ).toBe(true)
    expect(
      supported(
        ProviderTest.model({
          providerID: ProviderV2.ID.openai,
          api: { id: "gpt-5.6", url: "", npm: "@ai-sdk/openai-compatible" },
        }),
      ),
    ).toBe(false)
  })

  test("projects native search citations into one sources section", () => {
    const output = (
      WebSearch as unknown as {
        nativeSearchOutput: (text: string, sources: readonly unknown[]) => string
      }
    ).nativeSearchOutput

    expect(
      output("Answer", [
        { title: "First", url: "https://first.example" },
        { title: "Second", url: "https://second.example" },
      ]),
    ).toBe("Answer\n\nSources:\n- [First](https://first.example)\n- [Second](https://second.example)")
  })

  test("removes Alpha Search private citation markers", () => {
    const output = (
      WebSearch as unknown as {
        nativeSearchOutput: (text: string, sources: readonly unknown[]) => string
      }
    ).nativeSearchOutput

    expect(output("Answer\uE200cite\uE202turn0news12\uE201 [wordlim: 100] continued", [])).toBe("Answer continued")
  })

  test("rejects out-of-range legacy numeric controls", () => {
    const decode = Schema.decodeUnknownSync(WebSearch.Parameters)
    expect(() => decode({ query: "x", numResults: 0 })).toThrow()
    expect(() => decode({ query: "x", numResults: 21 })).toThrow()
    expect(() => decode({ query: "x", contextMaxCharacters: 0 })).toThrow()
    expect(() => decode({ query: "x", contextMaxCharacters: 50_001 })).toThrow()
  })

  it.effect("forces one provider-native search request with private storage", () =>
    Effect.gen(function* () {
      const response: LanguageModelV3GenerateResult = {
        content: [{ type: "text", text: "answer" }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        warnings: [],
      }
      const language = new MockLanguageModelV3({
        doGenerate: response,
      })
      const run = (
        WebSearch as unknown as {
          runNativeSearchRequest: (input: {
            language: MockLanguageModelV3
            model: ReturnType<typeof ProviderTest.model>
            webSearch: Awaited<ReturnType<typeof WebSearch.nativeSearchTool>>
            query: string
            sessionID: string
            abort: AbortSignal
          }) => Effect.Effect<{ text: string }, unknown>
        }
      ).runNativeSearchRequest

      yield* run({
        language,
        model: ProviderTest.model(),
        webSearch: yield* Effect.promise(() => WebSearch.nativeSearchTool("openai")),
        query: "current news",
        sessionID: "ses_search",
        abort: new AbortController().signal,
      })

      expect(language.doGenerateCalls).toHaveLength(1)
      expect(language.doGenerateCalls[0]).toMatchObject({
        maxOutputTokens: 2048,
        tools: [{ type: "provider", name: "web_search", id: "openai.web_search" }],
        toolChoice: { type: "tool", toolName: "web_search" },
        providerOptions: { openai: { store: false, promptCacheKey: "ses_search" } },
      })
    }),
  )

  it.effect("preserves interruption when the native request is aborted", () =>
    Effect.gen(function* () {
      const abort = new AbortController()
      const language = new MockLanguageModelV3({
        doGenerate: () => {
          abort.abort()
          return Promise.reject(new Error("aborted"))
        },
      })
      const run = (
        WebSearch as unknown as {
          runNativeSearchRequest: (input: {
            language: MockLanguageModelV3
            model: ReturnType<typeof ProviderTest.model>
            webSearch: Awaited<ReturnType<typeof WebSearch.nativeSearchTool>>
            query: string
            sessionID: string
            abort: AbortSignal
          }) => Effect.Effect<unknown, unknown>
        }
      ).runNativeSearchRequest

      const exit = yield* Effect.exit(
        run({
          language,
          model: ProviderTest.model(),
          webSearch: yield* Effect.promise(() => WebSearch.nativeSearchTool("openai")),
          query: "current news",
          sessionID: "ses_search",
          abort: abort.signal,
        }),
      )

      expect(exit._tag).toBe("Failure")
      if (exit._tag === "Failure") expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
    }),
  )

  test("prioritizes the current provider without reordering fallbacks", () => {
    const prioritize = (
      WebSearch as unknown as {
        prioritizeNativeSearchModels: (models: readonly string[], providerID: string) => readonly string[]
      }
    ).prioritizeNativeSearchModels

    expect(prioritize(["openai/gpt-5.6", "xai/grok-4.6", "anthropic/claude-sonnet-4-6"], "anthropic")).toEqual([
      "anthropic/claude-sonnet-4-6",
      "openai/gpt-5.6",
      "xai/grok-4.6",
    ])
  })

  it.effect("falls back to the next native search model", () =>
    Effect.gen(function* () {
      const attempts: string[] = []
      const search = (
        WebSearch as unknown as {
          executeNativeSearch: <A>(
            models: readonly string[],
            providerID: string,
            execute: (model: string) => Effect.Effect<A, Error>,
          ) => Effect.Effect<{ model: string; result: A }, Error>
        }
      ).executeNativeSearch

      const result = yield* search(["openai/gpt-5.6", "anthropic/claude-sonnet-4-6"], "openai", (model) => {
        attempts.push(model)
        return model.startsWith("openai/") ? Effect.fail(new Error("provider unavailable")) : Effect.succeed("ok")
      })

      expect(attempts).toEqual(["openai/gpt-5.6", "anthropic/claude-sonnet-4-6"])
      expect(result).toEqual({ model: "anthropic/claude-sonnet-4-6", result: "ok" })
    }),
  )

  it.effect("falls back after a search route defect", () =>
    Effect.gen(function* () {
      const attempts: string[] = []
      const execute = (
        WebSearch as unknown as {
          executeNativeSearch: <A>(
            models: readonly string[],
            providerID: string,
            execute: (model: string) => Effect.Effect<A>,
          ) => Effect.Effect<{ model: string; result: A }, Error>
        }
      ).executeNativeSearch

      const result = yield* execute(["openai/gpt-5.6", "xai/grok-4.6"], "openai", (model) => {
        attempts.push(model)
        return model.startsWith("openai/") ? Effect.die(new Error("SDK init defect")) : Effect.succeed("ok")
      })

      expect(attempts).toEqual(["openai/gpt-5.6", "xai/grok-4.6"])
      expect(result.model).toBe("xai/grok-4.6")
    }),
  )

  it.effect("does not fall back after cancellation", () =>
    Effect.gen(function* () {
      const attempts: string[] = []
      const abort = new AbortController()
      const execute = (
        WebSearch as unknown as {
          executeNativeSearch: <A>(
            models: readonly string[],
            providerID: string,
            execute: (model: string) => Effect.Effect<A, Error>,
            abort: AbortSignal,
          ) => Effect.Effect<{ model: string; result: A }, Error>
        }
      ).executeNativeSearch

      yield* execute(
        ["openai/gpt-5.6", "xai/grok-4.6"],
        "openai",
        (model) => {
          attempts.push(model)
          abort.abort()
          return Effect.fail(new Error("cancelled"))
        },
        abort.signal,
      ).pipe(Effect.exit)

      expect(attempts).toEqual(["openai/gpt-5.6"])
    }),
  )

  it.effect("redacts native search failures after all routes fail", () =>
    Effect.gen(function* () {
      const execute = (
        WebSearch as unknown as {
          executeNativeSearch: <A, E>(
            models: readonly string[],
            providerID: string,
            execute: (model: string) => Effect.Effect<A, E>,
          ) => Effect.Effect<{ model: string; result: A }, E | Error>
        }
      ).executeNativeSearch

      const error = yield* execute(["openai/gpt-5.6"], "openai", () => Effect.fail(new Error("sk-secret-token"))).pipe(
        Effect.flip,
      )

      expect(error.message).toBe("Native web search unavailable")
    }),
  )
})

describe("websearch MCP response parser", () => {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    result: {
      content: [
        {
          type: "text",
          text: "search results",
        },
      ],
    },
  })

  it.effect("parses plain JSON-RPC responses", () =>
    Effect.gen(function* () {
      const result = yield* parseResponse(payload)
      expect(result).toBe("search results")
    }),
  )

  it.effect("parses SSE JSON-RPC responses", () =>
    Effect.gen(function* () {
      const result = yield* parseResponse(`event: message\ndata: ${payload}\n\n`)
      expect(result).toBe("search results")
    }),
  )

  it.effect("ignores non-JSON SSE data frames", () =>
    Effect.gen(function* () {
      const result = yield* parseResponse(`data: [DONE]\ndata: ${payload}\n\n`)
      expect(result).toBe("search results")
    }),
  )
})
