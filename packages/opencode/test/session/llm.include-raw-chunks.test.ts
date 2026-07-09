import { beforeEach, describe, expect, mock, test } from "bun:test"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Layer, Effect, Stream } from "effect"
import { LLMClient } from "@opencode-ai/llm/route"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Auth } from "../../src/auth"
import { Plugin } from "../../src/plugin"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, SessionID } from "../../src/session/schema"
import { TestConfig } from "../fixture/config"
import { ProviderTest } from "../fake/provider"
import type { Agent } from "../../src/agent/agent"

const ModelID = ModelV2.ID
type ModelID = ModelV2.ID
const ProviderID = ProviderV2.ID
type ProviderID = ProviderV2.ID

const capturedStreamTextArgs: Array<Record<string, unknown>> = []
let nextFullStreamEvents: ReadonlyArray<unknown> = []

void mock.module("ai", () => ({
  streamText(args: Record<string, unknown>) {
    capturedStreamTextArgs.push(args)
    return {
      fullStream: {
        async *[Symbol.asyncIterator]() {
          for (const event of nextFullStreamEvents) yield event
        },
      },
    }
  },
  wrapLanguageModel({ model }: { model: unknown }) {
    return model
  },
  tool(input: unknown) {
    return input
  },
  jsonSchema(input: unknown) {
    return input
  },
}))

const passThroughPlugin = Layer.mock(Plugin.Service)({
  trigger: <Name extends string, Input, Output>(_name: Name, _input: Input, output: Output) => Effect.succeed(output),
  list: () => Effect.succeed([]),
  init: () => Effect.void,
})

const authLayer = Layer.mock(Auth.Service)({
  get: () => Effect.succeed(undefined),
  all: () => Effect.succeed({}),
})

const failingNativeClient = Layer.succeed(
  LLMClient.Service,
  LLMClient.Service.of({
    prepare: () => Effect.die(new Error("native LLM client should not be used when the flag is off")),
    stream: () => Stream.die(new Error("native LLM client should not be used when the flag is off")),
    generate: () => Effect.die(new Error("native LLM client should not be used when the flag is off")),
  }),
)

beforeEach(() => {
  capturedStreamTextArgs.length = 0
  nextFullStreamEvents = []
})

function agent() {
  return {
    name: "test",
    mode: "primary",
    options: {},
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  } satisfies Agent.Info
}

function user(model: { providerID: ProviderID; id: ModelID }) {
  return {
    id: MessageID.make(`msg-${model.providerID}-${model.id}`),
    sessionID: SessionID.make(`session-${model.providerID}-${model.id}`),
    role: "user",
    time: { created: Date.now() },
    agent: "test",
    model: { providerID: model.providerID, modelID: model.id },
  } satisfies MessageV2.User
}

async function runStream(
  modelOverride: Partial<ProviderTest.model extends (...args: any[]) => infer T ? T : never> = {},
) {
  const model = ProviderTest.model(modelOverride as never)
  const provider = ProviderTest.fake({
    model,
    info: ProviderTest.info(
      {
        id: model.providerID,
        options: model.options,
      },
      model,
    ),
    getLanguage: Effect.fn("TestProvider.getLanguage")(() => Effect.succeed({})),
  })
  const inputUser = user(model)
  const inputAgent = agent()

  const layer = LLM.layer.pipe(
    Layer.provide(authLayer),
    Layer.provide(TestConfig.layer({ get: () => Effect.succeed({}) })),
    Layer.provide(provider.layer),
    Layer.provide(passThroughPlugin),
    Layer.provide(failingNativeClient),
    Layer.provide(RuntimeFlags.layer({ experimentalNativeLlm: false })),
  )

  const events = await Effect.runPromise(
    LLM.Service.use((svc) =>
      svc
        .stream({
          user: inputUser,
          sessionID: inputUser.sessionID,
          model,
          agent: inputAgent,
          system: ["You are a helpful assistant."],
          messages: [{ role: "user", content: "Hello" }],
          tools: {},
        })
        .pipe(
          Stream.runCollect,
          Effect.map((items) => Array.from(items)),
        ),
    ).pipe(Effect.provide(layer)),
  )

  return { model, events }
}

describe("session.llm includeRawChunks contract", () => {
  test("passes includeRawChunks at streamText top level for OpenAI Responses", async () => {
    await runStream({
      id: ModelID.make("gpt-5.2"),
      providerID: ProviderID.make("openai"),
      api: { id: "gpt-5.2", url: "https://api.openai.com/v1", npm: "@ai-sdk/openai" },
    })

    expect(capturedStreamTextArgs).toHaveLength(1)
    expect(capturedStreamTextArgs[0]?.includeRawChunks).toBe(true)
    expect(JSON.stringify(capturedStreamTextArgs[0]?.providerOptions ?? {})).not.toContain("includeRawChunks")
  })

  test("passes includeRawChunks at streamText top level for Azure Responses", async () => {
    await runStream({
      id: ModelID.make("gpt-5.5"),
      providerID: ProviderID.make("azure"),
      api: {
        id: "gpt-5.5",
        url: "https://example-resource.openai.azure.com/openai",
        npm: "@ai-sdk/azure",
      },
    })

    expect(capturedStreamTextArgs).toHaveLength(1)
    expect(capturedStreamTextArgs[0]?.includeRawChunks).toBe(true)
    expect(JSON.stringify(capturedStreamTextArgs[0]?.providerOptions ?? {})).not.toContain("includeRawChunks")
  })

  test("disables includeRawChunks for Azure Chat Completions", async () => {
    await runStream({
      id: ModelID.make("gpt-5.5"),
      providerID: ProviderID.make("azure"),
      api: {
        id: "gpt-5.5",
        url: "https://example-resource.openai.azure.com/openai",
        npm: "@ai-sdk/azure",
      },
      options: { useCompletionUrls: true },
    })

    expect(capturedStreamTextArgs).toHaveLength(1)
    expect(capturedStreamTextArgs[0]?.includeRawChunks).toBe(false)
  })

  test("preserves Azure Responses top-level overflow errors before finish-step", async () => {
    nextFullStreamEvents = [
      {
        type: "raw",
        rawValue: {
          type: "error",
          code: "context_too_large",
          message: "Your input exceeds the context window of this model. Please adjust your input and try again.",
          sequence_number: 0,
        },
      },
      {
        type: "finish-step",
        response: { id: "resp-azure", timestamp: new Date(0), modelId: "gpt-5.5" },
        finishReason: "error",
        rawFinishReason: "error",
        providerMetadata: undefined,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
          outputTokenDetails: { textTokens: undefined, reasoningTokens: undefined },
        },
      },
    ]

    const { events } = await runStream({
      id: ModelID.make("gpt-5.5"),
      providerID: ProviderID.make("azure"),
      api: {
        id: "gpt-5.5",
        url: "https://example-resource.openai.azure.com/openai",
        npm: "@ai-sdk/azure",
      },
    })

    expect(events).toContainEqual({
      type: "provider-error",
      message: "Your input exceeds the context window of this model. Please adjust your input and try again.",
      code: "context_too_large",
    })
  })
})
