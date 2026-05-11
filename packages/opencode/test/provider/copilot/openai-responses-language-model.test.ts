import { describe, expect, mock, test } from "bun:test"
import type { LanguageModelV3Prompt } from "@ai-sdk/provider"
import { OpenAIResponsesLanguageModel } from "../../../src/provider/sdk/copilot/responses/openai-responses-language-model"

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
const prompt: LanguageModelV3Prompt = [{ role: "user", content: [{ type: "text", text: "draw a cat" }] }]

async function streamParts<T>(stream: ReadableStream<T>) {
  const reader = stream.getReader()
  const result: T[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    result.push(value)
  }
  return result
}

function eventResponse(chunks: unknown[]) {
  const body = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(`event: ${chunk && typeof chunk === "object" ? (chunk as any).type : "message"}\n`))
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`))
      }
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } })
}

describe("OpenAIResponsesLanguageModel.doStream", () => {
  test("emits a tool result for final image_generation_call output", async () => {
    const fetch = mock(async () =>
      eventResponse([
        {
          type: "response.created",
          response: {
            id: "resp-image-generation",
            created_at: Math.floor(Date.now() / 1000),
            model: "gpt-5.2",
            service_tier: null,
          },
        },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "image_generation_call", id: "ig-test" },
        },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: { type: "image_generation_call", id: "ig-test", result: png },
        },
        {
          type: "response.completed",
          response: {
            incomplete_details: null,
            usage: {
              input_tokens: 1,
              input_tokens_details: null,
              output_tokens: 1,
              output_tokens_details: null,
            },
            service_tier: null,
          },
        },
      ]),
    )
    const model = new OpenAIResponsesLanguageModel("gpt-5.2", {
      provider: "test.responses",
      headers: () => ({}),
      url: () => "http://localhost/responses",
      fetch: fetch as any,
    })

    const { stream } = await model.doStream({ prompt })
    const parts = await streamParts(stream)

    const result = parts.find((part) => part.type === "tool-result" && part.toolCallId === "ig-test")
    expect(result).toEqual({
      type: "tool-result",
      toolCallId: "ig-test",
      toolName: "image_generation",
      result: { result: png },
    })
  })

  test("continues after image_generation_call added before final result", async () => {
    const fetch = mock(async () =>
      eventResponse([
        {
          type: "response.created",
          response: {
            id: "resp-image-generation-added",
            created_at: Math.floor(Date.now() / 1000),
            model: "gpt-5.2",
            service_tier: null,
          },
        },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "image_generation_call", id: "ig-added" },
        },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: { type: "image_generation_call", id: "ig-added", result: png },
        },
        {
          type: "response.completed",
          response: {
            incomplete_details: null,
            usage: {
              input_tokens: 1,
              input_tokens_details: null,
              output_tokens: 1,
              output_tokens_details: null,
            },
            service_tier: null,
          },
        },
      ]),
    )
    const model = new OpenAIResponsesLanguageModel("gpt-5.2", {
      provider: "test.responses",
      headers: () => ({}),
      url: () => "http://localhost/responses",
      fetch: fetch as any,
    })

    const { stream } = await model.doStream({ prompt })
    const parts = await streamParts(stream)

    expect(parts).toContainEqual({
      type: "tool-call",
      toolCallId: "ig-added",
      toolName: "image_generation",
      input: "{}",
      providerExecuted: true,
    })
    expect(parts).toContainEqual({
      type: "tool-result",
      toolCallId: "ig-added",
      toolName: "image_generation",
      result: { result: png },
    })
  })

  test("does not emit partial image chunks as final image_generation results", async () => {
    const partial = `${png.slice(0, -4)}AAAA`
    const fetch = mock(async () =>
      eventResponse([
        {
          type: "response.created",
          response: {
            id: "resp-image-generation",
            created_at: Math.floor(Date.now() / 1000),
            model: "gpt-5.2",
            service_tier: null,
          },
        },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "image_generation_call", id: "ig-test" },
        },
        {
          type: "response.image_generation_call.partial_image",
          item_id: "ig-test",
          output_index: 0,
          partial_image_b64: partial,
        },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: { type: "image_generation_call", id: "ig-test", result: png },
        },
        {
          type: "response.completed",
          response: {
            incomplete_details: null,
            usage: {
              input_tokens: 1,
              input_tokens_details: null,
              output_tokens: 1,
              output_tokens_details: null,
            },
            service_tier: null,
          },
        },
      ]),
    )
    const model = new OpenAIResponsesLanguageModel("gpt-5.2", {
      provider: "test.responses",
      headers: () => ({}),
      url: () => "http://localhost/responses",
      fetch: fetch as any,
    })

    const { stream } = await model.doStream({ prompt })
    const parts = await streamParts(stream)
    const results = parts.filter((part) => part.type === "tool-result" && part.toolCallId === "ig-test")

    expect(results).toEqual([
      {
        type: "tool-result",
        toolCallId: "ig-test",
        toolName: "image_generation",
        result: { result: png },
      },
    ])
  })

  test("does not emit partial_images chunks as final image_generation results", async () => {
    const partial = `${png.slice(0, -4)}BBBB`
    const fetch = mock(async () =>
      eventResponse([
        {
          type: "response.created",
          response: {
            id: "resp-image-generation-plural",
            created_at: Math.floor(Date.now() / 1000),
            model: "gpt-5.2",
            service_tier: null,
          },
        },
        {
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "image_generation_call", id: "ig-plural" },
        },
        {
          type: "response.image_generation_call.partial_images",
          item_id: "ig-plural",
          output_index: 0,
          partial_images_b64: [partial],
        },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: { type: "image_generation_call", id: "ig-plural", result: png },
        },
        {
          type: "response.completed",
          response: {
            incomplete_details: null,
            usage: {
              input_tokens: 1,
              input_tokens_details: null,
              output_tokens: 1,
              output_tokens_details: null,
            },
            service_tier: null,
          },
        },
      ]),
    )
    const model = new OpenAIResponsesLanguageModel("gpt-5.2", {
      provider: "test.responses",
      headers: () => ({}),
      url: () => "http://localhost/responses",
      fetch: fetch as any,
    })

    const { stream } = await model.doStream({ prompt })
    const parts = await streamParts(stream)
    const results = parts.filter((part) => part.type === "tool-result" && part.toolCallId === "ig-plural")

    expect(results).toEqual([
      {
        type: "tool-result",
        toolCallId: "ig-plural",
        toolName: "image_generation",
        result: { result: png },
      },
    ])
  })
})
