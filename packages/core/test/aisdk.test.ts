import { describe, expect, test } from "bun:test"
import { AISDK } from "@opencode-ai/core/aisdk"

function sseResponse(frames: string[], url = "https://proxy.example/v1/responses") {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frames.join("\n\n") + "\n\n"))
      controller.close()
    },
  })
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  })
}

async function readAll(res: Response) {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let out = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    out += decoder.decode(value, { stream: true })
  }
  return out
}

const dummy = `data: ${JSON.stringify({
  id: "chatcmpl-dummy",
  object: "chat.completion.chunk",
  created: 1780471912,
  model: "gpt-5.5",
  choices: [{ index: 0, delta: { role: "assistant", content: "" } }],
})}`

const created = `data: ${JSON.stringify({ type: "response.created", response: { id: "resp_1" } })}`
const textDelta = `data: ${JSON.stringify({ type: "response.output_text.delta", item_id: "msg_1", delta: "Hi" })}`
const completed = `data: ${JSON.stringify({ type: "response.completed", response: { id: "resp_1" } })}`

describe("AISDK.isEmptyChatCompletionFrame", () => {
  test("flags the empty chat.completion.chunk dummy frame", () => {
    expect(AISDK.isEmptyChatCompletionFrame(dummy.slice("data: ".length))).toBe(true)
  })

  test("flags a dummy chunk with tool_calls null", () => {
    const data = JSON.stringify({
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { content: "", tool_calls: null } }],
    })
    expect(AISDK.isEmptyChatCompletionFrame(data)).toBe(true)
  })

  test("does not flag a chat chunk with real content", () => {
    const data = JSON.stringify({
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { content: "real" }, finish_reason: null }],
    })
    expect(AISDK.isEmptyChatCompletionFrame(data)).toBe(false)
  })

  test("does not flag a chat chunk with tool_calls", () => {
    const data = JSON.stringify({
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "x", arguments: "" } }] } }],
    })
    expect(AISDK.isEmptyChatCompletionFrame(data)).toBe(false)
  })

  test("does not flag a chat chunk with finish_reason", () => {
    const data = JSON.stringify({
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    })
    expect(AISDK.isEmptyChatCompletionFrame(data)).toBe(false)
  })

  test("does not flag responses events", () => {
    expect(AISDK.isEmptyChatCompletionFrame(JSON.stringify({ type: "response.created", response: {} }))).toBe(false)
  })

  test("does not flag malformed json or [DONE]", () => {
    expect(AISDK.isEmptyChatCompletionFrame("[DONE]")).toBe(false)
    expect(AISDK.isEmptyChatCompletionFrame("not json")).toBe(false)
  })
})

describe("AISDK.filterResponsesDummyChunks", () => {
  test("drops the leading empty dummy chunk and keeps responses events", async () => {
    const filtered = AISDK.filterResponsesDummyChunks(sseResponse([dummy, created, textDelta, completed, "data: [DONE]"]))
    const out = await readAll(filtered)
    expect(out).not.toContain("chatcmpl-dummy")
    expect(out).toContain("response.created")
    expect(out).toContain("response.output_text.delta")
    expect(out).toContain("response.completed")
    expect(out).toContain("[DONE]")
  })

  test("preserves real chat completion content so the parser can still surface it", async () => {
    const real = `data: ${JSON.stringify({
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { content: "real text" }, finish_reason: null }],
    })}`
    const filtered = AISDK.filterResponsesDummyChunks(sseResponse([dummy, real]))
    const out = await readAll(filtered)
    expect(out).not.toContain("chatcmpl-dummy")
    expect(out).toContain("real text")
  })
})
