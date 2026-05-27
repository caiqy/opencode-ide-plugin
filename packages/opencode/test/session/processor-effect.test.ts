import { NodeFileSystem } from "@effect/platform-node"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { ChildProcessSpawner } from "effect/unstable/process"
import { tool } from "ai"
import { expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import * as PlatformError from "effect/PlatformError"
import * as Stream from "effect/Stream"
import path from "path"
import z from "zod"
import type { Agent } from "../../src/agent/agent"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "@/config/config"
import { Image } from "@/image/image"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "@/session/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionSummary } from "../../src/session/summary"
import { SessionSummaryScheduler } from "../../src/session/summary-scheduler"
import { SessionStatus } from "../../src/session/status"
import { Snapshot } from "../../src/snapshot"
import * as Log from "@opencode-ai/core/util/log"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirInstance, provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { raw, reply, TestLLMServer } from "../lib/llm-server"
import { SyncEvent } from "@/sync"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"

void Log.init({ print: false })

const summarySchedulerStub = {
  markDirty: (_input: { sessionID: SessionID; messageID: MessageID; version: number }) => Effect.void,
  foregroundStart: (_sessionID: SessionID) => Effect.void,
  foregroundFinish: (_sessionID: SessionID) => Effect.void,
  syncVisible: (_sessionIDs: readonly SessionID[]) => Effect.void,
  deleteSession: (_sessionID: SessionID) => Effect.void,
  flush: () => Effect.void,
}

const summaryScheduler = Layer.succeed(
  SessionSummaryScheduler.Service,
  SessionSummaryScheduler.Service.of({
    markDirty: (input) => summarySchedulerStub.markDirty(input),
    foregroundStart: (sessionID) => summarySchedulerStub.foregroundStart(sessionID),
    foregroundFinish: (sessionID) => summarySchedulerStub.foregroundFinish(sessionID),
    syncVisible: (sessionIDs) => summarySchedulerStub.syncVisible(sessionIDs),
    deleteSession: (sessionID) => summarySchedulerStub.deleteSession(sessionID),
    flush: () => summarySchedulerStub.flush(),
  }),
)

const summaryStub = {
  summarize: (_input: { sessionID: SessionID; messageID: MessageID }) => Effect.void,
  diff: () => Effect.succeed([]),
  computeDiff: () => Effect.succeed([]),
}

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: (input) => summaryStub.summarize(input),
    diff: () => summaryStub.diff(),
    computeDiff: () => summaryStub.computeDiff(),
  }),
)

function mockSpawner() {
  const spawner = ChildProcessSpawner.make(() =>
    Effect.succeed(
      ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(0),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: { [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") } as any,
        stdout: Stream.empty,
        stderr: Stream.empty,
        all: Stream.empty,
        getInputFd: () => ({ [Symbol.for("effect/Sink/TypeId")]: Symbol.for("effect/Sink/TypeId") }) as any,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      }),
    ),
  )
  return Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawner)
}

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="

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

function defer<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function withSummaryScheduler<A, E, R>(
  overrides: Partial<typeof summarySchedulerStub>,
  fx: Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = { ...summarySchedulerStub }
      Object.assign(summarySchedulerStub, overrides)
      return prev
    }),
    () => fx,
    (prev) =>
      Effect.sync(() => {
        Object.assign(summarySchedulerStub, prev)
      }),
  )
}

function withSummary<A, E, R>(overrides: Partial<typeof summaryStub>, fx: Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = { ...summaryStub }
      Object.assign(summaryStub, overrides)
      return prev
    }),
    () => fx,
    (prev) =>
      Effect.sync(() => {
        Object.assign(summaryStub, prev)
      }),
  )
}

async function waitForMarkDirtyCallCount(
  calls: Array<{ sessionID: SessionID; messageID: MessageID; version: number }>,
  count: number,
) {
  for (let i = 0; i < 100; i++) {
    if (calls.length >= count) return
    await Bun.sleep(25)
  }
  throw new Error(`Timed out waiting for ${count} dirty marks`)
}

const waitFor = <A>(check: Effect.Effect<A | undefined>, message: string) =>
  Effect.gen(function* () {
    const stop = Date.now() + 500
    while (Date.now() < stop) {
      const value = yield* check
      if (value !== undefined) return value
      yield* Effect.sleep("10 millis")
    }
    return yield* Effect.fail(new Error(message))
  })

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

const failingGeneratedImageFs = Layer.effect(
  AppFileSystem.Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    return AppFileSystem.Service.of({
      ...fs,
      writeWithDirs: (file) =>
        Effect.fail(
          PlatformError.systemError({
            _tag: "Unknown",
            module: "FileSystem",
            method: "writeWithDirs",
            pathOrDescriptor: file,
            cause: new Error("disk full"),
          }),
        ),
    })
  }),
).pipe(Layer.provide(AppFileSystem.defaultLayer))

const envWithFailingGeneratedImageFs = Layer.mergeAll(
  TestLLMServer.layer,
  SessionProcessor.layer.pipe(
    Layer.provide(summaryScheduler),
    Layer.provide(summary),
    Layer.provide(Image.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provide(failingGeneratedImageFs),
    Layer.provideMerge(deps),
  ),
)

const it = testEffect(env)
const itWithFailingGeneratedImageFs = testEffect(envWithFailingGeneratedImageFs)
const processorDefaultIt = testEffect(Layer.mergeAll(SessionProcessor.defaultLayer, mockSpawner()))

const boot = Effect.fn("test.boot")(function* () {
  const processors = yield* SessionProcessor.Service
  const session = yield* Session.Service
  const provider = yield* Provider.Service
  return { processors, session, provider }
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

it.live("stores assistant text from a single llm response", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.text("hello")

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "hi")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const input = {
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
          messages: [{ role: "user", content: "hi" }],
          tools: {},
        } satisfies LLM.StreamInput

        const value = yield* handle.process(input)
        const parts = MessageV2.parts(msg.id)
        const calls = yield* llm.calls

        expect(value).toBe("continue")
        expect(calls).toBe(1)
        expect(parts.some((part) => part.type === "text" && part.text === "hello")).toBe(true)
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("marking dirty records processor summary without direct summarize", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const calls: Array<{ sessionID: SessionID; messageID: MessageID; version: number }> = []
        const summarizeCalls: Array<{ sessionID: SessionID; messageID: MessageID }> = []

        yield* llm.text("hello")

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "hi")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)

        yield* withSummary(
          {
            summarize: (input) =>
              Effect.sync(() => {
                summarizeCalls.push(input)
              }),
          },
          withSummaryScheduler(
            {
              markDirty: (input) =>
                Effect.sync(() => {
                  calls.push(input)
                }),
            },
            Effect.gen(function* () {
              const handle = yield* processors.create({
                assistantMessage: msg,
                sessionID: chat.id,
                model: mdl,
              })

              yield* handle.process({
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
                messages: [{ role: "user", content: "hi" }],
                tools: {},
              } satisfies LLM.StreamInput)

              yield* Effect.promise(() => waitForMarkDirtyCallCount(calls, 1))
            }),
          ),
        )

        expect(calls).toEqual([
          expect.objectContaining({
            sessionID: chat.id,
            messageID: parent.id,
            version: expect.any(Number),
          }),
        ])
        expect(summarizeCalls).toEqual([])
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)

processorDefaultIt.live("defaultLayer provides summary scheduler", () =>
  provideTmpdirInstance(() =>
    Effect.gen(function* () {
      const processors = yield* SessionProcessor.Service
      expect(processors).toBeDefined()
    }),
  ),
)

it.live("records text part start and end times", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const gate = defer<void>()
        const { processors, session, provider } = yield* boot()

        yield* llm.push(
          raw({
            head: [
              {
                id: "chatcmpl-test",
                object: "chat.completion.chunk",
                choices: [{ delta: { role: "assistant" } }],
              },
              {
                id: "chatcmpl-test",
                object: "chat.completion.chunk",
                choices: [{ delta: { content: "hello" } }],
              },
            ],
            wait: gate.promise,
            tail: [
              {
                id: "chatcmpl-test",
                object: "chat.completion.chunk",
                choices: [{ delta: {}, finish_reason: "stop" }],
              },
            ],
          }),
        )

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "hi")
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
            messages: [{ role: "user", content: "hi" }],
            tools: {},
          })
          .pipe(Effect.forkChild)

        yield* waitFor(
          Effect.sync(() => MessageV2.parts(msg.id).find((part): part is MessageV2.TextPart => part.type === "text")),
          "timed out waiting for text part",
        )
        yield* Effect.sleep("20 millis")
        gate.resolve()

        const exit = yield* Fiber.await(run)
        const text = MessageV2.parts(msg.id).find((part): part is MessageV2.TextPart => part.type === "text")

        expect(Exit.isSuccess(exit)).toBe(true)
        expect(text?.text).toBe("hello")
        expect(text?.time?.start).toBeDefined()
        expect(text?.time?.end).toBeDefined()
        if (!text?.time?.start || !text.time.end) return
        expect(text.time.start).toBeLessThan(text.time.end)
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("normalizes image_generation tool results into persisted relative-path attachments", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.tool("image_generation", { prompt: "draw a pixel" })
        yield* llm.text("done")

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "draw a pixel")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })
        const exit = yield* Effect.exit(
          handle.process({
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
          messages: [{ role: "user", content: "draw a pixel" }],
          tools: {
            image_generation: tool({
              description: "Generate an image",
              inputSchema: z.object({ prompt: z.string() }),
              execute: async () => ({
                title: "image_generation",
                metadata: { source: "test" },
                output: png,
              }),
            }),
          },
          }),
        )
        if (Exit.isFailure(exit)) {
          throw new Error(Cause.pretty(exit.cause))
        }

        const parts = MessageV2.parts(msg.id)
        const call = parts.find(
          (part): part is MessageV2.ToolPart => part.type === "tool" && part.tool === "image_generation",
        )

        expect(yield* llm.calls).toBe(1)
        if (call?.state.status === "error") {
          throw new Error(call.state.error)
        }
        expect(call?.state.status).toBe("completed")
        if (call?.state.status !== "completed") return
        expect(call.state.output).toContain("已生成 1 张图片")
        expect(call.state.output).not.toContain("generated-image-1.png")
        expect(call.state.output).not.toContain(png)
        expect(call.state.title).toBe("image_generation")
        expect(call.state.metadata).toEqual({ source: "test" })
        expect(call.state.attachments).toHaveLength(1)
        const generated = call.state.attachments?.[0]
        expect(generated).toMatchObject({
          filename: `generated-image-${msg.id}-1.png`,
          mime: "image/png",
          relativePath: `.opencode/generated-images/generated-image-${msg.id}-1.png`,
          url: `/generated-image?path=.opencode%2Fgenerated-images%2Fgenerated-image-${msg.id}-1.png`,
        })
        expect(generated?.url).not.toContain("data:image/")
        expect(
          yield* Effect.promise(() => Bun.file(path.join(dir, ".opencode", "generated-images", `generated-image-${msg.id}-1.png`)).exists()),
        ).toBe(true)

        const history = yield* session.messages({ sessionID: chat.id })
        expect(JSON.stringify(history)).not.toContain("data:image/")
        const replay = yield* Effect.promise(() => MessageV2.toModelMessages(history, mdl))
        const replayText = JSON.stringify(replay)
        expect(replayText).toContain(`已生成图片文件：.opencode/generated-images/generated-image-${msg.id}-1.png`)
        expect(replay).toHaveLength(3)
        expect(replayText).not.toContain("Attached image(s) from tool result:")
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)

itWithFailingGeneratedImageFs.live("generated image persistence failures mark the tool call as error instead of defecting", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.tool("image_generation", { prompt: "draw a pixel" })
        yield* llm.text("done")

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "draw a pixel")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const exit = yield* Effect.exit(
          handle.process({
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
            messages: [{ role: "user", content: "draw a pixel" }],
            tools: {
              image_generation: tool({
                description: "Generate an image",
                inputSchema: z.object({ prompt: z.string() }),
                execute: async () => ({
                  title: "image_generation",
                  metadata: { source: "test" },
                  output: png,
                }),
              }),
            },
          }),
        )

        expect(Exit.isSuccess(exit)).toBe(true)
        if (Exit.isSuccess(exit)) {
          expect(exit.value).toBe("continue")
        }
        expect(handle.message.error).toBeUndefined()

        const parts = MessageV2.parts(msg.id)
        const call = parts.find(
          (part): part is MessageV2.ToolPart => part.type === "tool" && part.tool === "image_generation",
        )

        expect(call?.state.status).toBe("error")
        if (call?.state.status !== "error") return
        expect(call.state.error).toContain("Failed to persist generated image attachment")
        expect(call.state.error).toContain("FileSystem.writeWithDirs")
        expect(call.state.time.end).toBeDefined()
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)

it.live("requests compaction after token overflow", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.text("after", { usage: { input: 100, output: 0 } })

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "compact")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const base = yield* provider.getModel(ref.providerID, ref.modelID)
        const mdl = { ...base, limit: { context: 20, output: 10 } }
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
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
          messages: [{ role: "user", content: "compact" }],
          tools: {},
        })

        const parts = MessageV2.parts(msg.id)

        expect(value).toBe("compact")
        expect(parts.some((part) => part.type === "text" && part.text === "after")).toBe(true)
        expect(parts.some((part) => part.type === "step-finish")).toBe(true)
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("captures reasoning parts from llm responses", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.push(reply().reason("think").text("done").stop())

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "reason")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
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
          messages: [{ role: "user", content: "reason" }],
          tools: {},
        })

        const parts = MessageV2.parts(msg.id)
        const reasoning = parts.find((part): part is MessageV2.ReasoningPart => part.type === "reasoning")
        const text = parts.find((part): part is MessageV2.TextPart => part.type === "text")

        expect(value).toBe("continue")
        expect(yield* llm.calls).toBe(1)
        expect(reasoning?.text).toBe("think")
        expect(text?.text).toBe("done")
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("resets reasoning parts across retries", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.push(reply().reason("one").reset(), reply().reason("two").stop())

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "reason")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
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
          messages: [{ role: "user", content: "reason" }],
          tools: {},
        })

        const parts = MessageV2.parts(msg.id)
        const reasoning = parts.filter((part): part is MessageV2.ReasoningPart => part.type === "reasoning")

        expect(value).toBe("continue")
        expect(yield* llm.calls).toBe(2)
        expect(reasoning.some((part) => part.text === "two")).toBe(true)
        expect(reasoning.some((part) => part.text === "onetwo")).toBe(false)
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("does not retry unrecognized json errors", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.error(400, { error: { message: "no_kv_space" } })

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "json")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
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
          messages: [{ role: "user", content: "json" }],
          tools: {},
        })

        expect(value).toBe("stop")
        expect(yield* llm.calls).toBe(1)
        expect(handle.message.error?.name).toBe("APIError")
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("retries recognized structured json errors", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.error(429, { type: "error", error: { type: "too_many_requests" } })
        yield* llm.text("after")

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "retry json")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
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
          messages: [{ role: "user", content: "retry json" }],
          tools: {},
        })

        const parts = MessageV2.parts(msg.id)

        expect(value).toBe("continue")
        expect(yield* llm.calls).toBe(2)
        expect(parts.some((part) => part.type === "text" && part.text === "after")).toBe(true)
        expect(handle.message.error).toBeUndefined()
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("retries upstream stream_timeout structured errors", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const bus = yield* Bus.Service

        yield* llm.push(
          raw({
            head: [
              {
                type: "error",
                sequence_number: 0,
                error: {
                  type: "upstream_error",
                  code: "stream_timeout",
                  message: "stream_timeout",
                },
              },
            ],
          }),
        )
        yield* llm.text("after")

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "retry timeout")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const states: number[] = []
        const off = yield* bus.subscribeCallback(SessionStatus.Event.Status, (evt) => {
          if (evt.properties.sessionID !== chat.id) return
          if (evt.properties.status.type === "retry") states.push(evt.properties.status.attempt)
        })
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
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
          messages: [{ role: "user", content: "retry timeout" }],
          tools: {},
        })

        off()

        const parts = MessageV2.parts(msg.id)

        expect(value).toBe("continue")
        expect(yield* llm.calls).toBe(2)
        expect(states).toStrictEqual([1])
        expect(parts.some((part) => part.type === "text" && part.text === "after")).toBe(true)
        expect(handle.message.error).toBeUndefined()
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)

it.live("retries adapter-flattened stream_timeout message errors", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const bus = yield* Bus.Service

        yield* llm.push(
          raw({
            head: [
              {
                error: {
                  message: "stream_timeout",
                },
              },
            ],
          }),
        )
        yield* llm.text("after")

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "retry timeout text")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const states: number[] = []
        const off = yield* bus.subscribeCallback(SessionStatus.Event.Status, (evt) => {
          if (evt.properties.sessionID !== chat.id) return
          if (evt.properties.status.type === "retry") states.push(evt.properties.status.attempt)
        })
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
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
          messages: [{ role: "user", content: "retry timeout text" }],
          tools: {},
        })

        off()

        const parts = MessageV2.parts(msg.id)

        expect(value).toBe("continue")
        expect(yield* llm.calls).toBe(2)
        expect(states).toStrictEqual([1])
        expect(parts.some((part) => part.type === "text" && part.text === "after")).toBe(true)
        expect(handle.message.error).toBeUndefined()
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)

it.live("publishes retry status attempts", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const bus = yield* Bus.Service

        yield* llm.error(503, { error: "boom" })
        yield* llm.text("")

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "retry")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const states: number[] = []
        const off = yield* bus.subscribeCallback(SessionStatus.Event.Status, (evt) => {
          if (evt.properties.sessionID !== chat.id) return
          if (evt.properties.status.type === "retry") states.push(evt.properties.status.attempt)
        })
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
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
          messages: [{ role: "user", content: "retry" }],
          tools: {},
        })

        off()

        expect(value).toBe("continue")
        expect(yield* llm.calls).toBe(2)
        expect(states).toStrictEqual([1])
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("requests compaction on structured context overflow", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.error(400, { type: "error", error: { code: "context_length_exceeded" } })

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "compact json")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
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
          messages: [{ role: "user", content: "compact json" }],
          tools: {},
        })

        expect(value).toBe("compact")
        expect(yield* llm.calls).toBe(1)
        expect(handle.message.error).toBeUndefined()
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("suppresses session error when overflow transitions into compaction", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const bus = yield* Bus.Service
        const seen = defer<string>()

        yield* llm.error(400, { type: "error", error: { code: "context_length_exceeded" } })

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "compact json")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const errs: string[] = []
        const off = yield* bus.subscribeCallback(Session.Event.Error, (evt) => {
          if (evt.properties.sessionID !== chat.id) return
          if (!evt.properties.error) return
          errs.push(evt.properties.error.name)
          seen.resolve(evt.properties.error.name)
        })

        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
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
          messages: [{ role: "user", content: "compact json" }],
          tools: {},
        })

        const published = yield* Effect.promise(() => Promise.race([seen.promise, Bun.sleep(50).then(() => "__timeout__")]))

        off()

        expect(value).toBe("compact")
        expect(handle.message.error).toBeUndefined()
        expect(published).toBe("__timeout__")
        expect(errs).toEqual([])
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("session.processor effect tests complete AI SDK tool calls when native flag is off", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.tool("lookup", { query: "weather" })

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "tool")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
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
          messages: [{ role: "user", content: "tool" }],
          tools: {
            lookup: tool({
              description: "Look up information",
              inputSchema: z.object({ query: z.string() }),
              execute: async (input) => ({
                title: "Weather lookup",
                output: `result:${input.query}`,
                metadata: { source: "test" },
              }),
            }),
          },
        })

        const parts = MessageV2.parts(msg.id)
        const call = parts.find((part): part is MessageV2.ToolPart => part.type === "tool")

        expect(value).toBe("continue")
        expect(yield* llm.calls).toBe(1)
        expect(call?.callID).toBe("call_1")
        expect(call?.tool).toBe("lookup")
        expect(call?.state.status).toBe("completed")
        if (call?.state.status !== "completed") return
        expect(call.state.input).toEqual({ query: "weather" })
        expect(call.state.output).toBe("result:weather")
        expect(call.state.title).toBe("Weather lookup")
        expect(call.state.metadata).toEqual({ source: "test" })
        expect(call.state.time.start).toBeDefined()
        expect(call.state.time.end).toBeDefined()
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)

it.live("marks pending tool calls aborted on cleanup", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()

        yield* llm.toolHang("bash", { cmd: "pwd" })

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "tool abort")
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
            messages: [{ role: "user", content: "tool abort" }],
            tools: {},
          })
          .pipe(Effect.forkChild)

        yield* llm.wait(1)
        yield* waitFor(
          Effect.sync(() => MessageV2.parts(msg.id).find((part): part is MessageV2.ToolPart => part.type === "tool")),
          "timed out waiting for tool part",
        )
        yield* Fiber.interrupt(run)

        const exit = yield* Fiber.await(run)
        const parts = MessageV2.parts(msg.id)
        const call = parts.find((part): part is MessageV2.ToolPart => part.type === "tool")

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
        }
        expect(yield* llm.calls).toBe(1)
        expect(call?.state.status).toBe("error")
        if (call?.state.status === "error") {
          expect(call.state.error).toBe("Tool execution aborted")
          expect(call.state.metadata?.interrupted).toBe(true)
          expect(call.state.time.end).toBeDefined()
        }
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("stores aborted message errors and returns session to idle", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const seen = defer<void>()
        const { processors, session, provider } = yield* boot()
        const bus = yield* Bus.Service
        const sts = yield* SessionStatus.Service

        yield* llm.hang

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "abort")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const errs: string[] = []
        const off = yield* bus.subscribeCallback(Session.Event.Error, (evt) => {
          if (evt.properties.sessionID !== chat.id) return
          if (!evt.properties.error) return
          errs.push(evt.properties.error.name)
          seen.resolve()
        })
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
            messages: [{ role: "user", content: "abort" }],
            tools: {},
          })
          .pipe(Effect.forkChild)

        yield* llm.wait(1)
        yield* Fiber.interrupt(run)

        const exit = yield* Fiber.await(run)
        yield* Effect.promise(() => seen.promise)
        const stored = yield* MessageV2.get({ sessionID: chat.id, messageID: msg.id })
        const state = yield* sts.get(chat.id)
        off()

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
        }
        expect(handle.message.error?.name).toBe("MessageAbortedError")
        expect(stored.info.role).toBe("assistant")
        if (stored.info.role === "assistant") {
          expect(stored.info.error?.name).toBe("MessageAbortedError")
        }
        expect(state).toMatchObject({ type: "idle" })
        expect(errs).toContain("MessageAbortedError")
      }),
    { config: (url) => providerCfg(url) },
  ),
)

it.live("stores interrupted runs as aborted without manual abort", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const sts = yield* SessionStatus.Service

        yield* llm.hang

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "interrupt")
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
            messages: [{ role: "user", content: "interrupt" }],
            tools: {},
          })
          .pipe(Effect.forkChild)

        yield* llm.wait(1)
        yield* Fiber.interrupt(run)

        const exit = yield* Fiber.await(run)
        const stored = yield* MessageV2.get({ sessionID: chat.id, messageID: msg.id })
        const state = yield* sts.get(chat.id)

        expect(Exit.isFailure(exit)).toBe(true)
        expect(handle.message.error?.name).toBe("MessageAbortedError")
        expect(stored.info.role).toBe("assistant")
        if (stored.info.role === "assistant") {
          expect(stored.info.error?.name).toBe("MessageAbortedError")
        }
        expect(state).toMatchObject({ type: "idle" })
      }),
    { config: (url) => providerCfg(url) },
  ),
)
