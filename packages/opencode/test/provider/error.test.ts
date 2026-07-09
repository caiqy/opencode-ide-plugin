import { describe, expect, test } from "bun:test"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { APICallError } from "ai"
import { ProviderError } from "../../src/provider/error"

const ProviderID = ProviderV2.ID

describe("ProviderError.parseStreamError", () => {
  test("returns undefined for non-object input", () => {
    expect(ProviderError.parseStreamError("plain text")).toBeUndefined()
    expect(ProviderError.parseStreamError(null)).toBeUndefined()
    expect(ProviderError.parseStreamError(42)).toBeUndefined()
  })

  test("returns undefined when error field is absent", () => {
    expect(ProviderError.parseStreamError({ type: "message_delta" })).toBeUndefined()
    expect(ProviderError.parseStreamError({})).toBeUndefined()
  })

  test("ignores non-standard string error values", () => {
    expect(ProviderError.parseStreamError({ error: "stream_read_error" })).toBeUndefined()
    expect(ProviderError.parseStreamError({ error: "connection_timeout" })).toBeUndefined()
    expect(ProviderError.parseStreamError({ error: "invalid_api_key" })).toBeUndefined()
  })

  test("does not confuse {error: object} with new string branch", () => {
    // The OpenAI-compatible error schema has error as an object; it should
    // fall through to the existing type:"error" path, not the string branch.
    const input = { type: "error", error: { code: "context_length_exceeded" } }
    const result = ProviderError.parseStreamError(input)
    expect(result).toBeDefined()
    expect(result!.type).toBe("context_overflow")
  })

  test("does not retry upstream errors with permanent codes", () => {
    const result = ProviderError.parseStreamError({
      type: "error",
      error: { type: "upstream_error", code: "invalid_prompt", message: "Invalid prompt" },
    })

    expect(result).toStrictEqual({
      type: "api_error",
      message: "Invalid prompt",
      isRetryable: false,
      responseBody: JSON.stringify({
        type: "error",
        error: { type: "upstream_error", code: "invalid_prompt", message: "Invalid prompt" },
      }),
    })
  })
})

describe("ProviderError.parseAPICallError", () => {
  test("extracts nested error.message from response body", () => {
    const result = ProviderError.parseAPICallError({
      providerID: ProviderID.make("openai"),
      error: new APICallError({
        message: "Bad Request",
        url: "https://example.com",
        requestBodyValues: {},
        statusCode: 400,
        responseHeaders: { "content-type": "application/json" },
        responseBody: JSON.stringify({ error: { message: "no_kv_space" } }),
        isRetryable: false,
      }),
    })

    expect(result.type).toBe("api_error")
    expect(result.message).toBe('Bad Request: {"error":{"message":"no_kv_space"}}')
  })

  test("keeps non-stream context_too_large API errors as API errors", () => {
    const responseBody = JSON.stringify({
      error: {
        code: "context_too_large",
        message: "Upstream rejected this request.",
      },
    })

    expect(
      ProviderError.parseAPICallError({
        providerID: ProviderID.make("openai"),
        error: new APICallError({
          message: "Bad Request",
          url: "https://example.com",
          requestBodyValues: {},
          statusCode: 400,
          responseHeaders: { "content-type": "application/json" },
          responseBody,
          isRetryable: false,
        }),
      }),
    ).toStrictEqual({
      type: "api_error",
      message: `Bad Request: ${responseBody}`,
      statusCode: 400,
      isRetryable: false,
      responseHeaders: { "content-type": "application/json" },
      responseBody,
      metadata: { url: "https://example.com" },
    })
  })
})
