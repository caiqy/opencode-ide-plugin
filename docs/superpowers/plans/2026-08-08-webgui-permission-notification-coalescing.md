# WebGUI Permission Notification Coalescing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send one system notification while a session has one or more unresolved permission requests, then allow a new notification after all of them are resolved.

**Architecture:** Keep notification coalescing in `MessagesContext`, which owns permission request events and resolution state. Reuse the existing request-ID-to-session map: notify only when a new request is the first tracked request for its session, record every request, and reconcile the map on replies, successful local responses, reconnect snapshots, and session deletion.

**Tech Stack:** React 19, TypeScript 5.9, Vitest 4, Testing Library

## Global Constraints

- Do not change question, session-completion, notification text, or IDE bridge behavior.
- Preserve foreground and unavailable-bridge suppression without delayed replay.
- Do not add dependencies, timers, protocol fields, or a second permission-state index.
- Run tests from `packages/opencode/webgui`, never from the repository root.
- Use the vfox-managed Bun version.
- Do not commit unless the user explicitly requests it.

---

### Task 1: Coalesce Pending Permission Notifications Per Session

**Files:**
- Modify: `packages/opencode/webgui/src/state/MessagesContext.tsx:46-76, 981-1003, 1082-1098, 1241-1260`
- Test: `packages/opencode/webgui/src/state/MessagesContext.questions.test.tsx:145-191, 639-686`

**Interfaces:**
- Consumes: `notifiedPermissionsRef: React.MutableRefObject<Map<string, string>>`, keyed by permission request ID with session ID values.
- Produces: unchanged `sendIdeNotification("permission", sessionID, currentSessionID, detail)` calls, limited to the first unresolved permission in each session.

- [ ] **Step 1: Expand the permission notification test to reproduce concurrent distinct requests**

Replace the existing `同一权限请求只通知一次，回复后释放去重 ID` test with:

```tsx
it("同一会话的待处理权限只通知一次，清空后恢复通知", async () => {
  const emitter = new EventEmitter()
  mocks.bridgeInstalled.mockReturnValue(true)
  mount(emitter)

  await act(async () => {
    emitter.emit(permissionAsked("p1"))
    emitter.emit(permissionAsked("p1"))
    emitter.emit(permissionAsked("p2"))
    emitter.emit(permissionAsked("other", "s2"))
  })
  expect(mocks.bridgeSend).toHaveBeenCalledTimes(2)
  expect(mocks.bridgeSend).toHaveBeenNthCalledWith(1, {
    type: "showSystemNotification",
    payload: { sessionID: "s1", title: "Agent needs permission", body: "edit" },
  })
  expect(mocks.bridgeSend).toHaveBeenNthCalledWith(2, {
    type: "showSystemNotification",
    payload: { sessionID: "s2", title: "Agent needs permission", body: "edit" },
  })

  await act(async () => {
    emitter.emit({
      type: "permission.replied",
      properties: { sessionID: "s1", requestID: "p1", reply: "once" },
    } as ServerEvent)
    emitter.emit(permissionAsked("p3"))
  })
  expect(mocks.bridgeSend).toHaveBeenCalledTimes(2)

  await act(async () => {
    emitter.emit({
      type: "permission.replied",
      properties: { sessionID: "s1", requestID: "p2", reply: "once" },
    } as ServerEvent)
    emitter.emit({
      type: "permission.replied",
      properties: { sessionID: "s1", requestID: "p3", reply: "once" },
    } as ServerEvent)
    emitter.emit(permissionAsked("p4"))
  })
  expect(mocks.bridgeSend).toHaveBeenCalledTimes(3)
})
```

- [ ] **Step 2: Run the focused test and verify the current implementation fails**

Run from `packages/opencode/webgui`:

```bash
bun run test:run -- src/state/MessagesContext.questions.test.tsx
```

Expected: FAIL in `同一会话的待处理权限只通知一次，清空后恢复通知` because the current request-ID-only deduplication sends notifications for both `p1` and `p2`.

- [ ] **Step 3: Implement the minimum session-level pending check**

Replace the `first` calculation and notification condition in `handlePermissionAsked` with:

```tsx
const firstForSession =
  !notifiedPermissionsRef.current.has(perm.id) &&
  ![...notifiedPermissionsRef.current.values()].includes(perm.sessionID)
// ponytail: pending permission counts are tiny; add a session index only if this becomes hot.
notifiedPermissionsRef.current.set(perm.id, perm.sessionID)
if (firstForSession) {
  sendIdeNotification(
    "permission",
    perm.sessionID,
    session.currentSession?.id ?? null,
    typeof perm.metadata?.title === "string" ? perm.metadata.title : perm.permission,
  )
}
```

Keep the existing `handlePermissionReplied` and `handleSessionDeletedNotification` cleanup. Also delete the request ID after a successful local response, then reconcile successful permission snapshots with the notification map:

```tsx
function mergePendingNotificationRequests(
  current: Map<string, string>,
  snapshot: PermissionRequest[],
  touched: Record<string, number>,
) {
  const incoming = new Map(snapshot.map((item) => [item.id, item.sessionID]))
  return new Map([
    ...[...current].filter(([id]) => incoming.has(id) || (touched[`permission:${id}`] ?? 0) > 0),
    ...[...incoming].filter(([id]) => (touched[`permission:${id}`] ?? 0) === 0 || current.has(id)),
  ])
}
```

The first filter retains requests confirmed by the snapshot or changed after hydration began. The second adds snapshot-only requests without notifying and ignores stale snapshot rows already removed by a newer reply.

- [ ] **Step 4: Run the focused test and verify it passes**

Run from `packages/opencode/webgui`:

```bash
bun run test:run -- src/state/MessagesContext.questions.test.tsx
```

Expected: the test file passes with zero failures.

- [ ] **Step 5: Run WebGUI regression verification**

Run from `packages/opencode/webgui`:

```bash
bun run test:run
bun run build
```

Expected: both commands exit 0. The full Vitest suite has zero failures, and the TypeScript/Vite production build completes successfully.
