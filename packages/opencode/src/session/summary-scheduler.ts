import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { InstanceState } from "@/effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { NotFoundError } from "@/storage/storage"
import { Context, Effect, Exit, Layer, Queue, Scope, Stream } from "effect"
import { MessageID, SessionID } from "./schema"
import { applyForegroundFinish, applyForegroundStart } from "./summary-scheduler-foreground"
import { SessionSummary } from "./summary"
import * as Session from "./session"

type SessionState = {
  // deleted is terminal. running and scheduled are mutually exclusive.
  // dirty means there is work newer than the last completed run, including a failed run queued for retry.
  dirty: boolean
  scheduled: boolean
  running: boolean
  rerunNeeded: boolean
  closed: boolean
  deleted: boolean
  version: number
  runVersion: number
  guardVersion: number
  messageID?: MessageID
}

type State = {
  foregroundCount: number
  backgroundRunning: boolean
  visibilityReady: boolean
  sessions: Map<SessionID, SessionState>
  visible: Set<SessionID>
  wake: Queue.Queue<void>
  scope: Scope.Scope
}

const RETRY_DELAY = "250 millis"

export interface Interface {
  readonly markDirty: (input: { sessionID: SessionID; messageID: MessageID; version: number }) => Effect.Effect<void>
  readonly foregroundStart: (sessionID: SessionID) => Effect.Effect<void>
  readonly foregroundFinish: (sessionID: SessionID) => Effect.Effect<void>
  readonly syncVisible: (sessionIDs: readonly SessionID[]) => Effect.Effect<void>
  readonly deleteSession: (sessionID: SessionID) => Effect.Effect<void>
  readonly flush: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionSummaryScheduler") {}

function getSession(state: State, sessionID: SessionID) {
  const existing = state.sessions.get(sessionID)
  if (existing) return existing
  const created: SessionState = {
    dirty: false,
    scheduled: false,
    running: false,
    rerunNeeded: false,
    closed: true,
    deleted: false,
    version: 0,
    runVersion: 0,
    guardVersion: 0,
  }
  state.sessions.set(sessionID, created)
  return created
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const sessions = yield* Session.Service
    const summary = yield* SessionSummary.Service

    const publishStatus = Effect.fn("SessionSummaryScheduler.publishStatus")(function* (
      sessionID: SessionID,
      status: Session.DiffStatus,
      message: string,
    ) {
      yield* events.publish(Session.Event.DiffStatus, { sessionID, status, message })
    })

    const isVisible = (data: State, sessionID: SessionID) => !data.visibilityReady || data.visible.has(sessionID)

    const signal = Effect.fn("SessionSummaryScheduler.signal")(function* (data: State) {
      yield* Queue.offer(data.wake, undefined)
    })

    const scheduleSession = Effect.fn("SessionSummaryScheduler.scheduleSession")(function* (
      data: State,
      sessionID: SessionID,
      current: SessionState,
    ) {
      if (data.foregroundCount > 0) return false
      if (current.deleted || current.running || current.scheduled || !current.dirty || !current.messageID) return false
      if (!isVisible(data, sessionID)) return false
      current.scheduled = true
      yield* publishStatus(sessionID, "scheduled", "Summary refresh scheduled")
      return true
    })

    const scheduleDirty = Effect.fn("SessionSummaryScheduler.scheduleDirty")(function* (data: State) {
      let scheduled = false
      for (const [sessionID, current] of data.sessions) {
        if (yield* scheduleSession(data, sessionID, current)) scheduled = true
      }
      return scheduled
    })

    const deleteSessionState = Effect.fn("SessionSummaryScheduler.deleteSessionState")(function* (
      data: State,
      sessionID: SessionID,
    ) {
      const current = getSession(data, sessionID)
      current.deleted = true
      current.closed = true
      current.dirty = false
      current.scheduled = false
      current.running = false
      current.rerunNeeded = false
      current.messageID = undefined
      data.visible.delete(sessionID)
      yield* publishStatus(sessionID, "deleted", "Summary refresh discarded")
    })

    const scheduleRetry = Effect.fn("SessionSummaryScheduler.scheduleRetry")(function* (
      data: State,
      sessionID: SessionID,
      current: SessionState,
    ) {
      if (current.deleted) return
      yield* Effect.gen(function* () {
        yield* Effect.sleep(RETRY_DELAY)
        if (yield* scheduleSession(data, sessionID, current)) {
          yield* signal(data)
        }
      }).pipe(Effect.forkIn(data.scope))
    })

    const flushState = Effect.fn("SessionSummaryScheduler.flushState")(function* (data: State) {
      while (true) {
        if (data.foregroundCount > 0 || data.backgroundRunning) return

        const next = Array.from(data.sessions.entries()).find(([sessionID, current]) => {
          return (
            current.scheduled &&
            !current.deleted &&
            !current.running &&
            !!current.messageID &&
            isVisible(data, sessionID)
          )
        })
        if (!next) return

        const [sessionID, current] = next
        const messageID = current.messageID!
        current.scheduled = false
        current.running = true
        current.dirty = false
        current.rerunNeeded = false
        current.runVersion = current.version
        data.backgroundRunning = true
        const runVersion = current.runVersion
        const runMessageID = messageID
        const runGuardVersion = current.guardVersion
        const canWrite = () =>
          sessions.get(sessionID).pipe(
            Effect.map(
              () =>
                !current.deleted &&
                current.guardVersion === runGuardVersion &&
                current.version === runVersion &&
                current.runVersion === runVersion &&
                current.messageID === runMessageID,
            ),
            Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(false)),
          )

        yield* publishStatus(sessionID, "running", "Summary refresh in progress")

        const exit = yield* Effect.gen(function* () {
          yield* summary.summarize({
            sessionID,
            messageID,
            canWrite,
          })
          return yield* canWrite()
        }).pipe(Effect.exit)

        current.running = false
        data.backgroundRunning = false

        if (Exit.isFailure(exit)) {
          if (!current.deleted) {
            current.dirty = true
            current.scheduled = false
            current.rerunNeeded = false
            yield* publishStatus(sessionID, "failed", "Summary refresh failed")
            if (data.foregroundCount === 0 && isVisible(data, sessionID)) {
              yield* scheduleRetry(data, sessionID, current)
            }
          }
          return yield* Effect.failCause(exit.cause)
        }

        const writeAllowed = exit.value

        if (!current.deleted && (current.rerunNeeded || current.dirty || current.version > current.runVersion)) {
          current.rerunNeeded = false
          yield* scheduleSession(data, sessionID, current)
        } else if (!current.deleted && writeAllowed) {
          yield* publishStatus(sessionID, "idle", "Summary refresh complete")
        }
      }
    })

    const state = yield* InstanceState.make<State>(
      Effect.fn("SessionSummaryScheduler.state")(function* (_ctx) {
        const wake = yield* Queue.unbounded<void>()
        const scope = yield* Scope.Scope
        const data: State = {
          foregroundCount: 0,
          backgroundRunning: false,
          visibilityReady: false,
          sessions: new Map<SessionID, SessionState>(),
          visible: new Set<SessionID>(),
          wake,
          scope,
        }

        yield* Effect.addFinalizer(() => Queue.shutdown(wake))

        const unsubscribe = yield* events.listen((event) => {
          if (event.type !== Session.Event.Deleted.type) return Effect.void
          return deleteSessionState(data, (event.data as { sessionID: SessionID }).sessionID)
        })
        yield* Effect.addFinalizer(() => unsubscribe)

        yield* Stream.fromQueue(wake).pipe(
          Stream.runForEach(() =>
            Effect.sleep("1 millis").pipe(Effect.andThen(flushState(data).pipe(Effect.catchCause(() => Effect.void)))),
          ),
          Effect.forkScoped,
        )

        return data
      }),
    )

    const markDirty = Effect.fn("SessionSummaryScheduler.markDirty")(function* (input: {
      sessionID: SessionID
      messageID: MessageID
      version: number
    }) {
      const data = yield* InstanceState.get(state)
      const current = getSession(data, input.sessionID)
      if (current.deleted) return

      current.dirty = true
      current.closed = false
      if (input.version >= current.version) {
        current.version = input.version
        current.messageID = input.messageID
      }

      if (current.running) {
        current.rerunNeeded = true
        return
      }

      if (yield* scheduleSession(data, input.sessionID, current)) {
        yield* signal(data)
      }
    })

    const foregroundStart = Effect.fn("SessionSummaryScheduler.foregroundStart")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      applyForegroundStart(data, sessionID)
    })

    const foregroundFinish = Effect.fn("SessionSummaryScheduler.foregroundFinish")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      if (applyForegroundFinish(data, sessionID)) {
        yield* scheduleDirty(data)
        yield* signal(data)
      }
    })

    const syncVisible = Effect.fn("SessionSummaryScheduler.syncVisible")(function* (sessionIDs: readonly SessionID[]) {
      const data = yield* InstanceState.get(state)
      const nextVisible = new Set(sessionIDs)
      for (const [sessionID, current] of data.sessions) {
        if (isVisible(data, sessionID) && !nextVisible.has(sessionID) && current.running) {
          current.guardVersion += 1
          current.dirty = true
        }
      }
      data.visibilityReady = true
      data.visible.clear()
      for (const sessionID of sessionIDs) {
        data.visible.add(sessionID)
      }
      yield* scheduleDirty(data)
      yield* signal(data)
    })

    const deleteSession = Effect.fn("SessionSummaryScheduler.deleteSession")(function* (sessionID: SessionID) {
      const data = yield* InstanceState.get(state)
      yield* deleteSessionState(data, sessionID)
    })

    const flush = Effect.fn("SessionSummaryScheduler.flush")(function* () {
      const data = yield* InstanceState.get(state)
      yield* flushState(data)
    })

    return Service.of({
      markDirty,
      foregroundStart,
      foregroundFinish,
      syncVisible,
      deleteSession,
      flush,
    })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(Layer.provide(AppNodeBuilder.build(SessionSummary.node)), Layer.provide(AppNodeBuilder.build(EventV2Bridge.node))),
)

export * as SessionSummaryScheduler from "./summary-scheduler"
