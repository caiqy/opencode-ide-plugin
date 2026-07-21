import { describe, expect, test } from "bun:test"
import { createAzure } from "@ai-sdk/azure"
import { streamText } from "ai"
import { Effect, Stream } from "effect"
import { LLM } from "../../src/session/llm"
import { LLMAISDK } from "../../src/session/llm/ai-sdk"
import { ProviderTest } from "../fake/provider"
import { it } from "../lib/effect"

describe("session.llm includeRawChunks contract", () => {
  test("enables raw chunks for OpenAI Responses", () => {
    const model = ProviderTest.model({
      api: { id: "gpt-5.2", url: "https://api.openai.com/v1", npm: "@ai-sdk/openai" },
    })
    expect(LLM.includeRawChunks(model, ProviderTest.info({}, model))).toBe(true)
  })

  test("enables raw chunks for Azure Responses", () => {
    const model = ProviderTest.model({
      api: {
        id: "gpt-5.5",
        url: "https://example-resource.openai.azure.com/openai",
        npm: "@ai-sdk/azure",
      },
    })
    expect(LLM.includeRawChunks(model, ProviderTest.info({}, model))).toBe(true)
  })

  test("disables raw chunks for Azure Chat Completions", () => {
    const model = ProviderTest.model({
      api: {
        id: "gpt-5.5",
        url: "https://example-resource.openai.azure.com/openai",
        npm: "@ai-sdk/azure",
      },
      options: { useCompletionUrls: true },
    })
    expect(LLM.includeRawChunks(model, ProviderTest.info({}, model))).toBe(false)
  })

  test("disables raw chunks when Azure provider options select Chat Completions", () => {
    const model = ProviderTest.model({
      api: {
        id: "gpt-5.5",
        url: "https://example-resource.openai.azure.com/openai",
        npm: "@ai-sdk/azure",
      },
    })
    const provider = ProviderTest.info({ options: { useCompletionUrls: true } }, model)

    expect(LLM.includeRawChunks(model, provider)).toBe(false)
  })

  test("matches Azure Chat selection for truthy provider options", () => {
    const model = ProviderTest.model({
      api: {
        id: "gpt-5.5",
        url: "https://example-resource.openai.azure.com/openai",
        npm: "@ai-sdk/azure",
      },
    })
    const provider = ProviderTest.info({ options: { useCompletionUrls: "true" } }, model)

    expect(LLM.includeRawChunks(model, provider)).toBe(false)
  })

  it.effect("preserves flat Azure Responses overflow errors from the AI SDK stream", () =>
    Effect.gen(function* () {
      const result = streamText({
        model: createAzure({
          apiKey: "test",
          baseURL: "https://example.test/openai",
          fetch: async () =>
            new Response(
              `data: ${JSON.stringify({
                type: "error",
                sequence_number: 0,
                code: "context_too_large",
                message: "Your input exceeds the context window of this model. Please adjust your input and try again.",
              })}\n\n`,
              { status: 200, headers: { "content-type": "text/event-stream" } },
            ),
        }).responses("gpt-5.5"),
        prompt: "Hello",
        includeRawChunks: true,
        maxRetries: 0,
      })
      const state = LLMAISDK.adapterState()
      const events = yield* Stream.fromAsyncIterable(result.fullStream, (error) =>
        error instanceof Error ? error : new Error(String(error)),
      ).pipe(
        Stream.mapEffect((event) => LLMAISDK.toLLMEvents(state, event)),
        Stream.flatMap((items) => Stream.fromIterable(items)),
        Stream.runCollect,
      )

      const output = Array.from(events)
      expect(output.map((event) => event.type)).toEqual(["step-start", "step-finish", "provider-error", "finish"])
      expect(output).toContainEqual({
        type: "provider-error",
        message: "Your input exceeds the context window of this model. Please adjust your input and try again.",
        classification: "context-overflow",
      })
    }),
  )
})
