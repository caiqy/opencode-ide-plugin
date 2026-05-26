import { Effect } from "effect"
import { SessionSummaryScheduler } from "@/session/summary-scheduler"
import type { SessionID } from "@/session/schema"

export { SessionPaths } from "./groups/session"

type ForegroundReadKind = "messages" | "diff"

let foregroundReadTestGate:
  | undefined
  | ((input: { kind: ForegroundReadKind; sessionID: SessionID }) => void | Promise<void>)

export function setForegroundReadTestGate(
  next?: (input: { kind: ForegroundReadKind; sessionID: SessionID }) => void | Promise<void>,
) {
  foregroundReadTestGate = next
}

export function withForegroundRead<A, E, R>(
  kind: ForegroundReadKind,
  sessionID: SessionID,
  fx: Effect.Effect<A, E, R | SessionSummaryScheduler.Service>,
) {
  return Effect.gen(function* () {
    const scheduler = yield* SessionSummaryScheduler.Service
    const gate = foregroundReadTestGate
      ? Effect.promise(() => Promise.resolve(foregroundReadTestGate?.({ kind, sessionID })))
      : Effect.void
    return yield* Effect.acquireUseRelease(
      scheduler.foregroundStart(sessionID),
      () => gate.pipe(Effect.andThen(fx)),
      () => scheduler.foregroundFinish(sessionID),
    )
  })
}
