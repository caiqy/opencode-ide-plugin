import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { EventV2 } from "@opencode-ai/core/event"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { InstanceBootstrap } from "../../src/project/bootstrap"
import { InstanceStore } from "../../src/project/instance-store"
import { Session } from "../../src/session"
import { MessageID, SessionID } from "../../src/session/schema"
import { applyForegroundFinish, applyForegroundStart } from "../../src/session/summary-scheduler-foreground"
import { SessionSummary } from "../../src/session/summary"
import { SessionSummaryScheduler } from "../../src/session/summary-scheduler"
import { Snapshot } from "../../src/snapshot"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const state = {
  calls: [] as Array<{ sessionID: SessionID; messageID: MessageID }>,
  writes: [] as Array<{ sessionID: SessionID; messageID: MessageID }>,
  failures: 0,
  pauseNext: undefined as
    | undefined
    | {
        started: PromiseWithResolvers<void>
        release: PromiseWithResolvers<void>
        skipCanWrite?: boolean
      },
}

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: ({ sessionID, messageID, canWrite }) =>
      Effect.suspend(() => {
        state.calls.push({ sessionID, messageID })
        if (state.pauseNext) {
          const gate = state.pauseNext
          state.pauseNext = undefined
          return Effect.gen(function* () {
            yield* Effect.promise(async () => {
              gate.started.resolve()
              await gate.release.promise
            })
            if (gate.skipCanWrite) return
            const allowed = canWrite ? yield* canWrite() : true
            if (allowed) {
              state.writes.push({ sessionID, messageID })
            }
          })
        }
        if (state.failures > 0) {
          state.failures -= 1
          return Effect.die(new Error("summary failed"))
        }
        state.writes.push({ sessionID, messageID })
        return Effect.void
      }),
    diff: () => Effect.succeed([] as Snapshot.FileDiff[]),
    computeDiff: () => Effect.succeed([] as Snapshot.FileDiff[]),
  }),
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

const eventLayer = AppNodeBuilder.build(EventV2Bridge.node)
const sessionLayer = AppNodeBuilder.build(
  LayerNode.group([Session.node, EventV2Bridge.node, SessionProjector.node, InstanceStore.node, CrossSpawnSpawner.node]),
  [[InstanceBootstrap.node, Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))]],
)
const deps = Layer.mergeAll(sessionLayer, summary)
const env = Layer.mergeAll(
  deps,
  SessionSummaryScheduler.layer.pipe(Layer.provide(sessionLayer), Layer.provideMerge(deps)),
)

const it = testEffect(env)

function settleBus() {
  return Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
}

function waitFor(check: () => boolean, timeout = 250) {
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

describe("SessionSummaryScheduler", () => {
  test("foreground helper does not create state for missing sessions", () => {
    const sessionID = SessionID.descending()
    const sessions = new Map<SessionID, { closed: boolean }>()
    const state = { foregroundCount: 0, sessions }

    applyForegroundStart(state, sessionID)
    const scheduled = applyForegroundFinish(state, sessionID)

    expect(state.foregroundCount).toBe(0)
    expect(scheduled).toBe(true)
    expect(Array.from(sessions.keys())).toEqual([])
  })

  test("foreground helper only updates existing session state", () => {
    const sessionID = SessionID.descending()
    const current = { closed: true }
    const sessions = new Map<SessionID, { closed: boolean }>([[sessionID, current]])
    const state = { foregroundCount: 0, sessions }

    applyForegroundStart(state, sessionID)
    expect(state.foregroundCount).toBe(1)
    expect(current.closed).toBe(false)
    expect(Array.from(sessions.entries())).toEqual([[sessionID, current]])

    const scheduled = applyForegroundFinish(state, sessionID)

    expect(state.foregroundCount).toBe(0)
    expect(scheduled).toBe(true)
    expect(current.closed).toBe(true)
    expect(Array.from(sessions.entries())).toEqual([[sessionID, current]])
  })

  const sessionGetError = Layer.mock(Session.Service)({
    get: () => Effect.die(new Error("session lookup crashed")),
  })
  const sessionGetErrorEnv = Layer.mergeAll(
    eventLayer,
    summary,
    sessionGetError,
    SessionSummaryScheduler.layer.pipe(
      Layer.provide(summary),
      Layer.provide(eventLayer),
      Layer.provide(sessionGetError),
    ),
  )
  const errorIt = testEffect(Layer.mergeAll(LayerNode.compile(CrossSpawnSpawner.node), sessionGetErrorEnv))

  it.live("markDirty automatically runs summarize without manual flush", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        state.calls.length = 0
        state.failures = 0
        const scheduler = yield* SessionSummaryScheduler.Service
        const sessionID = SessionID.descending()
        const messageID = MessageID.ascending()

        yield* scheduler.markDirty({ sessionID, messageID, version: 1 })
        yield* waitFor(() => state.calls.length === 1)

        expect(state.calls).toEqual([{ sessionID, messageID }])
      }),
    ),
  )

  it.live("repeated dirty marks only schedule one summary run", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        state.calls.length = 0
        state.failures = 0
        const scheduler = yield* SessionSummaryScheduler.Service
        const sessionID = SessionID.descending()
        const first = MessageID.ascending()
        const second = MessageID.ascending()
        const third = MessageID.ascending()

        yield* scheduler.markDirty({ sessionID, messageID: first, version: 1 })
        yield* scheduler.markDirty({ sessionID, messageID: second, version: 2 })
        yield* scheduler.markDirty({ sessionID, messageID: third, version: 3 })
        yield* scheduler.flush()

        expect(state.calls).toEqual([{ sessionID, messageID: third }])
      }),
    ),
  )

  it.live("session removal clears pending summary work without calling scheduler.deleteSession", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        state.calls.length = 0
        state.failures = 0
        const scheduler = yield* SessionSummaryScheduler.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create()

        yield* scheduler.foregroundStart(session.id)
        yield* scheduler.markDirty({
          sessionID: session.id,
          messageID: MessageID.ascending(),
          version: 1,
        })
        yield* sessions.remove(session.id)
        yield* scheduler.foregroundFinish(session.id)
        yield* settleBus()

        expect(state.calls).toEqual([])
      }),
    ),
  )

  it.live("foreground work gates scheduling until foreground finish", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        state.calls.length = 0
        state.failures = 0
        const events = yield* EventV2Bridge.Service
        const scheduler = yield* SessionSummaryScheduler.Service
        const sessions = yield* Session.Service
        const statuses: string[] = []
        const session = yield* sessions.create()
        const sessionID = session.id

        const off = yield* subscribeCallback(events, Session.Event.DiffStatus, (event) => {
          statuses.push(event.properties.status)
        })

        yield* scheduler.foregroundStart(sessionID)
        yield* scheduler.markDirty({
          sessionID,
          messageID: MessageID.ascending(),
          version: 1,
        })
        yield* scheduler.flush()
        yield* settleBus()

        expect(state.calls).toEqual([])
        expect(statuses).toEqual([])

        yield* scheduler.foregroundFinish(sessionID)
        yield* settleBus()
        expect(statuses).toEqual(["scheduled"])

        yield* scheduler.flush()
        yield* settleBus()
        yield* off

        expect(state.calls).toHaveLength(1)
        expect(statuses).toEqual(["scheduled", "running", "idle"])
      }),
    ),
  )

  it.live("invisible sessions stay idle until visibility is restored", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        state.calls.length = 0
        state.failures = 0
        const scheduler = yield* SessionSummaryScheduler.Service
        const sessionID = SessionID.descending()
        const messageID = MessageID.ascending()

        yield* scheduler.syncVisible([])
        yield* scheduler.markDirty({ sessionID, messageID, version: 1 })
        yield* settleBus()
        expect(state.calls).toEqual([])

        yield* scheduler.syncVisible([sessionID])
        yield* waitFor(() => state.calls.length === 1)

        expect(state.calls).toEqual([{ sessionID, messageID }])
      }),
    ),
  )

  it.live("deleteSession drops pending summary work", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        state.calls.length = 0
        state.failures = 0
        const scheduler = yield* SessionSummaryScheduler.Service
        const sessionID = SessionID.descending()

        yield* scheduler.markDirty({
          sessionID,
          messageID: MessageID.ascending(),
          version: 1,
        })
        yield* scheduler.deleteSession(sessionID)
        yield* scheduler.flush()

        expect(state.calls).toEqual([])
      }),
    ),
  )

  it.live("rerun stays hidden until foreground finish when overlap happens during running summarize", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        state.calls.length = 0
        state.failures = 0
        const gate = {
          started: Promise.withResolvers<void>(),
          release: Promise.withResolvers<void>(),
        }
        state.pauseNext = gate

        const events = yield* EventV2Bridge.Service
        const scheduler = yield* SessionSummaryScheduler.Service
        const sessions = yield* Session.Service
        const statuses: string[] = []
        const session = yield* sessions.create()
        const sessionID = session.id
        const first = MessageID.ascending()
        const second = MessageID.ascending()

        const off = yield* subscribeCallback(events, Session.Event.DiffStatus, (event) => {
          statuses.push(event.properties.status)
        })

        yield* scheduler.markDirty({ sessionID, messageID: first, version: 1 })
        const flush = yield* scheduler.flush().pipe(Effect.forkScoped)
        yield* Effect.promise(() => gate.started.promise)

        yield* scheduler.markDirty({ sessionID, messageID: second, version: 2 })
        yield* scheduler.foregroundStart(sessionID)
        gate.release.resolve()
        yield* Fiber.join(flush)
        yield* settleBus()

        expect(state.calls).toEqual([{ sessionID, messageID: first }])
        expect(statuses).toEqual(["scheduled", "running"])

        yield* scheduler.flush()
        yield* settleBus()
        expect(state.calls).toEqual([{ sessionID, messageID: first }])
        expect(statuses).toEqual(["scheduled", "running"])

        yield* scheduler.foregroundFinish(sessionID)
        yield* settleBus()
        expect(statuses).toEqual(["scheduled", "running", "scheduled"])

        yield* scheduler.flush()
        yield* settleBus()
        yield* off

        expect(state.calls).toEqual([
          { sessionID, messageID: first },
          { sessionID, messageID: second },
        ])
        expect(statuses).toEqual(["scheduled", "running", "scheduled", "running", "idle"])
      }),
    ),
  )

  it.live("failed summarize does not emit idle and later dirty work can flush successfully", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        state.calls.length = 0
        state.failures = 1
        state.pauseNext = undefined
        const events = yield* EventV2Bridge.Service
        const scheduler = yield* SessionSummaryScheduler.Service
        const sessions = yield* Session.Service
        const statuses: string[] = []
        const session = yield* sessions.create()
        const sessionID = session.id
        const messageID = MessageID.ascending()

        const off = yield* subscribeCallback(events, Session.Event.DiffStatus, (event) => {
          statuses.push(event.properties.status)
        })

        yield* scheduler.markDirty({ sessionID, messageID, version: 1 })
        const first = yield* scheduler.flush().pipe(Effect.exit)
        yield* settleBus()

        expect(Exit.isFailure(first)).toBe(true)
        expect(state.calls).toEqual([{ sessionID, messageID }])
        expect(statuses).toEqual(["scheduled", "running", "failed"])

        yield* scheduler.markDirty({ sessionID, messageID, version: 2 })
        const second = yield* scheduler.flush().pipe(Effect.exit)
        yield* settleBus()
        yield* off

        expect(Exit.isSuccess(second)).toBe(true)
        expect(state.calls).toEqual([
          { sessionID, messageID },
          { sessionID, messageID },
        ])
        expect(statuses).toEqual(["scheduled", "running", "failed", "scheduled", "running", "idle"])
      }),
    ),
  )

  it.live("failed summarize retries automatically without another flush", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        state.calls.length = 0
        state.writes.length = 0
        state.failures = 1
        state.pauseNext = undefined
        const events = yield* EventV2Bridge.Service
        const scheduler = yield* SessionSummaryScheduler.Service
        const sessions = yield* Session.Service
        const statuses: string[] = []
        const session = yield* sessions.create()
        const sessionID = session.id
        const messageID = MessageID.ascending()

        const off = yield* subscribeCallback(events, Session.Event.DiffStatus, (event) => {
          statuses.push(event.properties.status)
        })

        yield* scheduler.markDirty({ sessionID, messageID, version: 1 })
        yield* waitFor(() => state.calls.length === 2, 1500)
        yield* settleBus()
        yield* off

        expect(state.calls).toEqual([
          { sessionID, messageID },
          { sessionID, messageID },
        ])
        expect(statuses).toEqual(["scheduled", "running", "failed", "scheduled", "running", "idle"])
      }),
    ),
  )

  it.live("running summarize discards writeback after real session deletion", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        state.calls.length = 0
        state.writes.length = 0
        state.failures = 0
        const gate = {
          started: Promise.withResolvers<void>(),
          release: Promise.withResolvers<void>(),
        }
        state.pauseNext = gate

        const events = yield* EventV2Bridge.Service
        const scheduler = yield* SessionSummaryScheduler.Service
        const sessions = yield* Session.Service
        const statuses: string[] = []
        const session = yield* sessions.create()
        const messageID = MessageID.ascending()

        const off = yield* subscribeCallback(events, Session.Event.DiffStatus, (event) => {
          if (event.properties.sessionID === session.id) {
            statuses.push(event.properties.status)
          }
        })

        yield* scheduler.markDirty({ sessionID: session.id, messageID, version: 1 })
        yield* Effect.promise(() => gate.started.promise)
        yield* sessions.remove(session.id)
        gate.release.resolve()
        yield* Effect.sleep("20 millis")
        yield* settleBus()
        yield* off

        expect(state.calls).toEqual([{ sessionID: session.id, messageID }])
        expect(state.writes).toEqual([])
        expect(statuses).toEqual(["scheduled", "running", "deleted"])
      }),
    ),
  )

  it.live("hiding a running summarize drops the result until visibility returns", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        state.calls.length = 0
        state.writes.length = 0
        state.failures = 0
        const gate = {
          started: Promise.withResolvers<void>(),
          release: Promise.withResolvers<void>(),
        }
        state.pauseNext = gate

        const events = yield* EventV2Bridge.Service
        const scheduler = yield* SessionSummaryScheduler.Service
        const sessions = yield* Session.Service
        const statuses: string[] = []
        const session = yield* sessions.create()
        const messageID = MessageID.ascending()

        const off = yield* subscribeCallback(events, Session.Event.DiffStatus, (event) => {
          if (event.properties.sessionID === session.id) {
            statuses.push(event.properties.status)
          }
        })

        yield* scheduler.syncVisible([session.id])
        yield* scheduler.markDirty({ sessionID: session.id, messageID, version: 1 })
        yield* Effect.promise(() => gate.started.promise)

        yield* scheduler.syncVisible([])
        gate.release.resolve()
        yield* settleBus()

        expect(state.calls).toEqual([{ sessionID: session.id, messageID }])
        expect(state.writes).toEqual([])
        expect(statuses).toEqual(["scheduled", "running"])

        yield* scheduler.syncVisible([session.id])
        yield* waitFor(() => state.calls.length === 2)
        yield* settleBus()
        yield* off

        expect(state.calls).toEqual([
          { sessionID: session.id, messageID },
          { sessionID: session.id, messageID },
        ])
        expect(state.writes).toEqual([{ sessionID: session.id, messageID }])
        expect(statuses).toEqual(["scheduled", "running", "scheduled", "running", "idle"])
      }),
    ),
  )

  errorIt.live("unexpected post-summarize session lookup errors publish failed status and stay visible", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        state.calls.length = 0
        state.writes.length = 0
        state.failures = 0
        const gate = {
          started: Promise.withResolvers<void>(),
          release: Promise.withResolvers<void>(),
          skipCanWrite: true,
        }
        state.pauseNext = gate

        const events = yield* EventV2Bridge.Service
        const scheduler = yield* SessionSummaryScheduler.Service
        const sessionID = SessionID.descending()
        const messageID = MessageID.ascending()
        const statuses: string[] = []

        const off = yield* subscribeCallback(events, Session.Event.DiffStatus, (event) => {
          if (event.properties.sessionID === sessionID) statuses.push(event.properties.status)
        })

        yield* scheduler.syncVisible([sessionID])
        yield* scheduler.markDirty({ sessionID, messageID, version: 1 })
        const flush = yield* scheduler.flush().pipe(Effect.forkScoped)
        yield* Effect.promise(() => gate.started.promise)
        yield* scheduler.syncVisible([])
        gate.release.resolve()

        const exit = yield* Fiber.join(flush).pipe(Effect.exit)
        yield* settleBus()
        yield* off

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(Cause.pretty(exit.cause)).toContain("session lookup crashed")
        }
        expect(state.calls).toEqual([{ sessionID, messageID }])
        expect(state.writes).toEqual([])
        expect(statuses).toEqual(["scheduled", "running", "failed"])
      }),
    ),
  )
})
