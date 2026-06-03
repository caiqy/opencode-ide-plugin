export * as AISDK from "./aisdk"

import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Cause, Context, Effect, Layer, Schema } from "effect"
import { ModelV2 } from "./model"
import { PluginV2 } from "./plugin"
import { ProviderV2 } from "./provider"

type SDK = any

/**
 * Detect whether a single SSE `data:` payload is an empty chat.completion.chunk
 * dummy frame injected by third-party OpenAI-compatible proxies at the start of
 * a Responses stream. Only truly empty frames (no content, no tool_calls, no
 * finish_reason) return true — real Chat Completions content is preserved so it
 * still surfaces as a parser error on the Responses path.
 */
export function isEmptyChatCompletionFrame(data: string): boolean {
  if (data === "[DONE]") return false
  let json: Record<string, unknown>
  try {
    const parsed = JSON.parse(data)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false
    json = parsed
  } catch {
    return false
  }
  if (json.object !== "chat.completion.chunk") return false
  // Only treat as empty dummy when choices is a present array with no real
  // payload. Missing or malformed choices should pass through to the parser
  // so protocol errors remain visible.
  if (!Array.isArray(json.choices)) return false
  return !(json.choices as Array<Record<string, unknown>>).some((choice) => {
    const delta = choice?.delta as Record<string, unknown> | undefined
    return (
      (typeof delta?.content === "string" && (delta.content as string).length > 0) ||
      (Array.isArray(delta?.tool_calls) && (delta.tool_calls as unknown[]).length > 0) ||
      choice?.finish_reason != null
    )
  })
}

/**
 * Wrap a Responses SSE stream to drop empty chat.completion.chunk dummy frames
 * that some third-party proxies inject. Non-event-stream responses pass through
 * unchanged.
 */
export function filterResponsesDummyChunks(res: Response): Response {
  if (!res.body) return res
  if (!res.headers.get("content-type")?.includes("text/event-stream")) return res

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ""

  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const { done, value } = await reader.read()
      if (done) {
        // flush remaining buffer
        if (buffer.trim().length > 0) {
          ctrl.enqueue(encoder.encode(buffer))
        }
        ctrl.close()
        return
      }

      buffer += decoder.decode(value, { stream: true })
      // Support both LF (\n\n) and CRLF (\r\n\r\n) SSE frame separators
      const parts = buffer.split(/\r?\n\r?\n/)
      buffer = parts.pop() ?? ""

      for (const part of parts) {
        const trimmed = part.trim()
        if (!trimmed) continue
        // Extract the data line from the SSE frame
        const dataLine = trimmed
          .split(/\r?\n/)
          .find((line) => line.startsWith("data: ") || line.startsWith("data:"))
        if (dataLine) {
          const payload = dataLine.startsWith("data: ") ? dataLine.slice(6) : dataLine.slice(5)
          if (isEmptyChatCompletionFrame(payload)) continue
        }
        ctrl.enqueue(encoder.encode(part + "\n\n"))
      }
    },
    async cancel(reason) {
      await reader.cancel(reason)
    },
  })

  return new Response(body, {
    headers: new Headers(res.headers),
    status: res.status,
    statusText: res.statusText,
  })
}

function wrapSSE(res: Response, ms: number, ctl: AbortController) {
  if (typeof ms !== "number" || ms <= 0) return res
  if (!res.body) return res
  if (!res.headers.get("content-type")?.includes("text/event-stream")) return res

  const reader = res.body.getReader()
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const part = await new Promise<Awaited<ReturnType<typeof reader.read>>>((resolve, reject) => {
        const id = setTimeout(() => {
          const err = new Error("SSE read timed out")
          ctl.abort(err)
          void reader.cancel(err)
          reject(err)
        }, ms)

        reader.read().then(
          (part) => {
            clearTimeout(id)
            resolve(part)
          },
          (err) => {
            clearTimeout(id)
            reject(err)
          },
        )
      })

      if (part.done) {
        ctrl.close()
        return
      }

      ctrl.enqueue(part.value)
    },
    async cancel(reason) {
      ctl.abort(reason)
      await reader.cancel(reason)
    },
  })

  return new Response(body, {
    headers: new Headers(res.headers),
    status: res.status,
    statusText: res.statusText,
  })
}

function prepareOptions(model: ModelV2.Info, pkg: string) {
  const options: Record<string, any> = { name: model.providerID, ...model.options.aisdk.provider }
  if (model.endpoint.type === "aisdk" && model.endpoint.url) options.baseURL = model.endpoint.url

  const customFetch = options.fetch
  const chunkTimeout = options.chunkTimeout
  delete options.chunkTimeout
  options.fetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const opts = { ...(init ?? {}) }
    const signals = [
      opts.signal,
      typeof chunkTimeout === "number" && chunkTimeout > 0 ? new AbortController() : undefined,
      options.timeout !== undefined && options.timeout !== null && options.timeout !== false
        ? AbortSignal.timeout(options.timeout)
        : undefined,
    ].filter((item): item is AbortSignal | AbortController => Boolean(item))
    const chunkAbortCtl = signals.find((item): item is AbortController => item instanceof AbortController)
    const abortSignals = signals.map((item) => (item instanceof AbortController ? item.signal : item))
    if (abortSignals.length === 1) opts.signal = abortSignals[0]
    if (abortSignals.length > 1) opts.signal = AbortSignal.any(abortSignals)

    if ((pkg === "@ai-sdk/openai" || pkg === "@ai-sdk/azure") && opts.body && opts.method === "POST") {
      const body = JSON.parse(opts.body as string)
      if (body.store !== true && Array.isArray(body.input)) {
        for (const item of body.input) {
          if ("id" in item) delete item.id
        }
        opts.body = JSON.stringify(body)
      }
    }

    let res = await (typeof customFetch === "function" ? customFetch : fetch)(input, {
      ...opts,
      timeout: false,
    })

    // Strip empty chat.completion.chunk dummy frames that third-party proxies
    // inject at the start of Responses SSE streams. Only applies when the URL
    // pathname ends with /responses — never touches /chat/completions.
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as any).url ?? ""
    if (typeof url === "string") {
      const pathname = (() => {
        try {
          return new URL(url).pathname
        } catch {
          return url
        }
      })()
      if (pathname.endsWith("/responses")) {
        res = filterResponsesDummyChunks(res)
      }
    }

    if (!chunkAbortCtl || typeof chunkTimeout !== "number") return res
    return wrapSSE(res, chunkTimeout, chunkAbortCtl)
  }

  return options
}

export class InitError extends Schema.TaggedErrorClass<InitError>()("AISDK.InitError", {
  providerID: ProviderV2.ID,
  cause: Schema.Defect,
}) {}

function initError(providerID: ProviderV2.ID) {
  return Effect.catchCause((cause) => Effect.fail(new InitError({ providerID, cause: Cause.squash(cause) })))
}

export interface Interface {
  readonly language: (model: ModelV2.Info) => Effect.Effect<LanguageModelV3, InitError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/AISDK") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const plugin = yield* PluginV2.Service
    const languages = new Map<string, LanguageModelV3>()
    const sdks = new Map<string, SDK>()

    return Service.of({
      language: Effect.fn("AISDK.language")(function* (model) {
        const key = `${model.providerID}/${model.id}/${model.options.variant ?? "default"}`
        const existing = languages.get(key)
        if (existing) return existing
        if (model.endpoint.type !== "aisdk")
          return yield* new InitError({
            providerID: model.providerID,
            cause: new Error(`Unsupported endpoint ${model.endpoint.type}`),
          })

        const options = prepareOptions(model, model.endpoint.package)
        const sdkKey = JSON.stringify({
          providerID: model.providerID,
          endpoint: model.endpoint,
          options,
        })
        const sdk =
          sdks.get(sdkKey) ??
          (yield* plugin
            .trigger("aisdk.sdk", { model, package: model.endpoint.package, options }, {})
            .pipe(initError(model.providerID))).sdk
        if (!sdk)
          return yield* new InitError({
            providerID: model.providerID,
            cause: new Error("No AISDK provider plugin returned an SDK"),
          })
        sdks.set(sdkKey, sdk)
        const result = yield* plugin
          .trigger(
            "aisdk.language",
            {
              model,
              sdk,
              options,
            },
            {},
          )
          .pipe(initError(model.providerID))
        const language = yield* Effect.sync(() => result.language ?? sdk.languageModel(model.apiID)).pipe(
          initError(model.providerID),
        )
        languages.set(key, language)
        return language
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(PluginV2.defaultLayer))
