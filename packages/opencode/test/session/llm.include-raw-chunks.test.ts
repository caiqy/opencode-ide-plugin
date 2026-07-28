import { describe, expect, test } from "bun:test"
import { LLM } from "../../src/session/llm"
import { ProviderTest } from "../fake/provider"

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

})
