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

  test("recognises any string error value, not just stream_read_error", () => {
    const result = ProviderError.parseStreamError({ error: "connection_timeout" })
    expect(result).toBeDefined()
    expect(result!.type).toBe("api_error")
    expect(result!.message).toContain("connection_timeout")
    const r = result!
    if (r.type === "api_error") expect(r.isRetryable).toBe(true)
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
