import { describe, expect, test } from "bun:test"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { TypeValidationError } from "ai"
import { MessageV2 } from "../../src/session/message-v2"

const ProviderID = ProviderV2.ID
const providerID = ProviderID.make("test")

describe("session.message-v2 stream error recovery", () => {
  test("serializes AI TypeValidationError as UnknownError", () => {
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

    expect(result).toEqual({
      name: "UnknownError",
      data: {
        message: expect.stringContaining("Type validation failed"),
      },
    })
  })
})
