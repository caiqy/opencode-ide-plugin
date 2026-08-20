import { describe, expect, test } from "bun:test"
import { responses } from "../../src/providers/xai"

describe("xAI provider", () => {
  test("uses the xAI Responses endpoint by default", () => {
    expect(responses("grok-4").route.endpoint.baseURL).toBe("https://api.x.ai/v1")
  })
})
