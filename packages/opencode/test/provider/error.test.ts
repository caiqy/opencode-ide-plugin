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

  test("recognizes transient string error values", () => {
    expect(ProviderError.parseStreamError({ error: "stream_read_error" })).toStrictEqual({
      type: "api_error",
      message: "stream_read_error",
      isRetryable: true,
      responseBody: JSON.stringify({ error: "stream_read_error" }),
    })
    expect(
      ProviderError.parseStreamError({ error: "connection_timeout", message: "Connection timed out" }),
    ).toStrictEqual({
      type: "api_error",
      message: "Connection timed out",
      isRetryable: true,
      responseBody: JSON.stringify({ error: "connection_timeout", message: "Connection timed out" }),
    })
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

  test("does not retry upstream errors with unknown explicit codes", () => {
    expect(
      ProviderError.parseStreamError({
        type: "error",
        error: { type: "upstream_error", code: "billing_error", message: "Billing is disabled" },
      }),
    ).toStrictEqual({
      type: "api_error",
      message: "Billing is disabled",
      isRetryable: false,
      responseBody: JSON.stringify({
        type: "error",
        error: { type: "upstream_error", code: "billing_error", message: "Billing is disabled" },
      }),
    })
  })

  test("does not retry structured invalid API key errors", () => {
    expect(
      ProviderError.parseStreamError({
        type: "error",
        error: { code: "invalid_api_key", message: "Invalid API key" },
      }),
    ).toStrictEqual({
      type: "api_error",
      message: "Invalid API key",
      isRetryable: false,
      responseBody: JSON.stringify({
        type: "error",
        error: { code: "invalid_api_key", message: "Invalid API key" },
      }),
    })
  })

  test("retries transient upstream errors", () => {
    expect(
      ProviderError.parseStreamError({
        type: "error",
        error: { type: "upstream_error", code: "stream_timeout", message: "stream_timeout" },
      }),
    ).toMatchObject({ type: "api_error", message: "stream_timeout", isRetryable: true })
  })

  test("retries upstream errors without an explicit code", () => {
    expect(
      ProviderError.parseStreamError({
        type: "error",
        error: { type: "upstream_error", message: "Temporary upstream failure" },
      }),
    ).toMatchObject({ type: "api_error", message: "Temporary upstream failure", isRetryable: true })
  })

  test("classifies context_too_large as context overflow", () => {
    expect(
      ProviderError.parseStreamError({
        type: "error",
        error: { code: "context_too_large", message: "Upstream rejected this request." },
      }),
    ).toMatchObject({ type: "context_overflow", message: "Upstream rejected this request." })
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
    expect(result.message).toBe("Bad Request: no_kv_space")
  })

  test("classifies non-stream context_too_large API errors as context overflow", () => {
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
      type: "context_overflow",
      message: "Upstream rejected this request.",
      responseBody,
    })
  })

  test("falls back from the API SDK none sentinel to HTTP status text", () => {
    const result = ProviderError.parseAPICallError({
      providerID: ProviderID.make("openai"),
      error: new APICallError({
        message: "<none>",
        url: "https://example.com",
        requestBodyValues: {},
        statusCode: 429,
        responseHeaders: { "retry-after": "78" },
        isRetryable: true,
      }),
    })

    expect(result).toMatchObject({
      type: "api_error",
      message: "Too Many Requests",
      statusCode: 429,
      isRetryable: true,
      responseHeaders: { "retry-after": "78" },
    })
  })

  test("does not expose unrecognized response bodies for the API SDK none sentinel", () => {
    for (const responseBody of ["{}", "rate limit response", "<html>rate limited</html>"]) {
      const result = ProviderError.parseAPICallError({
        providerID: ProviderID.make("openai"),
        error: new APICallError({
          message: "<none>",
          url: "https://example.com",
          requestBodyValues: {},
          statusCode: 429,
          responseHeaders: { "retry-after": "78" },
          responseBody,
          isRetryable: true,
        }),
      })

      expect(result.message).toBe("Too Many Requests")
    }
  })

  test("uses an unknown error fallback when the API SDK none sentinel has no known status", () => {
    for (const statusCode of [undefined, 599]) {
      for (const responseBody of ["{}", "<body>rate limited</body>"]) {
        const result = ProviderError.parseAPICallError({
          providerID: ProviderID.make("openai"),
          error: new APICallError({
            message: "<none>",
            url: "https://example.com",
            requestBodyValues: {},
            statusCode,
            responseHeaders: {},
            responseBody,
            isRetryable: true,
          }),
        })

        expect(result.message).toBe("Unknown error")
      }
    }
  })
})
