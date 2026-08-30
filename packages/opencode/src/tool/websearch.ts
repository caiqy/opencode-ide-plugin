import { Cause, Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { generateText, type Tool as AITool } from "ai"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import * as Tool from "./tool"
import * as McpWebSearch from "./mcp-websearch"
import DESCRIPTION from "./websearch.txt"
import { checksum } from "@opencode-ai/core/util/encode"
import { Installation } from "@/installation"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Config } from "@/config/config"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import { ModelV2 } from "@opencode-ai/core/model"
import { PositiveInt } from "@opencode-ai/core/schema"
import { buildAlphaSearchRequest } from "@opencode-ai/core/tool/websearch"

export const Parameters = Schema.Struct({
  query: Schema.String.annotate({ description: "Websearch query" }),
  numResults: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(20))).annotate({
    description: "Number of search results to return (default: 8, maximum: 20)",
  }),
  livecrawl: Schema.optional(Schema.Literals(["fallback", "preferred"])).annotate({
    description:
      "Live crawl mode - 'fallback': use live crawling as backup if cached content unavailable, 'preferred': prioritize live crawling (default: 'fallback')",
  }),
  type: Schema.optional(Schema.Literals(["auto", "fast", "deep"])).annotate({
    description: "Search type - 'auto': balanced search (default), 'fast': quick results, 'deep': comprehensive search",
  }),
  contextMaxCharacters: Schema.optional(PositiveInt.check(Schema.isLessThanOrEqualTo(50_000))).annotate({
    description: "Maximum characters for context string optimized for LLMs (default: 10000, maximum: 50000)",
  }),
})

const WebSearchProviderSchema = Schema.Literals(["exa", "parallel"])
export type WebSearchProvider = Schema.Schema.Type<typeof WebSearchProviderSchema>

export function selectWebSearchProvider(sessionID: string, flags = { exa: false, parallel: false }): WebSearchProvider {
  const override = process.env.OPENCODE_WEBSEARCH_PROVIDER
  if (override === "exa" || override === "parallel") return override
  if (flags.parallel) return "parallel"
  if (flags.exa) return "exa"

  return Number.parseInt(checksum(sessionID) ?? "0", 36) % 2 === 0 ? "exa" : "parallel"
}

export function webSearchProviderLabel(provider: unknown) {
  if (provider === "parallel") return "Parallel Web Search"
  if (provider === "exa") return "Exa Web Search"
  return "Web Search"
}

export function webSearchModelName(extra: Tool.Context["extra"]) {
  const model = extra?.model
  if (!model || typeof model !== "object") return undefined
  const api = "api" in model && model.api && typeof model.api === "object" ? model.api : undefined
  const apiID = api && "id" in api && typeof api.id === "string" ? api.id : undefined
  const id = "id" in model && typeof model.id === "string" ? model.id : undefined
  return (apiID ?? id)?.slice(0, 100)
}

export function prioritizeNativeSearchModels(models: readonly string[], providerID: string) {
  const preferred = models.filter((model) => model.split("/", 1)[0] === providerID)
  return [...preferred, ...models.filter((model) => model.split("/", 1)[0] !== providerID)]
}

export function executeNativeSearch<A>(
  models: readonly string[],
  providerID: string,
  execute: (model: string) => Effect.Effect<A, unknown>,
  abort?: AbortSignal,
) {
  return Effect.firstSuccessOf(
    prioritizeNativeSearchModels(models, providerID).map((model) =>
      Effect.suspend(() => {
        if (abort?.aborted) return Effect.interrupt
        return execute(model).pipe(Effect.map((result) => ({ model, result })))
      }).pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause)
          return Effect.fail(new Error("Native web search route failed"))
        }),
      ),
    ),
  ).pipe(Effect.mapError(() => new Error("Native web search unavailable")))
}

type NativeSearchConfig = {
  websearch?: {
    models: readonly string[]
    mode?: "responses" | "alpha-search"
  }
}

export const DEFAULT_OPENAI_SEARCH_MODEL = "openai/gpt-5.6-luna"

export function nativeSearchModels(config: NativeSearchConfig) {
  return config.websearch?.models ?? [DEFAULT_OPENAI_SEARCH_MODEL]
}

export function nativeSearchMode(config: NativeSearchConfig) {
  return config.websearch?.mode ?? (config.websearch ? "responses" : "alpha-search")
}

const AlphaSearchResponse = Schema.Struct({
  encrypted_output: Schema.optional(Schema.NullOr(Schema.String)),
  output: Schema.String,
  results: Schema.optional(Schema.Array(Schema.Unknown)),
})

export function alphaSearchUrl(model: Provider.Model, provider: Provider.Info) {
  const baseURL = typeof provider.options.baseURL === "string" ? provider.options.baseURL : model.api.url
  return baseURL ? `${baseURL.replace(/\/+$/, "")}/alpha/search` : undefined
}

export function alphaSearchApiKey(provider: Provider.Info) {
  return typeof provider.options.apiKey === "string" ? provider.options.apiKey : provider.key
}

export function nativeSearchTool(providerID: string) {
  if (providerID === "openai")
    return import("@ai-sdk/openai").then(({ openai }) => openai.tools.webSearch() as unknown as AITool)
  if (providerID === "anthropic")
    return import("@ai-sdk/anthropic").then(
      ({ anthropic }) => anthropic.tools.webSearch_20250305() as unknown as AITool,
    )
  if (providerID === "xai") return import("@ai-sdk/xai").then(({ xai }) => xai.tools.webSearch() as unknown as AITool)
  return Promise.reject(new Error(`Native web search is unsupported for ${providerID}`))
}

export function supportsNativeSearchModel(model: Provider.Model) {
  return (
    (model.providerID === "openai" && model.api.npm === "@ai-sdk/openai") ||
    (model.providerID === "anthropic" && model.api.npm === "@ai-sdk/anthropic") ||
    (model.providerID === "xai" && model.api.npm === "@ai-sdk/xai")
  )
}

export function nativeSearchOutput(text: string, sources: readonly unknown[] | undefined) {
  const cleanText = text.replace(/\uE200cite\uE202[^\uE201]*\uE201(?:\s*\[wordlim:\s*\d+\])?/gu, "").trim()
  if (!sources?.length) return cleanText || "No search results found. Please try a different query."
  const links = sources.flatMap((source) => {
    if (!source || typeof source !== "object") return []
    const item = source as { url?: unknown; title?: unknown }
    if (typeof item.url !== "string") return []
    return [`- [${typeof item.title === "string" ? item.title : item.url}](${item.url})`]
  })
  return `${cleanText || "No search results found. Please try a different query."}\n\nSources:\n${links.join("\n")}`
}

export function runNativeSearchRequest(input: {
  language: LanguageModelV3
  model: Provider.Model
  webSearch: AITool
  query: string
  sessionID: string
  abort: AbortSignal
}) {
  return Effect.tryPromise({
    try: () =>
      generateText({
        model: input.language,
        prompt: input.query,
        tools: { web_search: input.webSearch },
        toolChoice: { type: "tool", toolName: "web_search" },
        abortSignal: input.abort,
        maxOutputTokens: 2048,
        maxRetries: 0,
        providerOptions: ProviderTransform.providerOptions(
          input.model,
          ProviderTransform.options({ model: input.model, sessionID: input.sessionID }),
        ),
      }),
    catch: (error) => error,
  }).pipe(
    Effect.catch(() =>
      input.abort.aborted ? Effect.interrupt : Effect.fail(new Error("Native web search request failed")),
    ),
  )
}

function callAlphaSearch(
  http: HttpClient.HttpClient,
  provider: Provider.Interface,
  route: string,
  query: string,
  sessionID: string,
) {
  const parsed = ModelV2.parse(route)
  return Effect.gen(function* () {
    if (parsed.providerID !== "openai") return yield* Effect.fail(new Error("Alpha search only supports OpenAI"))
    const model = yield* provider.getModel(parsed.providerID, parsed.modelID)
    const info = yield* provider.getProvider(parsed.providerID)
    const apiKey = alphaSearchApiKey(info)
    if (!apiKey) return yield* Effect.fail(new Error("OpenAI alpha search requires credentials"))
    const body = buildAlphaSearchRequest({ id: sessionID, model: model.api.id, query })
    const url = alphaSearchUrl(model, info)
    if (!url) return yield* Effect.fail(new Error("OpenAI alpha search requires a provider base URL"))
    const request = yield* HttpClientRequest.post(url).pipe(
      HttpClientRequest.setHeaders({
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "User-Agent": Installation.USER_AGENT,
      }),
      HttpClientRequest.schemaBodyJson(Schema.Unknown)(body),
    )
    const response = yield* HttpClient.filterStatusOk(http).execute(request)
    const result = yield* HttpClientResponse.schemaBodyJson(AlphaSearchResponse)(response)
    return nativeSearchOutput(result.output, result.results)
  })
}

function callNativeSearch(
  provider: Provider.Interface,
  route: string,
  query: string,
  sessionID: string,
  abort: AbortSignal,
) {
  const parsed = ModelV2.parse(route)
  return Effect.gen(function* () {
    const model = yield* provider.getModel(parsed.providerID, parsed.modelID)
    if (!supportsNativeSearchModel(model)) return yield* Effect.fail(new Error("Native web search route unsupported"))
    const language = yield* provider.getLanguage(model)
    const webSearch = yield* Effect.promise(() => nativeSearchTool(String(parsed.providerID)))
    const result = yield* runNativeSearchRequest({
      language,
      model,
      webSearch,
      query,
      sessionID,
      abort,
    })
    return nativeSearchOutput(result.text, result.sources)
  })
}

function parallelAuthHeaders() {
  const headers = { "User-Agent": Installation.USER_AGENT }
  if (!process.env.PARALLEL_API_KEY) return headers
  return { ...headers, Authorization: `Bearer ${process.env.PARALLEL_API_KEY}` }
}

function callProvider(
  http: HttpClient.HttpClient,
  provider: WebSearchProvider,
  params: Schema.Schema.Type<typeof Parameters>,
  ctx: Tool.Context,
) {
  if (provider === "parallel") {
    return McpWebSearch.call(
      http,
      McpWebSearch.PARALLEL_URL,
      "web_search",
      McpWebSearch.ParallelSearchArgs,
      {
        objective: params.query,
        search_queries: [params.query],
        session_id: ctx.sessionID,
        model_name: webSearchModelName(ctx.extra),
      },
      "25 seconds",
      parallelAuthHeaders(),
    )
  }

  return McpWebSearch.call(
    http,
    McpWebSearch.EXA_URL,
    "web_search_exa",
    McpWebSearch.SearchArgs,
    {
      query: params.query,
      type: params.type || "auto",
      numResults: params.numResults || 8,
      livecrawl: params.livecrawl || "fallback",
      contextMaxCharacters: params.contextMaxCharacters,
    },
    "25 seconds",
  )
}

export const WebSearchTool = Tool.define(
  "websearch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const flags = yield* RuntimeFlags.Service
    const config = yield* Config.Service
    const providerService = yield* Provider.Service

    return {
      get description() {
        return DESCRIPTION.replace("{{year}}", new Date().getFullYear().toString())
      },
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const configured = yield* config.get()
          const routes = nativeSearchModels(configured)
          const mode = nativeSearchMode(configured)
          const model = ctx.extra?.model
          const currentProvider =
            model && typeof model === "object" && "providerID" in model && typeof model.providerID === "string"
              ? model.providerID
              : undefined
          const nativeRoutes = currentProvider ? prioritizeNativeSearchModels(routes, currentProvider) : routes
          const provider = nativeRoutes.length
            ? undefined
            : selectWebSearchProvider(ctx.sessionID, {
                exa: flags.enableExa,
                parallel: flags.enableParallel,
              })
          const title = provider
            ? webSearchProviderLabel(provider)
            : mode === "alpha-search"
              ? "OpenAI Web Search"
              : "Native Web Search"
          yield* ctx.metadata({ title: `${title} "${params.query}"`, metadata: { provider } })

          yield* ctx.ask({
            permission: "websearch",
            patterns: [params.query],
            always: ["*"],
            metadata: {
              query: params.query,
              numResults: params.numResults,
              livecrawl: params.livecrawl,
              type: params.type,
              contextMaxCharacters: params.contextMaxCharacters,
              provider: provider ?? "native",
            },
          })

          const native = nativeRoutes.length
            ? yield* executeNativeSearch(
                nativeRoutes,
                currentProvider ?? "",
                (route) =>
                  mode === "alpha-search"
                    ? callAlphaSearch(http, providerService, route, params.query, ctx.sessionID)
                    : callNativeSearch(providerService, route, params.query, ctx.sessionID, ctx.abort),
                ctx.abort,
              ).pipe(
                Effect.mapError(() =>
                  mode === "alpha-search"
                    ? new Error(`OpenAI 搜索不可用：请先配置 ${nativeRoutes[0]} 模型和凭据。`)
                    : new Error("Native web search unavailable"),
                ),
              )
            : undefined
          const result =
            native?.result ?? (nativeRoutes.length ? undefined : yield* callProvider(http, provider!, params, ctx))
          const resultProvider = native?.model ?? provider

          return {
            output: result ?? "No search results found. Please try a different query.",
            title: `${title}: ${params.query}`,
            metadata: { provider: resultProvider ?? "native" },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
