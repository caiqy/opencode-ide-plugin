import { NodeFileSystem } from "@effect/platform-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventV2 } from "@opencode-ai/core/event"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { expect, describe } from "bun:test"
import { Effect, Layer } from "effect"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionSummary } from "../../src/session/summary"
import { SessionSummaryScheduler } from "../../src/session/summary-scheduler"
import { Snapshot } from "../../src/snapshot"
import { Storage } from "../../src/storage"
import * as Log from "../../src/util/log"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

void Log.init({ print: false })

const ModelID = ModelV2.ID
const ProviderID = ProviderV2.ID

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const fileDiffs: Snapshot.FileDiff[] = [
  {
    file: "src/example.ts",
    patch: "@@ -1 +1 @@",
    additions: 2,
    deletions: 1,
    status: "modified",
  },
]

const snapshotState = {
  calls: [] as Array<{ from: string; to: string }>,
  pauseNext: undefined as
    | undefined
    | {
        started: PromiseWithResolvers<void>
        release: PromiseWithResolvers<void>
      },
}

const snapshot = Layer.succeed(
  Snapshot.Service,
  Snapshot.Service.of({
    init: () => Effect.void,
    cleanup: () => Effect.void,
    track: () => Effect.succeed(undefined),
    patch: () => Effect.die("not implemented"),
    restore: () => Effect.void,
    revert: () => Effect.void,
    diff: () => Effect.succeed(""),
    diffFull: (from, to) =>
      Effect.suspend(() => {
        snapshotState.calls.push({ from, to })
        if (!snapshotState.pauseNext) {
          return Effect.succeed(fileDiffs)
        }
        const gate = snapshotState.pauseNext
        snapshotState.pauseNext = undefined
        return Effect.gen(function* () {
          yield* Effect.promise(async () => {
            gate.started.resolve()
            await gate.release.promise
          })
          return fileDiffs
        })
      }),
  }),
)

const infra = Layer.mergeAll(NodeFileSystem.layer, LayerNode.compile(CrossSpawnSpawner.node))
const sessionLayer = AppNodeBuilder.build(
  LayerNode.group([Session.node, Storage.node, EventV2Bridge.node, SessionProjector.node, InstanceStore.node, CrossSpawnSpawner.node]),
  [[InstanceBootstrap.node, Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))]],
)

function subscribeCallback<D extends EventV2.Definition>(
  events: EventV2Bridge.Interface,
  definition: D,
  callback: (event: { properties: EventV2.Data<D> }) => void,
) {
  return events.listen((event) => {
    if (event.type !== definition.type) return Effect.void
    callback({ properties: event.data as EventV2.Data<D> })
    return Effect.void
  })
}

const deps = Layer.mergeAll(sessionLayer, snapshot).pipe(Layer.provideMerge(infra))

const summaryLayer = LayerNode.compile(SessionSummary.node, [[Snapshot.node, snapshot]]).pipe(Layer.provideMerge(deps))
const schedulerLayer = SessionSummaryScheduler.layer.pipe(
  Layer.provide(sessionLayer),
  Layer.provide(summaryLayer),
)

const env = Layer.mergeAll(deps, summaryLayer, schedulerLayer)

const it = testEffect(env)

function settleBus() {
  return Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
}

function waitFor(check: () => boolean, timeout = 1000) {
  return Effect.promise(
    () =>
      new Promise<void>((resolve, reject) => {
        const startedAt = Date.now()

        const poll = () => {
          if (check()) {
            resolve()
            return
          }
          if (Date.now() - startedAt >= timeout) {
            reject(new Error("timed out waiting for condition"))
            return
          }
          setTimeout(poll, 5)
        }

        poll()
      }),
  )
}

const userMessage = Effect.fn("TestSummary.userMessage")(function* (sessionID: SessionID) {
  const session = yield* Session.Service
  return yield* session.updateMessage({
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
})

const assistantMessage = Effect.fn("TestSummary.assistantMessage")(function* (
  sessionID: SessionID,
  parentID: MessageID,
  root: string,
) {
  const session = yield* Session.Service
  return yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "assistant",
    sessionID,
    mode: "build",
    agent: "build",
    path: { cwd: root, root },
    cost: 0,
    tokens: {
      output: 0,
      input: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: ref.modelID,
    providerID: ref.providerID,
    parentID,
    time: { created: Date.now() },
    finish: "end_turn",
  } satisfies MessageV2.Assistant)
})

const seedConversation = Effect.fn("TestSummary.seedConversation")(function* (sessionID: SessionID, root: string) {
  const session = yield* Session.Service
  const user = yield* userMessage(sessionID)
  const assistant = yield* assistantMessage(sessionID, user.id, root)

  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: assistant.id,
    sessionID,
    type: "step-start",
    snapshot: "snapshot-before",
  })
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: assistant.id,
    sessionID,
    type: "step-finish",
    reason: "stop",
    snapshot: "snapshot-after",
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  })

  return user
})

describe("SessionSummary", () => {
  it.live("scheduler markDirty auto-runs real summarize and writes summary plus diff", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          snapshotState.calls = []
          const session = yield* Session.Service
          const summary = yield* SessionSummary.Service
          const scheduler = yield* SessionSummaryScheduler.Service
          const chat = yield* session.create({ title: "scheduler auto summarize" })
          const user = yield* seedConversation(chat.id, dir)

          yield* scheduler.markDirty({ sessionID: chat.id, messageID: user.id, version: 1 })
          let info = yield* session.get(chat.id)
          let diff = yield* summary.diff({ sessionID: chat.id })
          for (let i = 0; i < 25; i++) {
            if (info.summary && diff.length > 0) break
            yield* Effect.sleep("20 millis")
            info = yield* session.get(chat.id)
            diff = yield* summary.diff({ sessionID: chat.id })
          }

          expect(snapshotState.calls).toEqual([
            { from: "snapshot-before", to: "snapshot-after" },
          ])
          expect(info.summary).toEqual(expect.objectContaining({ additions: 0, deletions: 0, files: 0 }))
          expect(diff).toEqual([])
          const messages = yield* session.messages({ sessionID: chat.id })
          expect(messages.find((item) => item.info.id === user.id)?.info.summary).toEqual({ diffs: fileDiffs })
        }),
      { git: true },
    ),
  )

  it.live("canWrite false discards summary writes", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          snapshotState.calls = []
          const eventService = yield* EventV2Bridge.Service
          const session = yield* Session.Service
          const summary = yield* SessionSummary.Service
          const events: Array<{ sessionID: SessionID; diff: readonly Snapshot.FileDiff[] }> = []
          const chat = yield* session.create({ title: "discard summary writes" })
          const user = yield* seedConversation(chat.id, dir)

          const off = yield* subscribeCallback(eventService, Session.Event.Diff, (event) => {
            events.push(event.properties)
          })

          yield* summary.summarize({
            sessionID: chat.id,
            messageID: user.id,
            canWrite: () => Effect.succeed(false),
          })
          yield* settleBus()
          yield* off

          expect(snapshotState.calls).toHaveLength(0)
          expect((yield* session.get(chat.id)).summary).toBeUndefined()
          expect(yield* summary.diff({ sessionID: chat.id })).toEqual([])
          expect(events).toEqual([])

          const messages = yield* session.messages({ sessionID: chat.id })
          expect(messages.find((item) => item.info.id === user.id)?.info.summary).toBeUndefined()
        }),
      { git: true },
    ),
  )

  it.live("canWrite turning false mid-write suppresses diff event and message summary updates", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          snapshotState.calls = []
          const eventService = yield* EventV2Bridge.Service
          const session = yield* Session.Service
          const summary = yield* SessionSummary.Service
          const events: Array<{ sessionID: SessionID; diff: readonly Snapshot.FileDiff[] }> = []
          const chat = yield* session.create({ title: "late canWrite guard" })
          const user = yield* seedConversation(chat.id, dir)
          let writes = 0

          const off = yield* subscribeCallback(eventService, Session.Event.Diff, (event) => {
            events.push(event.properties)
          })

          yield* summary.summarize({
            sessionID: chat.id,
            messageID: user.id,
            canWrite: () => Effect.succeed(++writes === 1),
          })
          yield* settleBus()
          yield* off

          expect(snapshotState.calls).toHaveLength(1)
          expect((yield* session.get(chat.id)).summary).toEqual(
            expect.objectContaining({ additions: 0, deletions: 0, files: 0 }),
          )
          expect(yield* summary.diff({ sessionID: chat.id })).toEqual([])
          expect(events).toEqual([{ sessionID: chat.id, diff: [] }])

          const messages = yield* session.messages({ sessionID: chat.id })
          expect(messages.find((item) => item.info.id === user.id)?.info.summary).toBeUndefined()
        }),
      { git: true },
    ),
  )

  it.live("stale running summarize drops the first writeback and only publishes the rerun diff", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          snapshotState.calls = []
          const gate = {
            started: Promise.withResolvers<void>(),
            release: Promise.withResolvers<void>(),
          }
          snapshotState.pauseNext = gate
          const eventService = yield* EventV2Bridge.Service
          const session = yield* Session.Service
          const summary = yield* SessionSummary.Service
          const scheduler = yield* SessionSummaryScheduler.Service
          const events: Array<{ sessionID: SessionID; diff: readonly Snapshot.FileDiff[] }> = []
          const chat = yield* session.create({ title: "stale rerun writeback" })
          const user = yield* seedConversation(chat.id, dir)

          const off = yield* subscribeCallback(eventService, Session.Event.Diff, (event) => {
            if (event.properties.sessionID === chat.id) {
              events.push(event.properties)
            }
          })

          yield* scheduler.markDirty({ sessionID: chat.id, messageID: user.id, version: 1 })
          yield* Effect.promise(() => gate.started.promise)
          yield* scheduler.markDirty({ sessionID: chat.id, messageID: user.id, version: 2 })
          gate.release.resolve()

          yield* waitFor(() => events.length === 1)
          yield* settleBus()
          yield* off

          expect(snapshotState.calls).toEqual([
            { from: "snapshot-before", to: "snapshot-after" },
            { from: "snapshot-before", to: "snapshot-after" },
          ])
          expect(events).toEqual([
            { sessionID: chat.id, diff: [] },
            { sessionID: chat.id, diff: [] },
          ])
          expect((yield* session.get(chat.id)).summary).toEqual(
            expect.objectContaining({ additions: 0, deletions: 0, files: 0 }),
          )
          expect(yield* summary.diff({ sessionID: chat.id })).toEqual([])

          const messages = yield* session.messages({ sessionID: chat.id })
          expect(messages.find((item) => item.info.id === user.id)?.info.summary).toEqual({ diffs: fileDiffs })
        }),
      { git: true },
    ),
  )

  it.live("hidden then visible before summarize writeback still discards the old run and reruns", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          snapshotState.calls = []
          const gate = {
            started: Promise.withResolvers<void>(),
            release: Promise.withResolvers<void>(),
          }
          snapshotState.pauseNext = gate
          const eventService = yield* EventV2Bridge.Service
          const session = yield* Session.Service
          const summary = yield* SessionSummary.Service
          const scheduler = yield* SessionSummaryScheduler.Service
          const statuses: string[] = []
          const events: Array<{ sessionID: SessionID; diff: readonly Snapshot.FileDiff[] }> = []
          const chat = yield* session.create({ title: "hidden visible flap rerun" })
          const user = yield* seedConversation(chat.id, dir)

          const offStatus = yield* subscribeCallback(eventService, Session.Event.DiffStatus, (event) => {
            if (event.properties.sessionID === chat.id) {
              statuses.push(event.properties.status)
            }
          })
          const offDiff = yield* subscribeCallback(eventService, Session.Event.Diff, (event) => {
            if (event.properties.sessionID === chat.id) {
              events.push(event.properties)
            }
          })

          yield* scheduler.syncVisible([chat.id])
          yield* scheduler.markDirty({ sessionID: chat.id, messageID: user.id, version: 1 })
          yield* Effect.promise(() => gate.started.promise)

          yield* scheduler.syncVisible([])
          yield* scheduler.syncVisible([chat.id])
          gate.release.resolve()

          yield* waitFor(() => statuses.at(-1) === "idle")
          yield* settleBus()
          yield* offDiff
          yield* offStatus

          expect(snapshotState.calls).toEqual([
            { from: "snapshot-before", to: "snapshot-after" },
            { from: "snapshot-before", to: "snapshot-after" },
          ])
          expect(statuses).toEqual(["scheduled", "running", "scheduled", "running", "idle"])
          expect(events).toEqual([
            { sessionID: chat.id, diff: [] },
            { sessionID: chat.id, diff: [] },
          ])
          expect((yield* session.get(chat.id)).summary).toEqual(
            expect.objectContaining({ additions: 0, deletions: 0, files: 0 }),
          )
          expect(yield* summary.diff({ sessionID: chat.id })).toEqual([])

          const messages = yield* session.messages({ sessionID: chat.id })
          expect(messages.find((item) => item.info.id === user.id)?.info.summary).toEqual({ diffs: fileDiffs })
        }),
      { git: true },
    ),
  )

  it.live("first syncVisible hidden after implicit-visible run invalidates writeback until rerun", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          snapshotState.calls = []
          const gate = {
            started: Promise.withResolvers<void>(),
            release: Promise.withResolvers<void>(),
          }
          snapshotState.pauseNext = gate
          const eventService = yield* EventV2Bridge.Service
          const session = yield* Session.Service
          const summary = yield* SessionSummary.Service
          const scheduler = yield* SessionSummaryScheduler.Service
          const statuses: string[] = []
          const events: Array<{ sessionID: SessionID; diff: readonly Snapshot.FileDiff[] }> = []
          const chat = yield* session.create({ title: "implicit visible flap rerun" })
          const user = yield* seedConversation(chat.id, dir)

          const offStatus = yield* subscribeCallback(eventService, Session.Event.DiffStatus, (event) => {
            if (event.properties.sessionID === chat.id) {
              statuses.push(event.properties.status)
            }
          })
          const offDiff = yield* subscribeCallback(eventService, Session.Event.Diff, (event) => {
            if (event.properties.sessionID === chat.id) {
              events.push(event.properties)
            }
          })

          yield* scheduler.markDirty({ sessionID: chat.id, messageID: user.id, version: 1 })
          yield* Effect.promise(() => gate.started.promise)

          yield* scheduler.syncVisible([])
          yield* scheduler.syncVisible([chat.id])
          gate.release.resolve()

          yield* waitFor(() => statuses.at(-1) === "idle")
          yield* settleBus()
          yield* offDiff
          yield* offStatus

          expect(snapshotState.calls).toEqual([
            { from: "snapshot-before", to: "snapshot-after" },
            { from: "snapshot-before", to: "snapshot-after" },
          ])
          expect(statuses).toEqual(["scheduled", "running", "scheduled", "running", "idle"])
          expect(events).toEqual([
            { sessionID: chat.id, diff: [] },
            { sessionID: chat.id, diff: [] },
          ])
          expect((yield* session.get(chat.id)).summary).toEqual(
            expect.objectContaining({ additions: 0, deletions: 0, files: 0 }),
          )
          expect(yield* summary.diff({ sessionID: chat.id })).toEqual([])

          const messages = yield* session.messages({ sessionID: chat.id })
          expect(messages.find((item) => item.info.id === user.id)?.info.summary).toEqual({ diffs: fileDiffs })
        }),
      { git: true },
    ),
  )
})
