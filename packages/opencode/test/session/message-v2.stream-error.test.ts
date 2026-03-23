import { describe, expect, test } from "bun:test"
import { TypeValidationError } from "ai"
import { ProviderID } from "../../src/provider/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionRetry } from "../../src/session/retry"

const providerID = ProviderID.make("test")

describe("session.message-v2 stream error recovery", () => {
  test("keeps recovered context overflow as ContextOverflowError", () => {
    const input = {
      type: "error",
      error: {
        code: "context_length_exceeded",
      },
    }
    const err = new TypeValidationError({
      value: input,
      cause: new Error("bad chunk"),
    })

    const result = MessageV2.fromError(err, { providerID })

    expect(result).toStrictEqual({
      name: "ContextOverflowError",
      data: {
        message: "Input exceeds context window of this model",
        responseBody: JSON.stringify(input),
      },
    })
  })

  test("serializes AI TypeValidationError gateway frames as retryable APIError", () => {
    const input = { error: "stream_read_error" }
    const err = new TypeValidationError({
      value: input,
      cause: new Error("bad chunk"),
    })

    const result = MessageV2.fromError(err, { providerID })

    expect(result).toStrictEqual({
      name: "APIError",
      data: {
        message: "Stream interrupted by upstream: stream_read_error",
        isRetryable: true,
        responseBody: JSON.stringify(input),
      },
    })
  })

  test("marks recovered stream_read_error as retryable", () => {
    const err = new TypeValidationError({
      value: { error: "stream_read_error" },
      cause: new Error("bad chunk"),
    })
    const result = MessageV2.fromError(err, { providerID })

    expect(MessageV2.APIError.isInstance(result)).toBe(true)
    expect(SessionRetry.retryable(result)).toBe("Stream interrupted by upstream: stream_read_error")
  })
})
