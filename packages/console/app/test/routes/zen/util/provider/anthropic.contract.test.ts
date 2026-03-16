import { describe, expect, test } from "bun:test"
import { fromAnthropicChunk } from "../../../../../src/routes/zen/util/provider/anthropic"

function parse(chunk: string) {
  const out = fromAnthropicChunk(chunk)
  if (typeof out === "string") throw new Error("expected CommonChunk")
  return out
}

describe("fromAnthropicChunk contract", () => {
  test("keeps text from content_block_start when provided", () => {
    const s = [
      "event: content_block_start",
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"hello"}}',
      "",
    ].join("\n")

    const out = parse(s)
    expect(out.choices[0]?.delta?.content).toBe("hello")
  })

  test("falls back to empty text when content_block_start.text is missing", () => {
    const s = [
      "event: content_block_start",
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}',
      "",
    ].join("\n")

    const out = parse(s)
    expect(out.choices[0]?.delta?.content).toBe("")
  })

  test("falls back index to 0 for tool_use start event", () => {
    const s = [
      "event: content_block_start",
      'data: {"type":"content_block_start","content_block":{"type":"tool_use","id":"tool-1","name":"bash"}}',
      "",
    ].join("\n")

    const out = parse(s)
    expect(out.choices[0]?.index).toBe(0)
    expect(out.choices[0]?.delta?.tool_calls?.[0]?.function?.name).toBe("bash")
  })

  test("maps unknown stop_reason to null finish_reason", () => {
    const s = [
      "event: message_delta",
      'data: {"type":"message_delta","delta":{"stop_reason":"unknown_reason"}}',
      "",
    ].join("\n")

    const out = parse(s)
    expect(out.choices[0]?.finish_reason).toBeNull()
  })
})
