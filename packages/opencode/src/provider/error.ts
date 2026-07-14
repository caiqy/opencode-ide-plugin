import { APICallError } from "ai"
import { STATUS_CODES } from "http"
import { iife } from "@/util/iife"
import type { ProviderV2 } from "@opencode-ai/core/provider"
import { isContextOverflow } from "@opencode-ai/llm"

export class HeaderTimeoutError extends Error {
  public override readonly name = "ProviderHeaderTimeoutError"

  constructor(public readonly ms: number) {
    super(`Provider response headers timed out after ${ms}ms`)
  }
}

export class ResponseStreamError extends Error {
  public override readonly name = "ProviderResponseStreamError"

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

const TRANSIENT_STREAM_ERROR_CODES = new Set([
  "connection_timeout",
  "internal_error",
  "rate_limit_exceeded",
  "server_error",
  "server_is_overloaded",
  "stream_read_error",
  "stream_timeout",
])

function isOpenAiErrorRetryable(e: APICallError) {
  const status = e.statusCode
  if (!status) return e.isRetryable
  // openai sometimes returns 404 for models that are actually available
  return status === 404 || e.isRetryable
}

// Providers not reliably handled in this function:
// - z.ai: can accept overflow silently (needs token-count/context-window checks)
function message(providerID: ProviderV2.ID, e: APICallError) {
  return iife(() => {
    const msg = e.message
    const errMsg = iife(() => {
      if (!e.responseBody) return
      try {
        const body = JSON.parse(e.responseBody)
        if (typeof body.message === "string") return body.message
        if (typeof body.error?.message === "string") return body.error.message
        if (typeof body.error === "string") return body.error
      } catch {}
    })

    if (msg === "" || msg === "<none>") {
      if (errMsg) return errMsg
      if (e.statusCode) {
        const err = STATUS_CODES[e.statusCode]
        if (err) return err
      }
      return "Unknown error"
    }

    if (!e.responseBody || (e.statusCode && msg !== STATUS_CODES[e.statusCode])) {
      return msg
    }

    if (errMsg) return `${msg}: ${errMsg}`

    // If responseBody is HTML (e.g. from a gateway or proxy error page),
    // provide a human-readable message instead of dumping raw markup
    if (/^\s*<!doctype|^\s*<html/i.test(e.responseBody)) {
      if (e.statusCode === 401) {
        return "Unauthorized: request was blocked by a gateway or proxy. Your authentication token may be missing or expired — try running `opencode auth login <your provider URL>` to re-authenticate."
      }
      if (e.statusCode === 403) {
        return "Forbidden: request was blocked by a gateway or proxy. You may not have permission to access this resource — check your account and provider settings."
      }
      return msg
    }

    return `${msg}: ${e.responseBody}`
  }).trim()
}

function json(input: unknown) {
  if (typeof input === "string") {
    try {
      const result = JSON.parse(input)
      if (result && typeof result === "object") return result
      return undefined
    } catch {
      return undefined
    }
  }
  if (typeof input === "object" && input !== null) {
    return input
  }
  return undefined
}

function isTransientStreamErrorCode(code: unknown) {
  return typeof code === "string" && TRANSIENT_STREAM_ERROR_CODES.has(code)
}

export type ParsedStreamError =
  | {
      type: "context_overflow"
      message: string
      responseBody: string
    }
  | {
      type: "api_error"
      message: string
      isRetryable: boolean
      responseBody: string
    }

export function parseStreamError(input: unknown): ParsedStreamError | undefined {
  const raw = json(input)
  const body = typeof raw?.message === "string" ? (json(raw.message) ?? raw) : raw
  if (!body) return

  const responseBody = JSON.stringify(body)
  if (body.type !== "error") {
    if (typeof body.error !== "string" || !isTransientStreamErrorCode(body.error)) return
    return {
      type: "api_error",
      message: typeof body.message === "string" ? body.message : body.error,
      isRetryable: true,
      responseBody,
    }
  }

  const code = typeof body.error?.code === "string" ? body.error.code : typeof body.code === "string" ? body.code : undefined
  const detail =
    typeof body.error?.message === "string"
      ? body.error.message
      : typeof body.message === "string"
        ? body.message
        : undefined
  const upstream = body.error?.type === "upstream_error" || code === "upstream_error"
  if (isTransientStreamErrorCode(code) || (upstream && (!code || code === "upstream_error"))) {
    return {
      type: "api_error",
      message: detail ?? code ?? "upstream_error",
      isRetryable: true,
      responseBody,
    }
  }

  switch (code) {
    case "context_too_large":
    case "context_length_exceeded":
      return {
        type: "context_overflow",
        message: detail ?? "Input exceeds context window of this model",
        responseBody,
      }
    case "insufficient_quota":
      return {
        type: "api_error",
        message: "Quota exceeded. Check your plan and billing details.",
        isRetryable: false,
        responseBody,
      }
    case "usage_not_included":
      return {
        type: "api_error",
        message: "To use Codex with your ChatGPT plan, upgrade to Plus: https://chatgpt.com/explore/plus.",
        isRetryable: false,
        responseBody,
      }
    case "invalid_prompt":
    case "invalid_api_key":
      return {
        type: "api_error",
        message: detail ?? "Invalid request.",
        isRetryable: false,
        responseBody,
      }
    case "server_is_overloaded":
    case "server_error":
      return {
        type: "api_error",
        message: detail ?? "Server error.",
        isRetryable: true,
        responseBody,
      }
  }

  if (upstream) {
    return {
      type: "api_error",
      message: detail ?? code ?? "upstream_error",
      isRetryable: false,
      responseBody,
    }
  }
}

export type ParsedAPICallError =
  | {
      type: "context_overflow"
      message: string
      responseBody?: string
    }
  | {
      type: "api_error"
      message: string
      statusCode?: number
      isRetryable: boolean
      responseHeaders?: Record<string, string>
      responseBody?: string
      metadata?: Record<string, string>
    }

export function parseAPICallError(input: { providerID: ProviderV2.ID; error: APICallError }): ParsedAPICallError {
  const m = message(input.providerID, input.error)
  const body = json(input.error.responseBody) ?? json(input.error.cause)
  const responseBody = input.error.responseBody ?? (body ? JSON.stringify(body) : undefined)
  const parsed = parseStreamError(body)
  if (parsed?.type === "context_overflow") {
    return {
      type: "context_overflow",
      message: parsed.message,
      responseBody: parsed.responseBody,
    }
  }
  if (parsed?.type === "api_error") {
    const metadata = input.error.url ? { url: input.error.url } : undefined
    return {
      type: "api_error",
      message: parsed.message,
      statusCode: input.error.statusCode,
      isRetryable: parsed.isRetryable,
      responseHeaders: input.error.responseHeaders,
      responseBody: parsed.responseBody,
      metadata,
    }
  }
  if (
    isContextOverflow(m) ||
    input.error.statusCode === 413 ||
    body?.error?.code === "context_length_exceeded" ||
    body?.error?.code === "context_too_large"
  ) {
    return {
      type: "context_overflow",
      message: typeof body?.error?.message === "string" ? body.error.message : m,
      responseBody,
    }
  }

  const metadata = input.error.url ? { url: input.error.url } : undefined
  return {
    type: "api_error",
    message: m,
    statusCode: input.error.statusCode,
    isRetryable: input.providerID.startsWith("openai") ? isOpenAiErrorRetryable(input.error) : input.error.isRetryable,
    responseHeaders: input.error.responseHeaders,
    responseBody,
    metadata,
  }
}

export * as ProviderError from "./error"
