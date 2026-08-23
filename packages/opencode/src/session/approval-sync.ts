import { Approval } from "@opencode-ai/core/approval"
import { ApprovalV1 } from "@opencode-ai/core/v1/approval"
import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Effect } from "effect"
import type { SessionID } from "./schema"
import type { Session } from "./session"

type Permission = PermissionV1.Ruleset | ((session: Session.Info) => PermissionV1.Ruleset)

const isRestricting: (
  sessions: Session.Interface,
  sessionID: SessionID,
  ignoredRestriction?: object,
) => Effect.Effect<boolean> = Effect.fnUntraced(function* (sessions, sessionID, ignoredRestriction) {
  if (Approval.runtime.isRestricting(sessionID, ignoredRestriction)) return true
  const session = yield* sessions.get(sessionID).pipe(Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)))
  if (Approval.runtime.isRestricting(sessionID, ignoredRestriction)) return true
  if (session?.permission && ApprovalV1.isTransitioning(session.permission)) return true
  if (!session?.parentID) return false
  if (yield* isRestricting(sessions, session.parentID, ignoredRestriction)) return true
  return Approval.runtime.isRestricting(sessionID, ignoredRestriction)
})

const canSettle = (sessions: Session.Interface, sessionID: SessionID) =>
  sessions.get(sessionID).pipe(
    Effect.flatMap((session) =>
      session.parentID
        ? isRestricting(sessions, session.parentID).pipe(Effect.map((value) => !value))
        : Effect.succeed(true),
    ),
    Effect.catchTag("NotFoundError", () => Effect.succeed(true)),
  )

export const setRuntimeApproval = Effect.fn("SessionApproval.setRuntime")(function* (input: {
  sessions: Session.Interface
  sessionID: SessionID
  approval: ApprovalV1.Mode
}) {
  const changed =
    Approval.runtime.get(input.sessionID) !== input.approval || Approval.runtime.isCleared(input.sessionID)
  if (input.approval === "full" && changed) {
    yield* Approval.runtime.drain(input.sessionID, canSettle(input.sessions, input.sessionID))
  }
  if (changed) Approval.runtime.set(input.sessionID, input.approval)
  if (input.approval === "full")
    yield* Approval.runtime.drain(input.sessionID, canSettle(input.sessions, input.sessionID))
})

export function syncApproval(input: {
  sessions: Session.Interface
  sessionID: SessionID
  approval?: ApprovalV1.Mode
  permissionApproval?: ApprovalV1.Mode
  persist?: boolean
  permission?: Permission
  locked?: boolean
}) {
  const ruleset = (current: Session.Info, permission?: Permission) => {
    if (typeof permission === "function") return ApprovalV1.withoutTransition(permission(current))
    if (permission) return ApprovalV1.withoutTransition(permission)
    const approval = input.permissionApproval ?? input.approval
    if (approval) return ApprovalV1.withoutTransition(ApprovalV1.withRuleset(current.permission ?? [], approval))
    return ApprovalV1.withoutTransition(
      (current.permission ?? []).filter((rule) => rule.permission !== ApprovalV1.RulePermission),
    )
  }
  // `locked` means the caller holds sessionID; recursive acquisition remains parent-to-child.
  const visit: (
    sessionID: SessionID,
    permission?: Permission,
    root?: boolean,
    skipPersistence?: boolean,
  ) => Effect.Effect<SessionID[]> = Effect.fn("SessionApproval.sync")(
    function* (sessionID, permission, root, skipPersistence) {
      const update = Effect.gen(function* () {
        const current = yield* input.sessions.get(sessionID).pipe(
          Effect.map((session) => session as Session.Info | undefined),
          Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)),
        )
        if (!current) return []
        const hasApproval =
          Approval.runtime.get(sessionID) !== undefined ||
          current.permission?.some((rule) => rule.permission === ApprovalV1.RulePermission) ||
          ApprovalV1.isTransitioning(current.permission ?? [])
        if (input.approval !== "full") {
          if (input.approval)
            yield* setRuntimeApproval({ sessions: input.sessions, sessionID, approval: input.approval })
          else Approval.runtime.clear(sessionID)
        }
        if (input.persist !== false && !skipPersistence) {
          yield* input.sessions.setPermission({ sessionID, permission: ruleset(current, permission) })
        }
        if (input.approval === "full")
          yield* setRuntimeApproval({ sessions: input.sessions, sessionID, approval: input.approval })
        if (root && input.persist !== false && input.approval === undefined && !hasApproval) return [sessionID]
        const children = yield* input.sessions.children(sessionID)
        const descendants = yield* Effect.forEach(children, (child) => visit(child.id))
        return [sessionID, ...descendants.flat()]
      })
      return yield* root ? update : Approval.runtime.withUpdate(sessionID)(update)
    },
  )

  const finalizeFull: (
    sessionID: SessionID,
    restriction: object,
    root?: boolean,
  ) => Effect.Effect<ReadonlyArray<readonly [SessionID, number, number]>> = Effect.fn("SessionApproval.finalizeFull")(
    function* (sessionID, restriction, root) {
      const finalize = Effect.gen(function* () {
        const current = yield* input.sessions.get(sessionID).pipe(
          Effect.map((session) => session as Session.Info | undefined),
          Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)),
        )
        if (!current) return []
        if (
          Approval.runtime.get(sessionID) !== "full" ||
          Approval.runtime.isRestricting(sessionID, restriction) ||
          ApprovalV1.isTransitioning(current.permission ?? [])
        )
          return []
        yield* Approval.runtime.drain(
          sessionID,
          isRestricting(input.sessions, sessionID, restriction).pipe(Effect.map((value) => !value)),
          restriction,
        )
        const version = Approval.runtime.pendingRevision(sessionID)
        const children = yield* input.sessions.children(sessionID)
        const topology = Approval.runtime.topologyRevision(sessionID)
        const descendants = yield* Effect.forEach(children, (child) => finalizeFull(child.id, restriction))
        return [[sessionID, version, topology] as const, ...descendants.flat()]
      })
      return yield* root ? finalize : Approval.runtime.withUpdate(sessionID)(finalize)
    },
  )

  const finalizeFullStable: (restriction: object) => Effect.Effect<void> = Effect.fn(
    "SessionApproval.finalizeFullStable",
  )(function* (restriction) {
    while (true) {
      const versions = yield* finalizeFull(input.sessionID, restriction, true)
      const stable = versions.every(
        ([sessionID, pending, topology]) =>
          Approval.runtime.pendingRevision(sessionID) === pending &&
          Approval.runtime.topologyRevision(sessionID) === topology,
      )
      if (stable) return
    }
  })

  const sync = Effect.uninterruptible(
    Effect.gen(function* () {
      if (input.approval === "full" || input.persist === false)
        return yield* visit(input.sessionID, input.permission, true)
      const current = yield* input.sessions.get(input.sessionID).pipe(
        Effect.map((session) => session as Session.Info | undefined),
        Effect.catchTag("NotFoundError", () => Effect.succeed(undefined)),
      )
      if (!current) return yield* visit(input.sessionID, input.permission, true)
      const hasApproval =
        Approval.runtime.get(input.sessionID) !== undefined ||
        current.permission?.some((rule) => rule.permission === ApprovalV1.RulePermission) ||
        ApprovalV1.isTransitioning(current.permission ?? [])
      if (input.approval === undefined && !hasApproval) return yield* visit(input.sessionID, input.permission, true)
      const target = ruleset(current, input.permission)
      yield* input.sessions.setPermission({
        sessionID: input.sessionID,
        permission: ApprovalV1.withTransition(target),
      })
      const updated = yield* visit(input.sessionID, undefined, true, true)
      yield* input.sessions.setPermission({ sessionID: input.sessionID, permission: target })
      return updated
    }),
  )
  const fenced = Effect.uninterruptible(
    input.approval === "full"
      ? Approval.runtime.withRestrictionToken(input.sessionID, (restriction) =>
          sync.pipe(Effect.flatMap((updated) => finalizeFullStable(restriction).pipe(Effect.as(updated)))),
        )
      : Approval.runtime.withRestriction(input.sessionID, sync),
  )
  return input.locked ? fenced : Approval.runtime.withUpdate(input.sessionID)(fenced)
}
