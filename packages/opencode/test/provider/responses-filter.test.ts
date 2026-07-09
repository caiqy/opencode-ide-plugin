import { expect, test } from "bun:test"
import { ResponsesFilter } from "@/provider/responses-filter"

function providerSseResponse(frames: string[], separator = "\n\n") {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frames.join(separator) + separator))
        controller.close()
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  )
}

async function readProviderSse(res: Response) {
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

test("non-SSE responses are not filtered", async () => {
  const response = ResponsesFilter.stripChatCompletionFrames(
    new Response(
      'data: {"id":"chatcmpl-dummy","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}\n\n',
      { headers: { "content-type": "application/json" } },
    ),
  )

  expect(await response.text()).toContain('"object":"chat.completion.chunk"')
})

test("filter only targets OpenAI and Azure /responses requests", () => {
  expect(ResponsesFilter.shouldApply("@ai-sdk/openai", "https://api.example.com/v1/responses")).toBe(true)
  expect(ResponsesFilter.shouldApply("@ai-sdk/azure", "https://api.example.com/openai/v1/responses")).toBe(true)
  expect(ResponsesFilter.shouldApply("@ai-sdk/openai", new URL("https://api.example.com/v1/responses"))).toBe(true)
  expect(ResponsesFilter.shouldApply("@ai-sdk/openai", { url: "https://api.example.com/v1/responses" })).toBe(true)
  expect(
    ResponsesFilter.shouldApply(
      "@ai-sdk/azure",
      "https://myresource.openai.azure.com/openai/deployments/gpt-4o/responses?api-version=2025-01-01-preview",
    ),
  ).toBe(true)
  expect(ResponsesFilter.shouldApply("@ai-sdk/openai", "https://api.example.com/v1/chat/completions")).toBe(false)
  expect(ResponsesFilter.shouldApply("@ai-sdk/openai-compatible", "https://api.example.com/v1/responses")).toBe(false)
})

test("Responses filter preserves stream terminators", async () => {
  const out = await readProviderSse(ResponsesFilter.stripChatCompletionFrames(providerSseResponse(["data: [DONE]"])))
  expect(out).toContain("data: [DONE]")
})

test("Responses filter drops chat completion frames and preserves Responses events", async () => {
  const chat = `data: ${JSON.stringify({
    id: "chatcmpl-dummy",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { role: "assistant", content: "" } }],
  })}`
  const created = `data: ${JSON.stringify({ type: "response.created", response: { id: "resp_1" } })}`
  const textDelta = `data: ${JSON.stringify({ type: "response.output_text.delta", item_id: "msg_1", delta: "Hi" })}`

  const out = await readProviderSse(
    ResponsesFilter.stripChatCompletionFrames(providerSseResponse([chat, created, textDelta])),
  )
  expect(out).not.toContain("chatcmpl-dummy")
  expect(out).toContain("response.created")
  expect(out).toContain("response.output_text.delta")
})

test("Responses filter drops websocket ingress zero-width frames", async () => {
  const ingress = `data: ${JSON.stringify({
    id: "chatcmpl-ws-ingress",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { role: "assistant", content: "\u200b" } }],
  })}`
  const created = `data: ${JSON.stringify({ type: "response.created", response: { id: "resp_1" } })}`

  const out = await readProviderSse(ResponsesFilter.stripChatCompletionFrames(providerSseResponse([ingress, created])))
  expect(out).not.toContain("chatcmpl-ws-ingress")
  expect(out).toContain("response.created")
})

test("Responses filter drops all chat completion frames regardless of content", async () => {
  const nonDummyEmpty = `data: ${JSON.stringify({
    id: "chatcmpl-real-empty",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { role: "assistant", content: "" } }],
  })}`
  const realContent = `data: ${JSON.stringify({
    id: "chatcmpl-real-content",
    object: "chat.completion.chunk",
    choices: [{ index: 0, delta: { content: "real text" }, finish_reason: null }],
  })}`

  const out = await readProviderSse(
    ResponsesFilter.stripChatCompletionFrames(providerSseResponse([nonDummyEmpty, realContent])),
  )
  expect(out).not.toContain("chatcmpl-real-empty")
  expect(out).not.toContain("real text")
})
