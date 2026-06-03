import { describe, expect, test } from "bun:test"
import { APICallError } from "ai"
import { ProviderID } from "../../src/provider/schema"
import { ProviderError } from "../../src/provider/error"

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

  test("recognises gateway non-standard frame {error: string}", () => {
    const result = ProviderError.parseStreamError({ error: "stream_read_error" })
    expect(result).toBeDefined()
    expect(result!.type).toBe("api_error")
    expect(result!.message).toContain("stream_read_error")
    const r = result!
    if (r.type === "api_error") expect(r.isRetryable).toBe(true)
  })

  test("recognises transient string error values beyond stream_read_error", () => {
    const result = ProviderError.parseStreamError({ error: "connection_timeout" })
    expect(result).toBeDefined()
    expect(result!.type).toBe("api_error")
    expect(result!.message).toContain("connection_timeout")
    const r = result!
    if (r.type === "api_error") expect(r.isRetryable).toBe(true)
  })

  test("ignores permanent non-standard string error values", () => {
    expect(ProviderError.parseStreamError({ error: "invalid_api_key" })).toBeUndefined()
  })

  test("retries transient nested error codes without upstream_error type", () => {
    const input = { type: "error", error: { code: "rate_limit_exceeded", message: "Slow down" } }
    const result = ProviderError.parseStreamError(input)

    expect(result).toStrictEqual({
      type: "api_error",
      message: "Slow down",
      isRetryable: true,
      responseBody: JSON.stringify(input),
    })
  })

  test("retries upstream_error nested code without upstream_error type", () => {
    const input = { type: "error", error: { code: "upstream_error", message: "Upstream failed" } }
    const result = ProviderError.parseStreamError(input)

    expect(result).toStrictEqual({
      type: "api_error",
      message: "Upstream failed",
      isRetryable: true,
      responseBody: JSON.stringify(input),
    })
  })

  test("does not retry invalid_api_key nested error codes", () => {
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

  test("does not confuse {error: object} with new string branch", () => {
    // The OpenAI-compatible error schema has error as an object; it should
    // fall through to the existing type:"error" path, not the string branch.
    const input = { type: "error", error: { code: "context_length_exceeded" } }
    const result = ProviderError.parseStreamError(input)
    expect(result).toBeDefined()
    expect(result!.type).toBe("context_overflow")
  })

  test("includes responseBody in gateway string-error result", () => {
    const input = { error: "stream_read_error" }
    const result = ProviderError.parseStreamError(input)
    expect(result!.responseBody).toBe(JSON.stringify(input))
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
    expect(result.message).toBe("Bad Request: no_kv_space")
  })
})
