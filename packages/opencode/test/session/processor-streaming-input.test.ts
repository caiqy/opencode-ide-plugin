import { NodeFileSystem } from "@effect/platform-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import path from "path"
import type { Agent } from "../../src/agent/agent"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Image } from "../../src/image/image"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Provider } from "../../src/provider/provider"
import { Config } from "../../src/config/config"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { Session } from "../../src/session/session"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { SessionSummaryScheduler } from "../../src/session/summary-scheduler"
import { Snapshot } from "../../src/snapshot"
import { SyncEvent } from "../../src/sync"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

const summaryScheduler = Layer.succeed(
  SessionSummaryScheduler.Service,
  SessionSummaryScheduler.Service.of({
    markDirty: (_input: { sessionID: SessionID; messageID: MessageID; version: number }) => Effect.void,
    foregroundStart: (_sessionID: SessionID) => Effect.void,
    foregroundFinish: (_sessionID: SessionID) => Effect.void,
    syncVisible: (_sessionIDs: readonly SessionID[]) => Effect.void,
    deleteSession: (_sessionID: SessionID) => Effect.void,
    flush: () => Effect.void,
  }),
)

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: (_input: { sessionID: SessionID; messageID: MessageID }) => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function providerCfg(url: string) {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: {
          ...cfg.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}

function agent(): Agent.Info {
  return {
    name: "build",
    mode: "primary",
    options: {},
    permission: [{ permission: "*", pattern: "*", action: "allow" }],
  }
}

const user = Effect.fn("TestSession.user")(function* (sessionID: SessionID, text: string) {
  const session = yield* Session.Service
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
})

const assistant = Effect.fn("TestSession.assistant")(function* (
  sessionID: SessionID,
  parentID: MessageID,
  root: string,
) {
  const session = yield* Session.Service
  const msg: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "build",
    agent: "build",
    path: { cwd: root, root },
    cost: 0,
    tokens: {
      total: 0,
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID,
    time: { created: Date.now() },
    finish: "end_turn",
  }
  yield* session.updateMessage(msg)
  return msg
})

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)
const deps = Layer.mergeAll(
  Session.defaultLayer,
  Snapshot.defaultLayer,
  AgentSvc.defaultLayer,
  Permission.defaultLayer,
  Plugin.defaultLayer,
  Config.defaultLayer,
  LLM.defaultLayer,
  Provider.defaultLayer,
  status,
  SyncEvent.defaultLayer,
  EventV2Bridge.defaultLayer,
).pipe(Layer.provideMerge(infra))

const env = Layer.mergeAll(
  TestLLMServer.layer,
  SessionProcessor.layer.pipe(
    Layer.provide(summaryScheduler),
    Layer.provide(summary),
    Layer.provide(Image.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provideMerge(deps),
  ),
)

const it = testEffect(env)

const boot = Effect.fn("test.boot")(function* () {
  const processors = yield* SessionProcessor.Service
  const session = yield* Session.Service
  const provider = yield* Provider.Service
  return { processors, session, provider }
})

it.live("accumulates tool-input-delta into state.raw for write tool", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        yield* llm.toolHang("write", { filePath: "/tmp/x.txt", content: "hello world" })

        const chat = yield* session.create({ title: "streaming-input" })
        const parent = yield* user(chat.id, "go")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })
        const run = yield* handle
          .process({
            user: {
              id: parent.id,
              sessionID: chat.id,
              role: "user",
              time: parent.time,
              agent: parent.agent,
              model: { providerID: ref.providerID, modelID: ref.modelID },
            } satisfies MessageV2.User,
            sessionID: chat.id,
            model: mdl,
            agent: agent(),
            system: [],
            messages: [{ role: "user", content: "go" }],
            tools: {},
          } satisfies LLM.StreamInput)
          .pipe(Effect.forkChild)

        yield* Effect.gen(function* () {
          yield* llm.wait(1)
          const part = yield* pollUntilToolPending(chat.id)
          const expectedArgs = JSON.stringify({ filePath: "/tmp/x.txt", content: "hello world" })
          const expectedPartial = expectedArgs.slice(0, Math.max(1, Math.floor(expectedArgs.length / 2)))

          expect(part.state.status).toBe("pending")
          expect(part.state.raw).toBe(expectedPartial)
        }).pipe(Effect.ensuring(Fiber.interrupt(run)))
      }),
    { config: (url) => providerCfg(url) },
  ),
)

type PendingToolPart = MessageV2.ToolPart & { state: MessageV2.ToolStatePending }

const pollUntilToolPending = Effect.fn("pollUntilToolPending")(function* (sessionID: SessionID) {
  const session = yield* Session.Service
  for (let i = 0; i < 50; i++) {
    const messages = yield* session.messages({ sessionID })
    const part = messages
      .flatMap((msg) => msg.parts)
      .find(
        (part): part is PendingToolPart =>
          part.type === "tool" && part.state.status === "pending" && part.state.raw.length > 0,
      )
    if (part) return part
    yield* Effect.sleep("50 millis")
  }
  return yield* Effect.fail(new Error("no pending tool part with raw observed within 2.5s"))
})
