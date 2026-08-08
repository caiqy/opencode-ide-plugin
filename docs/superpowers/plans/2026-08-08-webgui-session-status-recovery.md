# WebGUI Session Status Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make reconnect status authoritative so active sessions recover correctly while ended sessions stop all false running indicators and show stale incomplete work as interrupted.

**Architecture:** `SessionContext` is the only owner of session liveness. Message hydration merges historical content but never infers process activity. After a successful active-only status snapshot, the message UI reconciles incomplete historical parts at render time without mutating server data.

**Tech Stack:** React 19, TypeScript 5.9, Vitest 4, Testing Library, Tailwind CSS

## Global Constraints

- A successful `/session/status` response is an active-only snapshot; missing sessions are idle.
- `session.status` SSE events and newer local status writes must retain precedence over an older reconnect response.
- Do not mutate or persist historical messages to represent interruption.
- Do not add dependencies or edit generated SDK files.
- Run tests from `packages/opencode/webgui`, never from the repository root.
- Do not create a Git commit unless the user explicitly requests one.

---

### Task 1: Make Live Status Authoritative

**Files:**
- Modify: `packages/opencode/webgui/src/state/SessionContext.tsx`
- Modify: `packages/opencode/webgui/src/state/SessionContext.test.tsx`
- Modify: `packages/opencode/webgui/src/state/MessagesContext.tsx`
- Modify: `packages/opencode/webgui/src/state/MessagesContext.pagination.test.tsx`
- Modify: `packages/opencode/webgui/src/state/MessagesContext.selection-restore.test.tsx`

**Interfaces:**
- Produces: `SessionContextState.sessionStatusReady: boolean`
- Preserves: `setSessionIdle(sessionId: string, isIdle: boolean): void`
- Changes: `isSessionReasoning(sessionId)` is true only when the session is busy and has active reasoning.

- [ ] **Step 1: Add failing reconnect and reasoning-invariant tests**

Add a `SessionContext.test.tsx` case using the existing `wrapper`, `events`, `session`, and `waitFor` helpers:

```tsx
it("active-only reconnect snapshot clears missing session activity", async () => {
  ;(sdk.session.status as any).mockResolvedValueOnce({ data: {}, error: null })
  ;(sdk.session.get as any).mockResolvedValueOnce({ data: null, error: null })

  const { result } = renderHook(() => useSession(), { wrapper })
  await waitFor(() => expect(result.current.isLoading).toBe(false))

  await act(async () => {
    result.current.setSessionIdle("s1", false)
    result.current.setReasoning("s1", true)
  })
  expect(result.current.isSessionReasoning("s1")).toBe(true)

  await act(async () => {
    events.emit("server.connected", { type: "server.connected", properties: {} })
  })

  await waitFor(() => expect(result.current.sessionStatusReady).toBe(true))
  expect(result.current.isSessionIdle("s1")).toBe(true)
  expect(result.current.isSessionReasoning("s1")).toBe(false)
})
```

Extend the existing arbitrary-session state test with the idle invariant:

```tsx
await act(async () => ctx().setSessionIdle("s-child", true))
expect(ctx().isSessionReasoning("s-child")).toBe(false)
```

- [ ] **Step 2: Add a failing message-hydration ownership test**

Add to `MessagesContext.pagination.test.tsx` using the existing `page`, `api`, and `Capture` helpers:

```tsx
it("loadLatest does not infer live status from an incomplete assistant message", async () => {
  ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
    page(
      [
        {
          info: {
            id: "m-stale",
            sessionID: "s-stale",
            role: "assistant",
            time: { created: 1, completed: 0 },
          },
          parts: [],
        } as any,
      ],
      null,
    ),
  )

  render(
    <MessagesProvider>
      <Capture />
    </MessagesProvider>,
  )

  await act(async () => {
    await api!.loadLatest("s-stale")
  })

  expect(mocks.setSessionIdle).not.toHaveBeenCalled()
})
```

Update existing assertions that currently require `loadLatest` to call `setSessionIdle`; they must instead require no liveness write from message hydration.

- [ ] **Step 3: Run the focused tests and confirm failure**

Run from `packages/opencode/webgui`:

```powershell
bun run test:run -- src/state/SessionContext.test.tsx src/state/MessagesContext.pagination.test.tsx src/state/MessagesContext.selection-restore.test.tsx
```

Expected: failures because `sessionStatusReady` does not exist, missing snapshot entries stay busy, reasoning is not masked by idle, and `loadLatest` still calls `setSessionIdle`.

- [ ] **Step 4: Implement status ownership in `SessionContext`**

Add the context property and state:

```tsx
interface SessionContextState {
  // existing fields
  sessionStatusReady: boolean
}

const [sessionStatusReady, setSessionStatusReady] = useState(false)
```

Mask reasoning with the busy map:

```tsx
const isReasoning = currentSession?.id
  ? Boolean(busyMap[currentSession.id] && reasoningMap[currentSession.id])
  : false

const isSessionReasoning = useCallback(
  (sessionId: string) => {
    if (!sessionId) return false
    return Boolean(busyMap[sessionId] && reasoningMap[sessionId])
  },
  [busyMap, reasoningMap],
)
```

At the start of `handleServerConnected`, mark recovery pending:

```tsx
setSessionStatusReady(false)
```

For a successful snapshot, treat only non-idle entries as active and clear stale reasoning for untouched idle or missing sessions:

```tsx
setBusyMap((prev) => {
  const next = { ...prev }
  for (const id of new Set([...Object.keys(prev), ...snapshot.keys()])) {
    if (!unchanged(id)) continue
    const value = snapshot.get(id)
    if (value && value.type !== "idle") next[id] = true
    else delete next[id]
  }
  return next
})

setReasoningMap((prev) => {
  const next = { ...prev }
  for (const id of Object.keys(prev)) {
    if (!unchanged(id)) continue
    const value = snapshot.get(id)
    if (!value || value.type === "idle") delete next[id]
  }
  return next
})
```

After applying `busyMap`, `reasoningMap`, and `statusMap`, call:

```tsx
setSessionStatusReady(true)
```

Expose `sessionStatusReady` in the provider value. Leave it false when the status request fails or returns no data.

- [ ] **Step 5: Remove message-based liveness inference**

In `MessagesContext.tsx`, remove this binding:

```tsx
const setSessionIdle = session.setSessionIdle
```

Delete both blocks that find the latest message, inspect `time.completed`, and call `setSessionIdle`. Remove `setSessionIdle` from the `loadLatest` dependency list. Keep message merge and `syncSessionReasoningFromMessages` behavior unchanged.

- [ ] **Step 6: Run the focused tests and confirm pass**

Run:

```powershell
bun run test:run -- src/state/SessionContext.test.tsx src/state/MessagesContext.pagination.test.tsx src/state/MessagesContext.selection-restore.test.tsx
```

Expected: all selected tests pass.

---

### Task 2: Reconcile Interrupted UI Without Rewriting History

**Files:**
- Modify: `packages/opencode/webgui/src/components/CompactHeader/Tab.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/Tab.test.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/index.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/MessageRow.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/MessagePart.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/ReasoningPart.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/ReasoningPart.test.tsx`
- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/index.tsx`
- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/index.test.tsx`
- Modify: `packages/opencode/webgui/src/components/parts/ToolPart/ToolHeader.tsx`

**Interfaces:**
- Produces: optional `sessionInterrupted?: boolean` from `MessageList` through `MessageRow` and `MessagePart`.
- Produces: `ReasoningPart` optional prop `interrupted?: boolean`.
- Produces: `ToolPart` optional prop `interrupted?: boolean`.
- Produces: `ToolHeader` optional prop `interrupted?: boolean`.

- [ ] **Step 1: Add failing tab, reasoning, and tool tests**

Add to `Tab.test.tsx`:

```tsx
it("does not show a stale reasoning dot while idle", () => {
  const { container } = render(<Tab {...props({ isBusy: false, isReasoning: true })} />)
  expect(container.querySelector(".bg-purple-500")).toBeNull()
  expect(container.querySelector(".animate-pulse")).toBeNull()
})
```

Add to `ReasoningPart.test.tsx`:

```tsx
it("shows interrupted instead of thinking for an unfinished idle part", () => {
  render(
    <PartOpenProvider items={[]}>
      <ReasoningPart
        part={{ id: "r4", sessionID: "s1", messageID: "m1", type: "reasoning", text: "partial" }}
        interrupted
      />
    </PartOpenProvider>,
  )

  expect(screen.getByText("思考已中断")).toBeInTheDocument()
  expect(screen.queryByText("思考中…")).not.toBeInTheDocument()
})
```

Add to `ToolPart/index.test.tsx`:

```tsx
it("renders a stale running tool as interrupted without animation", () => {
  const { container } = render(
    <ToolPart
      sessionID="s1"
      messageID="m1"
      interrupted
      part={{
        id: "t-interrupted",
        type: "tool",
        callID: "c-interrupted",
        tool: "bash",
        state: { status: "running", input: { command: "sleep 10" } },
      }}
    />,
  )

  expect(screen.getByText("已中断")).toBeInTheDocument()
  expect(container.querySelector(".animate-pulse, .animate-spin")).toBeNull()
})
```

- [ ] **Step 2: Run the focused component tests and confirm failure**

Run:

```powershell
bun run test:run -- src/components/CompactHeader/Tab.test.tsx src/components/MessageList/ReasoningPart.test.tsx src/components/parts/ToolPart/index.test.tsx
```

Expected: failures because stale reasoning still renders a tab dot and interruption props/labels do not exist.

- [ ] **Step 3: Restrict the tab indicator to busy sessions**

In `Tab.tsx`, replace the indicator condition with:

```tsx
{isBusy && (
  <span
    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse ${isReasoning ? "bg-purple-500" : "bg-yellow-500"}`}
  />
)}
```

- [ ] **Step 4: Propagate confirmed interruption to message parts**

In `MessageList`, consume `sessionStatusReady` with its existing current-session `isIdle` value, then calculate:

```tsx
const sessionInterrupted = Boolean(sessionID && sessionStatusReady && isIdle)
```

Pass `sessionInterrupted` into every `MessageRow`. Add the optional prop to `MessageRow`, pass it into `MessagePart`, and add it to `MessagePartProps`.

For reasoning parts:

```tsx
return <ReasoningPart key={part.id} part={part} durationMs={durationMs} interrupted={sessionInterrupted} />
```

For tool parts:

```tsx
return (
  <ToolPart
    key={part.id}
    part={part as any}
    sessionID={sessionID}
    messageID={messageID}
    associatedPatch={associatedPatch}
    interrupted={sessionInterrupted}
  />
)
```

- [ ] **Step 5: Render interrupted reasoning and tools**

In `ReasoningPart.tsx`, add `interrupted?: boolean` and choose the label in this order:

```tsx
const label =
  durationMs !== undefined
    ? `思考了 ${Math.max(1, Math.floor(durationMs / 1000))} 秒`
    : interrupted
      ? "思考已中断"
      : "思考中…"
```

In `ToolPart/index.tsx`, add `interrupted?: boolean` and derive:

```tsx
const wasInterrupted = interrupted && (part.state.status === "pending" || part.state.status === "running")
```

Use `error` as the static display status without changing `part.state`:

```tsx
const displayStatus = wasInterrupted ? "error" : questionMode === "ignored" ? "completed" : part.state.status
```

Pass `interrupted={wasInterrupted}` to `ToolHeader`. Prevent interrupted pending tools from auto-expanding by treating `wasInterrupted` like a non-pending state in the existing effect.

In `ToolHeader.tsx`, add `interrupted?: boolean` and render a stable label beside the title/path:

```tsx
{interrupted && <span className="text-xs font-medium flex-shrink-0">已中断</span>}
```

The existing `error` icon and classes provide a static non-animated interrupted appearance.

- [ ] **Step 6: Run focused component tests and confirm pass**

Run:

```powershell
bun run test:run -- src/components/CompactHeader/Tab.test.tsx src/components/MessageList/ReasoningPart.test.tsx src/components/parts/ToolPart/index.test.tsx
```

Expected: all selected tests pass.

---

### Task 3: Verify the Integrated WebGUI Change

**Files:**
- Verify only; no planned source changes.

**Interfaces:**
- Consumes: `sessionStatusReady`, authoritative busy state, and display-only interruption props from Tasks 1 and 2.
- Produces: verification evidence for the complete change.

- [ ] **Step 1: Run all directly affected tests together**

Run from `packages/opencode/webgui`:

```powershell
bun run test:run -- src/state/SessionContext.test.tsx src/state/MessagesContext.pagination.test.tsx src/state/MessagesContext.selection-restore.test.tsx src/components/CompactHeader/Tab.test.tsx src/components/CompactHeader/TabBar.test.tsx src/components/MessageList/ReasoningPart.test.tsx src/components/MessageList/MessageRow.test.tsx src/components/parts/ToolPart/index.test.tsx src/components/parts/ToolPart/ToolHeader.test.tsx
```

Expected: all selected tests pass with zero failures.

- [ ] **Step 2: Run the WebGUI build**

Run:

```powershell
bun run build
```

Expected: TypeScript project build and Vite production build both exit successfully.

- [ ] **Step 3: Inspect the final diff**

Run from the repository root:

```powershell
git diff -- docs/superpowers/specs/2026-08-08-webgui-session-status-recovery-design.md docs/superpowers/plans/2026-08-08-webgui-session-status-recovery.md packages/opencode/webgui/src
```

Expected: only the approved design/plan and focused WebGUI status, display, and test changes appear; existing version changes remain untouched.
