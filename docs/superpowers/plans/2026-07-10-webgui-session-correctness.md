# WebGUI Session Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make WebGUI session state converge to backend truth across reconnect, retry, revert, abort, visibility, diff, and fork workflows.

**Architecture:** Keep the existing legacy WebGUI client but repair its narrow compatibility wrappers. Rehydrate durable state on each connection epoch, consume current v2 wire types for session diffs and pending requests, and reject SDK error tuples before changing optimistic UI state.

**Tech Stack:** React 18, Vitest, Effect HttpApi, Bun test, generated OpenAPI/SDK workflow.

## Global Constraints

- Preserve the existing `/session/{sessionID}/revert` contract.
- Fork copies history before the selected user message and stores that message as the new session draft; it does not auto-run.
- Restore `PUT /session/visibility`; visibility remains process-local and Instance/Workspace-scoped.
- Do not add dependencies or migrate the entire WebGUI to SDK Next.
- After changing public HttpApi, run `bun run generate` from `packages/client`; never edit generated files manually.
- Revert integration tests must use temporary repositories, never the current worktree.
- Do not run Java or Gradle.
- Do not commit, tag, push, or publish unless explicitly requested.

## File Map

- `packages/opencode/webgui/src/lib/api/sdkClient.ts`: pending-list and retry compatibility wrappers.
- `packages/opencode/webgui/src/state/MessagesContext.tsx`: pending-request and latest-message hydration.
- `packages/opencode/webgui/src/state/SessionContext.tsx`: reconnect, redo, revert, and session snapshot state.
- `packages/opencode/webgui/src/state/useSessionActivation.ts`: selection activation key.
- `packages/opencode/webgui/src/components/MessageList/index.tsx`: paged revert boundary.
- `packages/opencode/webgui/src/components/MessageList/hooks/useMessageActions.ts`: successful-action gating and fork draft.
- `packages/opencode/webgui/src/components/MessageList/SessionErrorPart.tsx`: child-session retry target.
- `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts`: abort error handling.
- `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts`: visibility endpoint contract.
- `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`: visibility handler.
- `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.ts`: bounded retry policy.
- `packages/opencode/webgui/src/components/DiffModal/*`, `FileChangesPanel.tsx`, `useMergedFileDiffs.ts`: current diff contract.
- `packages/opencode/webgui/src/components/ModelSelector.tsx`, `useSessionUsage.ts`: provider-default map.

---

### Task 1: Hydrate pending requests and active session state on reconnect

**Files:**
- Modify: `packages/opencode/webgui/src/lib/api/sdkClient.ts:6,80-90,360-450,640-681`
- Modify: `packages/opencode/webgui/src/state/MessagesContext.tsx:1-20,164-179,1000-1149`
- Modify: `packages/opencode/webgui/src/state/MessagesContext.questions.test.tsx`
- Modify: `packages/opencode/webgui/src/state/SessionContext.tsx:1214-1392`
- Modify: `packages/opencode/webgui/src/state/SessionContext.test.tsx`

**Interfaces:**
- Produces: `sdk.permissions.list(): Promise<ApiResult<PermissionRequest[]>>`.
- Produces: `sdk.question.list(): Promise<ApiResult<QuestionRequest[]>>`.
- Consumes: `server.connected` as a connection epoch, not as a durable replay cursor.

- [ ] **Step 1: Add failing pending hydration tests**

Extend the SDK mock in `MessagesContext.questions.test.tsx` with `permissions.list` and `question.list`. Add a pending permission helper and these cases:

Add the current wire types to the test imports:

```ts
import type { PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2/client"
```

```tsx
it("server.connected 时恢复 pending question 和 permission", async () => {
  vi.mocked(sdk.question.list).mockResolvedValueOnce({ data: [ask("q1").properties], error: null })
  vi.mocked(sdk.permissions.list).mockResolvedValueOnce({
    data: [
      {
        id: "p1",
        sessionID: "s1",
        permission: "edit",
        patterns: ["src/a.ts"],
        metadata: {},
        always: [],
      },
    ],
    error: null,
  })

  const emitter = new EventEmitter()
  mount(emitter)
  await act(async () => emitter.emit({ type: "server.connected", properties: {} }))

  await waitFor(() => expect(api?.getQuestionsBySession("s1").map((item) => item.id)).toEqual(["q1"]))
  expect(api?.permissions.map((item) => item.id)).toEqual(["p1"])
})

it("水合期间收到 SSE 时丢弃旧快照并重拉", async () => {
  const first = deferred<{ data: QuestionRequest[]; error: null }>()
  vi.mocked(sdk.question.list).mockImplementationOnce(() => first.promise)
  vi.mocked(sdk.question.list).mockResolvedValueOnce({ data: [ask("q2").properties], error: null })
  vi.mocked(sdk.permissions.list).mockResolvedValue({ data: [], error: null })
  const emitter = new EventEmitter()
  mount(emitter)

  await act(async () => emitter.emit({ type: "server.connected", properties: {} }))
  await act(async () => emitter.emit(ask("q2")))
  await act(async () => first.resolve({ data: [ask("q1").properties], error: null }))

  await waitFor(() => expect(vi.mocked(sdk.question.list)).toHaveBeenCalledTimes(2))
  expect(api?.getQuestionsBySession("s1").map((item) => item.id)).toEqual(["q2"])
})
```

Use the existing test's `api` capture; add `waitFor` and a local `deferred` helper.

- [ ] **Step 2: Add a failing reconnect snapshot test to SessionContext**

Mock `sdk.session.status()` and `sdk.session.get()`; emit `server.connected` through the existing global emitter. Assert that a previously busy current session becomes idle and its `revert` field is replaced by the fetched session snapshot.

```tsx
vi.mocked(sdk.session.status).mockResolvedValueOnce({ data: { s1: { type: "idle" } }, error: null })
vi.mocked(sdk.session.get).mockResolvedValueOnce({
  data: { ...session, revert: { messageID: "u1" } },
  error: null,
})

await act(async () => eventEmitter.emit({ type: "server.connected", properties: {} }))

await waitFor(() => expect(api.currentSession?.revert?.messageID).toBe("u1"))
expect(api.isSessionIdle("s1")).toBe(true)
```

- [ ] **Step 3: Run the focused tests and confirm they fail**

Run from `packages/opencode/webgui`:

```powershell
bun vitest run src/state/MessagesContext.questions.test.tsx src/state/SessionContext.test.tsx
```

Expected: the new hydration assertions FAIL because no list or reconnect snapshot calls occur.

- [ ] **Step 4: Add pending-list wrappers**

Import current request types:

```ts
import type { PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2/client"
```

Add a shared trust-boundary helper:

```ts
async function pendingList<T>(url: string, fallback: string): Promise<ApiResult<T[]>> {
  try {
    const response = await fetch(url, { method: "GET", headers: { "Content-Type": "application/json" } })
    if (!response.ok) return { data: null, error: { message: fallback, status: response.status } }
    const data = await response.json()
    if (!Array.isArray(data)) return { data: null, error: { message: fallback } }
    return { data: data as T[], error: null }
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : fallback } }
  }
}
```

Extend `ApiResult.error` with optional `status?: number`. Insert this as the first property of the existing `permissions` object:

```ts
list: () => pendingList<PermissionRequest>("/permission", "Failed to load pending permissions"),
```

Insert this as the first property of the existing `question` object:

```ts
list: () => pendingList<QuestionRequest>("/question", "Failed to load pending questions"),
```

- [ ] **Step 5: Hydrate MessagesContext with version retry**

Import the current `PermissionRequest` type instead of the local duplicate. Add `pendingVersion` and increment it in all asked/replied/rejected handlers.

```ts
const pendingVersion = useRef(0)

const hydratePending = useCallback(async () => {
  for (let attempt = 0; attempt < 2; attempt++) {
    const version = pendingVersion.current
    const [permissionResult, questionResult] = await Promise.all([sdk.permissions.list(), sdk.question.list()])
    if (version !== pendingVersion.current) continue
    if (!permissionResult.error && permissionResult.data) setPermissions(permissionResult.data)
    if (!questionResult.error && questionResult.data) {
      const grouped = new Map<string, QuestionRequest[]>()
      for (const item of questionResult.data) {
        grouped.set(item.sessionID, [...(grouped.get(item.sessionID) ?? []), item])
      }
      setQuestions(grouped)
    }
    return
  }
}, [])

useEventHandler(emitter ?? null, "server.connected", () => {
  void hydratePending()
  const sessionID = session.currentSession?.id
  if (sessionID) void loadLatest(sessionID)
})
```

- [ ] **Step 6: Rehydrate SessionContext on `server.connected`**

Inside the existing SSE subscription effect, add:

```ts
const handleServerConnected = async () => {
  const sessionID = currentSession?.id
  const [statusResult, sessionResult] = await Promise.all([
    sdk.session.status(),
    sessionID ? sdk.session.get({ path: { id: sessionID } }) : Promise.resolve({ data: null, error: null }),
    loadSessions(),
  ])
  if (statusResult.data) {
    const entries = Object.entries(statusResult.data)
    setBusyMap(Object.fromEntries(entries.filter(([, value]) => value.type !== "idle").map(([id]) => [id, true])))
    setStatusMap(Object.fromEntries(entries.filter(([, value]) => value.type !== "idle")))
    for (const [id, value] of entries) if (value.type === "idle") setReasoning(id, false)
  }
  if (sessionResult.data && currentSession?.id === sessionResult.data.id) setCurrentSession(sessionResult.data)
}
```

Subscribe and clean up alongside the existing session event handlers:

```ts
const unsubscribeConnected = eventEmitter.on("server.connected", handleServerConnected)
// existing subscriptions
return () => {
  unsubscribeConnected()
  // existing cleanup
}
```

Do not clear current state when any snapshot request fails.

- [ ] **Step 7: Verify hydration behavior**

Run from `packages/opencode/webgui`:

```powershell
bun vitest run src/state/MessagesContext.questions.test.tsx src/state/SessionContext.test.tsx
```

Expected: new and existing tests PASS.

- [ ] **Step 8: Review checkpoint**

Confirm an SSE mutation during hydration causes one bounded re-fetch, not stale overwrite or an unbounded loop. Do not commit without explicit user approval.

---

### Task 2: Make retry preserve identity and prompt semantics

**Files:**
- Modify: `packages/opencode/webgui/src/lib/api/sdkClient.ts:91-100,393-430`
- Modify: `packages/opencode/webgui/src/lib/api/sdkClient.migration.test.ts:54-133`
- Modify: `packages/opencode/webgui/src/components/MessageList/SessionErrorPart.tsx:10-18`
- Create: `packages/opencode/webgui/src/components/MessageList/SessionErrorPart.test.tsx`

**Interfaces:**
- Produces: retry prompt parts without `id`, `sessionID`, or `messageID`.
- Produces: retry body preserving `agent`, model IDs, top-level `variant`, `format`, `system`, and `tools`.

- [ ] **Step 1: Change the migration test to express the correct retry contract**

Add `variant`, `format`, `system`, and `tools` to the fixture user message, then assert:

```ts
expect(body.parts).toEqual([{ type: "text", text: "hello" }])
expect(body).toMatchObject({
  agent: "build",
  model: { providerID: "openai", modelID: "gpt-4.1" },
  variant: "high",
  format: { type: "json_schema", schema: { type: "object" } },
  system: "retry system",
  tools: { bash: false },
})
```

Update both retry cases so no old part ID is expected.

- [ ] **Step 2: Add the child-session retry component test**

Mock `useSession()` with `currentSession.id = "parent"`, render a part with `sessionID: "child"`, click `重试`, and assert:

```ts
expect(retrySession).toHaveBeenCalledWith("child")
expect(retrySession).not.toHaveBeenCalledWith("parent")
```

- [ ] **Step 3: Run the tests and confirm they fail**

```powershell
bun vitest run src/lib/api/sdkClient.migration.test.ts src/components/MessageList/SessionErrorPart.test.tsx
```

Expected: FAIL on retained part IDs, missing prompt fields, and parent-session retry.

- [ ] **Step 4: Implement the minimal retry corrections**

Change `retryParts`:

```ts
function retryParts(input: any[]) {
  return input
    .filter((part) => ["text", "file", "agent", "subtask"].includes(part.type))
    .map((part) => {
      const { id, sessionID, messageID, ...rest } = part
      void id
      void sessionID
      void messageID
      return rest
    })
}
```

Use the complete v2 user-message shape when constructing the body:

```ts
const info = latest.info as UserMessage
const body = {
  parts: retryParts(latest.parts),
  agent: info.agent,
  model: {
    providerID: info.model.providerID,
    modelID: info.model.modelID,
  },
  variant: info.model.variant,
  format: info.format,
  system: info.system,
  tools: info.tools,
}
const response = await baseClient.session.prompt({ path: { id: options.path.sessionID }, body })
```

In `SessionErrorPart`, replace `currentSession.id` with `part.sessionID`; only use `isSessionIdle(part.sessionID)` to decide whether to show the button.

- [ ] **Step 5: Verify retry tests**

Run:

```powershell
bun vitest run src/lib/api/sdkClient.migration.test.ts src/components/MessageList/SessionErrorPart.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 6: Review checkpoint**

Inspect the POST body and confirm no old persistent identifier crosses into the new message. Do not commit without explicit user approval.

---

### Task 3: Reject failed redo, revert, and abort operations

**Files:**
- Modify: `packages/opencode/webgui/src/state/SessionContext.tsx:1018-1128`
- Modify: `packages/opencode/webgui/src/state/SessionContext.test.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageActions.ts:45-82`
- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageActions.test.ts`
- Modify: `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts:224-251`
- Modify: `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.test.tsx`
- Modify: `packages/opencode/test/server/httpapi-session.test.ts:1046-1067`

**Interfaces:**
- Produces: action methods return `null` on failure and preserve server-derived UI state.
- Consumes: SDK error tuples as failures even when the Promise resolves.

- [ ] **Step 1: Add failing tests for the three failure modes**

Add focused tests:

```ts
it("redo message load error does not unrevert", async () => {
  vi.mocked(sdk.session.messages).mockResolvedValueOnce({ data: null, error: { message: "boom" } })
  const result = await api.redoNext("s1")
  expect(result).toBeNull()
  expect(sdk.session.unrevert).not.toHaveBeenCalled()
})
```

```ts
it("failed revert keeps confirmation open and does not edit the input", async () => {
  mocks.revertToMessage.mockResolvedValueOnce(null)
  const onUndoToInput = vi.fn()
  const { result } = renderHook(() => useMessageActions("s1", onUndoToInput))
  act(() => result.current.handleRevert("m1"))
  await act(() => result.current.handleRevertConfirm())
  expect(onUndoToInput).not.toHaveBeenCalled()
  expect(result.current.revertAction).toEqual({ type: "undo", messageId: "m1" })
})
```

```ts
it("abort error tuple keeps session busy", async () => {
  vi.mocked(sdk.session.abort).mockResolvedValueOnce({ data: null, error: { message: "busy" } })
  await act(() => result.current.handleAbort())
  expect(mocks.setSessionIdle).not.toHaveBeenCalledWith("s1", true)
expect(mocks.showToast).toHaveBeenCalledWith("busy", expect.objectContaining({ variant: "error" }))
})
```

Strengthen the existing HttpApi revert smoke test inside its temporary git fixture. Create a real user message, post its ID, and assert the returned boundary; then unrevert and assert it is cleared:

```ts
const message = yield* createTextMessage(session.id, "revert target")
const reverted = yield* requestJson<Session.Info>(pathFor(SessionPaths.revert, { sessionID: session.id }), {
  method: "POST",
  headers,
  body: JSON.stringify({ messageID: message.info.id }),
})
expect(reverted.revert?.messageID).toBe(message.info.id)

const restored = yield* requestJson<Session.Info>(pathFor(SessionPaths.unrevert, { sessionID: session.id }), {
  method: "POST",
  headers,
})
expect(restored.revert).toBeUndefined()
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

```powershell
bun vitest run src/state/SessionContext.test.tsx src/components/MessageList/hooks/useMessageActions.test.ts src/components/MessageInput/hooks/useMessageInput.test.tsx
```

Expected: the new assertions FAIL.

Run the backend contract check from `packages/opencode`:

```powershell
bun test test/server/httpapi-session.test.ts -t "remaining non-LLM session mutation routes"
```

Expected: PASS before and after the frontend fix; this isolates the reported failure to the WebGUI state path rather than the revert endpoint.

- [ ] **Step 3: Guard all resolved SDK errors**

In `redoNext`, check before reading `data`:

```ts
const resp = await sdk.session.messages({ path: { id: sessionId } })
if (resp.error || !resp.data) {
  const message =
    resp.error && typeof resp.error === "object" && "message" in resp.error
      ? String(resp.error.message)
      : "Failed to load messages for redo"
  setError(new Error(message))
  return null
}
```

Use the same existing error extraction path in revert/unrevert, but ensure callers only close confirmation after a non-null result. In `handleRevertConfirm`, store the result for each branch; on `null`, clear busy and return without setting `revertAction` to null. Move input restoration and `removeSessionErrors` after successful undo.

In `handleAbort`:

```ts
const response = await sdk.session.abort({ path: { id: sessionID } })
if (response.error) {
  const message =
    typeof response.error === "object" && "message" in response.error
      ? String(response.error.message)
      : "终止会话失败"
  throw new Error(message)
}
setSessionIdle(sessionID, true)
```

Remove `setSessionIdle(sessionID, true)` from the catch branch.

- [ ] **Step 4: Verify action failure behavior**

Run the same three files. Expected: all tests PASS.

- [ ] **Step 5: Review checkpoint**

Confirm no failure path modifies input text, removes errors, closes confirmation, or marks idle. Do not commit without explicit user approval.

---

### Task 4: Enforce paged revert boundaries and recompute selection

**Files:**
- Modify: `packages/opencode/webgui/src/components/MessageList/index.tsx:73-132`
- Modify: `packages/opencode/webgui/src/components/MessageList/index.test.tsx`
- Modify: `packages/opencode/webgui/src/state/useSessionActivation.ts:19-31,166-194`
- Modify: `packages/opencode/webgui/src/state/useSessionActivation.test.tsx`

**Interfaces:**
- Consumes: `getSessionPagination(sessionID)` and `loadOlder(sessionID)`.
- Produces: activation identity `${sessionID}:${revert.messageID ?? ""}:${revert.partID ?? ""}`.

- [ ] **Step 1: Add failing boundary and selection tests**

Add a MessageList case where latest messages do not contain `currentSession.revert.messageID`, pagination is incomplete, and assert hidden messages are not rendered while `loadOlder("s1")` is requested.

```tsx
it("revert boundary 在旧页时隐藏最新页并继续加载", async () => {
  const loadOlder = vi.fn(async () => [])
  mocks.useMessages.mockReturnValue({
    getMessagesBySession: () => [msg("after-boundary", 10)],
    getQuestionsBySession: () => [],
    getSessionPagination: () => page({ complete: false, olderLoading: false }),
    loadOlder,
    permissions: [],
  })
  mocks.useSession.mockReturnValue({
    isIdle: true,
    isReasoning: false,
    currentSession: { id: "s1", revert: { messageID: "boundary" } },
  })
  mocks.useTopTrim.mockReturnValue({
    topRef: { current: null },
    top: 0,
    visible: [],
    row: () => vi.fn(),
  })

  render(<MessageList sessionID="s1" />)

  expect(screen.queryByTestId("message-row")).not.toBeInTheDocument()
  await waitFor(() => expect(loadOlder).toHaveBeenCalledWith("s1"))
})
```

Add an activation case that rerenders the same session ID with a new revert boundary and asserts `restoreSelections` runs again using the last visible user message.

```tsx
currentSession = { id: "s1", revert: undefined }
const view = render(<Harness />)
await waitFor(() => expect(restoreSelections).toHaveBeenCalledTimes(1))

currentSession = { id: "s1", revert: { messageID: "u2" } }
view.rerender(<Harness />)

await waitFor(() => expect(restoreSelections).toHaveBeenCalledTimes(2))
expect(restoreSelections).toHaveBeenLastCalledWith(expect.objectContaining({ modelId: "model-before-u2" }), "s1")
```

- [ ] **Step 2: Run focused tests and confirm failure**

```powershell
bun vitest run src/components/MessageList/index.test.tsx src/state/useSessionActivation.test.tsx
```

- [ ] **Step 3: Load toward a missing boundary without leaking messages**

Move `page` before `visibleMessages`, then add:

```ts
const revertBoundaryIndex = revertBoundaryID
  ? sortedMessages.findIndex((message) => message.info.id === revertBoundaryID)
  : -1

useEffect(() => {
  if (!sessionID || !revertBoundaryID || revertBoundaryIndex >= 0) return
  if (page.complete || page.olderLoading) return
  void loadOlder(sessionID)
}, [loadOlder, page.complete, page.olderLoading, revertBoundaryID, revertBoundaryIndex, sessionID])

const visibleMessages = useMemo(() => {
  if (!revertBoundaryID) return sortedMessages
  if (revertBoundaryIndex < 0) return []
  return sortedMessages.slice(0, revertBoundaryIndex)
}, [revertBoundaryID, revertBoundaryIndex, sortedMessages])
```

- [ ] **Step 4: Key activation by the revert boundary**

Replace `lastActivatedSessionIDRef` with `lastActivationKeyRef`. In the effect:

```ts
const sessionID = currentSession?.id ?? null
const activationKey = sessionID
  ? `${sessionID}:${currentSession?.revert?.messageID ?? ""}:${currentSession?.revert?.partID ?? ""}`
  : null
if (!activationKey) {
  lastActivationKeyRef.current = null
  activationTokenRef.current += 1
  return
}
if (lastActivationKeyRef.current === activationKey) return
lastActivationKeyRef.current = activationKey
```

Include messageID and partID in the effect dependencies.

- [ ] **Step 5: Verify boundary and selection tests**

Run the focused tests. Expected: all tests PASS.

- [ ] **Step 6: Review checkpoint**

Confirm a missing boundary displays no post-boundary content and stops fetching when pagination is complete. Do not commit without explicit user approval.

---

### Task 5: Restore the session visibility endpoint and bounded retry

**Files:**
- Modify: `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts:70-106,108-145`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:1-64,450-465`
- Modify: `packages/opencode/test/server/httpapi-session.test.ts`
- Modify: `packages/opencode/webgui/src/lib/api/sdkClient.ts:250-275`
- Modify: `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.ts`
- Modify: `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.test.tsx`
- Regenerate: public SDK/OpenAPI outputs through `packages/client`

**Interfaces:**
- Produces: `PUT /session/visibility` body `{ sessionIDs: SessionID[] }` and response `{ sessionIDs: SessionID[] }`.
- Consumes: `SessionSummaryScheduler.Service.syncVisible(sessionIDs)`.

- [ ] **Step 1: Add the failing HttpApi test**

In `httpapi-session.test.ts`, create two sessions and issue:

```ts
const saved = yield* requestJson<{ sessionIDs: string[] }>(SessionPaths.visibility, {
  method: "PUT",
  headers,
  body: JSON.stringify({ sessionIDs: [second.id, first.id, second.id] }),
})
expect(saved.sessionIDs).toEqual([second.id, first.id])
```

Add a malformed ID case expecting HTTP 400.

- [ ] **Step 2: Add failing frontend retry classification tests**

Keep the existing temporary failure test and add:

```ts
it("4xx visibility error does not retry forever", async () => {
  vi.useFakeTimers()
  mocks.syncVisible.mockResolvedValueOnce({ data: null, error: { message: "bad request", status: 400 } })
  renderHook(() => useSessionVisibilitySync())
  await act(async () => vi.advanceTimersByTimeAsync(5000))
  expect(mocks.syncVisible).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 3: Run tests and confirm failure**

Run from `packages/opencode`:

```powershell
bun test test/server/httpapi-session.test.ts -t visibility
```

Run from `packages/opencode/webgui`:

```powershell
bun vitest run src/hooks/useSessionVisibilitySync.test.tsx
```

- [ ] **Step 4: Declare and handle the endpoint**

In the group module:

```ts
export const VisibilityPayload = Schema.Struct({ sessionIDs: Schema.Array(SessionID) })
```

Add this property inside the existing `SessionPaths` object:

```ts
visibility: `${root}/visibility`,
```

Add this endpoint beside `status`, before the parameterized `get` route:

```ts
HttpApiEndpoint.put("syncVisible", SessionPaths.visibility, {
  payload: VisibilityPayload,
  success: described(VisibilityPayload, "Visible sessions updated"),
  error: HttpApiError.BadRequest,
}).annotateMerge(
  OpenApi.annotations({
    identifier: "session.visibility",
    summary: "Sync visible sessions",
    description: "Update the process-local set of sessions visible in the current WebGUI instance.",
  }),
)
```

In the handler module, import `SessionSummaryScheduler` and `VisibilityPayload`, yield the scheduler service once, and add:

```ts
const syncVisible = Effect.fn("SessionHttpApi.syncVisible")(function* (ctx: {
  payload: typeof VisibilityPayload.Type
}) {
  const sessionIDs = Array.from(new Set(ctx.payload.sessionIDs))
  yield* summaryScheduler.syncVisible(sessionIDs)
  return { sessionIDs }
})
```

Register `.handle("syncVisible", syncVisible)`.

- [ ] **Step 5: Stop retrying non-retryable client errors**

Return `status: response.status` from `sessionSyncVisible`. In the hook, only schedule the timer when no status is available or `status >= 500`; record a non-retryable key so rerenders with the same key do not immediately resend.

```ts
if (!ok && response.error?.status && response.error.status < 500) {
  blocked.current = next.key
  return
}
```

Clear `blocked.current` when `key` changes.

- [ ] **Step 6: Regenerate public clients**

Run from `packages/client`:

```powershell
bun run generate
```

Do not edit generated files manually.

- [ ] **Step 7: Verify endpoint, client policy, and typecheck**

Run the focused backend and frontend tests, then `bun typecheck` from `packages/opencode`.

- [ ] **Step 8: Review checkpoint**

Confirm state is owned by existing InstanceState-backed scheduler and no global client registry was added. Do not commit without explicit user approval.

---

### Task 6: Migrate WebGUI diff rendering to `SnapshotFileDiff`

**Files:**
- Modify: `packages/opencode/webgui/src/lib/api/events.ts`
- Modify: `packages/opencode/webgui/src/state/SessionContext.tsx`
- Modify: `packages/opencode/webgui/src/hooks/useMergedFileDiffs.ts`
- Modify: `packages/opencode/webgui/src/components/FileChangesPanel.tsx`
- Modify: `packages/opencode/webgui/src/components/FileChangesPanel.test.tsx`
- Modify: `packages/opencode/webgui/src/components/DiffModal/hooks/useDiffData.ts`
- Modify: `packages/opencode/webgui/src/components/DiffModal/DiffNavigation.tsx`
- Modify: `packages/opencode/webgui/src/components/DiffModal/utils.ts`
- Create: `packages/opencode/webgui/src/components/DiffModal/utils.test.ts`
- Modify: `packages/opencode/webgui/src/components/DiffModal/index.tsx`
- Modify: `packages/opencode/webgui/src/components/DiffModal/index.test.tsx`

**Interfaces:**
- Consumes: `SnapshotFileDiff` from `@opencode-ai/sdk/v2/client`.
- Produces: `contentFromPatch(patch?: string): { before: string; after: string } | null`.

- [ ] **Step 1: Add failing current-contract tests**

Change DiffModal fixtures to `{ file, patch, status, additions, deletions }`. Add utility tests:

```ts
expect(
  contentFromPatch("@@ -1,2 +1,2 @@\n same\n-old\n+new\n"),
).toEqual({ before: "same\nold", after: "same\nnew" })
expect(contentFromPatch(undefined)).toBeNull()
```

Update FileChangesPanel fixtures and assert a `status: "modified"` item is counted as modified and `status: "deleted"` as deleted.

- [ ] **Step 2: Run diff tests and confirm failure**

```powershell
bun vitest run src/components/DiffModal/utils.test.ts src/components/DiffModal/index.test.tsx src/components/FileChangesPanel.test.tsx
```

- [ ] **Step 3: Replace all legacy `FileDiff` imports**

Use:

```ts
import type { SnapshotFileDiff } from "@opencode-ai/sdk/v2/client"
```

Replace state, props, events, and hook types consistently. In fallback entries use:

```ts
{ file, patch: "", status: "modified" as const, additions: 0, deletions: 0 }
```

- [ ] **Step 4: Parse unified patch safely**

Add to `DiffModal/utils.ts`:

```ts
export function contentFromPatch(patch?: string) {
  if (!patch) return null
  const before: string[] = []
  const after: string[] = []
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@") || line.startsWith("---") || line.startsWith("+++")) continue
    if (line.startsWith("\\ No newline")) continue
    if (line.startsWith("-")) {
      before.push(line.slice(1))
      continue
    }
    if (line.startsWith("+")) {
      after.push(line.slice(1))
      continue
    }
    if (!line.startsWith(" ")) continue
    before.push(line.slice(1))
    after.push(line.slice(1))
  }
  return { before: before.join("\n"), after: after.join("\n") }
}
```

Use `status` for classification. In DiffModal derive content once; if parsing returns null, display the patch string as read-only text instead of calling `DiffViewer` with undefined values.

- [ ] **Step 5: Verify diff tests and full typecheck**

Run focused tests, WebGUI build, and WebGUI typecheck/test script. Expected: no legacy `FileDiff` import remains under WebGUI.

- [ ] **Step 6: Review checkpoint**

Confirm deleted/added files and missing historical patch fields degrade safely. Do not commit without explicit user approval.

---

### Task 7: Restore fork draft semantics and provider defaults

**Files:**
- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageActions.ts:7-34`
- Modify: `packages/opencode/webgui/src/components/MessageList/hooks/useMessageActions.test.ts`
- Modify: `packages/opencode/webgui/src/components/ModelSelector.tsx:112-131,221-230,430-445`
- Modify: `packages/opencode/webgui/src/components/ModelSelector.test.tsx`
- Modify: `packages/opencode/webgui/src/hooks/useSessionUsage.ts:87-110`
- Create: `packages/opencode/webgui/src/hooks/useSessionUsage.test.tsx`

**Interfaces:**
- Consumes: `loadDrafts()` and `saveDrafts()`.
- Produces: forked session draft keyed by the new session ID.
- Consumes: provider defaults as `{ [providerID]: modelID }`.

- [ ] **Step 1: Add failing fork and default-map tests**

For fork, return a source user message from `getMessagesBySession`, mock draft repo, confirm fork, and assert:

```ts
expect(saveDrafts).toHaveBeenCalledWith({ forked: "branch prompt" })
expect(mocks.openTab).toHaveBeenCalledWith("forked")
```

For ModelSelector, pass `defaultIdsData={{ openai: "gpt-5" }}` and assert the default badge/display resolves `openai/gpt-5`. For session usage, mock the same map and assert the selected fallback model's context limit is used.

- [ ] **Step 2: Run tests and confirm failure**

```powershell
bun vitest run src/components/MessageList/hooks/useMessageActions.test.ts src/components/ModelSelector.test.tsx src/hooks/useSessionUsage.test.tsx
```

- [ ] **Step 3: Save the selected prompt as the fork draft**

In `handleForkConfirm`, find the selected user message, compute `getUserMessagePlainText`, then before opening the tab:

```ts
const source = getMessagesBySession(currentSession.id).find((message) => message.info.id === forkConfirm)
const value = source ? getUserMessagePlainText(source) : ""
if (value) {
  const drafts = await loadDrafts()
  await saveDrafts({ ...drafts, [forkedSession.id]: value })
}
tabStore.openTab(forkedSession.id)
```

Do not call the send path.

- [ ] **Step 4: Read provider defaults by provider ID**

In ModelSelector:

```ts
const defaultModel = providers.flatMap((provider) => {
  const modelID = defaultIds[provider.id]
  return modelID ? [{ providerID: provider.id, modelID }] : []
})[0]
```

Use `defaultModel` for fallback display and `defaultIds[provider.id] === modelId` for badges. Apply the same first-valid-provider rule in `useSessionUsage` when no explicit selection exists.

- [ ] **Step 5: Verify fork and model tests**

Run the focused tests. Expected: all PASS.

- [ ] **Step 6: Review checkpoint**

Confirm fork writes only the new session's draft and never overwrites the source-session draft. Do not commit without explicit user approval.

---

## Plan Verification

Run from `packages/opencode/webgui`:

```powershell
bun run test
bun run build
```

Run from `packages/opencode`:

```powershell
bun typecheck
bun test test/server/httpapi-session.test.ts test/session/summary-scheduler.test.ts
```

Run from `packages/sdk/js`:

```powershell
bun test generated-contract.test.ts
```

Expected: all commands exit 0. If the full WebGUI suite has a 5-second timeout flake, rerun only that exact test once in isolation and report both results; do not hide the initial failure.
