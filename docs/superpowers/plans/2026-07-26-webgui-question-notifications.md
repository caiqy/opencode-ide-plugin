# WebGUI Question Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send one background IDE system notification for each live `question.asked` request, then rebuild and verify the Windows x64 VSIX.

**Architecture:** Extend the existing `sendIdeNotification` reason union and payload formatter, then call it directly from `MessagesContext`'s live question event handler. Keep request-ID notification state in a provider-local `Map`, matching permission notification behavior; hydration remains state-only and never emits notifications.

**Tech Stack:** React 19, TypeScript 5.9, Vitest 4, existing IDE Bridge protocol, pnpm/Bun, VS Code Extension API, vsce, modified SnoreToast v0.7.0.

## Global Constraints

- Add no dependency and no new source file; reuse `sendIdeNotification` and the existing Bridge message.
- Notify only for live `question.asked`; `sdk.question.list()` hydration must remain silent.
- Suppress the notification only when the same session is visible and focused.
- Deduplicate by question request ID before attempting Bridge delivery; do not retry or backfill suppressed/rejected delivery.
- Remove deduplication state on `question.replied`, `question.rejected`, and `session.deleted`.
- Use title `Agent has a question`, the first question text as body, and `Answer required.` when that text is empty.
- Preserve whitespace folding and the existing 220-character body bound.
- Keep package versions at `26.7.2401` and Windows target at x64.
- Do not commit, stage, push, or create a PR.

---

### Task 1: Extend the shared IDE notification formatter

**Files:**
- Modify: `packages/opencode/webgui/src/lib/ideNotifications.ts:3-32`
- Test: `packages/opencode/webgui/src/lib/ideNotifications.test.ts:28-60`

**Interfaces:**
- Consumes: `ideBridge.sendTransient(message): boolean`.
- Produces: `sendIdeNotification(reason: "finished" | "permission" | "question", sessionID: string, currentSessionID: string | null, detail?: string): boolean`.

- [ ] **Step 1: Write failing formatter tests**

Add question delivery to the transient-rejection assertion and add this focused payload test:

```ts
it("uses the first question preview and question fallback", () => {
  sendIdeNotification("question", "s1", null, "  Which option?  ")
  expect(bridge.sendTransient).toHaveBeenLastCalledWith({
    type: "showSystemNotification",
    payload: { sessionID: "s1", title: "Agent has a question", body: "Which option?" },
  })

  sendIdeNotification("question", "s1", null, "   ")
  expect(bridge.sendTransient).toHaveBeenLastCalledWith({
    type: "showSystemNotification",
    payload: { sessionID: "s1", title: "Agent has a question", body: "Answer required." },
  })
})
```

Also extend the rejection test with:

```ts
expect(sendIdeNotification("question", "s1", null)).toBe(false)
expect(bridge.sendTransient).toHaveBeenCalledTimes(3)
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run from `packages/opencode/webgui`:

```powershell
bun run test:run -- src/lib/ideNotifications.test.ts
```

Expected: TypeScript/Vitest fails because `"question"` is not assignable to `Reason`.

- [ ] **Step 3: Implement the minimum formatter change**

Change `Reason` and the fallback/title selection in `ideNotifications.ts`:

```ts
type Reason = "finished" | "permission" | "question"

const body = text
  ? text.length > 220
    ? `${text.slice(0, 217).trimEnd()}...`
    : text
  : reason === "finished"
    ? "Finished working."
    : reason === "permission"
      ? "Permission requested."
      : "Answer required."

return ideBridge.sendTransient({
  type: "showSystemNotification",
  payload: {
    sessionID,
    title:
      reason === "finished"
        ? "Agent finished"
        : reason === "permission"
          ? "Agent needs permission"
          : "Agent has a question",
    body,
  },
})
```

Leave the foreground check and 220-character truncation unchanged.

- [ ] **Step 4: Run the focused test and confirm GREEN**

Run from `packages/opencode/webgui`:

```powershell
bun run test:run -- src/lib/ideNotifications.test.ts
```

Expected: one test file passes with no failed tests.

### Task 2: Notify from live question events

**Files:**
- Modify: `packages/opencode/webgui/src/state/MessagesContext.tsx:190-193,1047-1057,1085-1143`
- Test: `packages/opencode/webgui/src/state/MessagesContext.questions.test.tsx:76-89,138-214`

**Interfaces:**
- Consumes: Task 1's `sendIdeNotification("question", sessionID, currentSessionID, detail)`.
- Produces: one notification attempt per live request ID, with lifecycle cleanup on reply, reject, and session deletion.

- [ ] **Step 1: Correct the question event fixture**

Replace the test helper with the generated `QuestionRequest` shape:

```ts
function ask(
  requestID: string,
  sessionID = "s1",
  questions: QuestionRequest["questions"] = [{ header: "Choice", question: "Which option?", options: [] }],
) {
  return {
    type: "question.asked",
    properties: {
      id: requestID,
      sessionID,
      questions,
      tool: { messageID: "m1", callID: "c1" },
    },
  } as ServerEvent
}
```

- [ ] **Step 2: Write failing live-event and deduplication tests**

Add tests covering first-question selection, duplicate suppression, and lifecycle cleanup:

```ts
it("后台的同一提问请求只通知一次，并使用第一道问题", async () => {
  const emitter = new EventEmitter()
  mocks.bridgeInstalled.mockReturnValue(true)
  mount(emitter)

  await act(async () => {
    emitter.emit(
      ask("q1", "s1", [
        { header: "First", question: "Which option?", options: [] },
        { header: "Second", question: "Ignore this preview", options: [] },
      ]),
    )
    emitter.emit(ask("q1"))
  })

  expect(mocks.bridgeSend).toHaveBeenCalledTimes(1)
  expect(mocks.bridgeSend).toHaveBeenCalledWith({
    type: "showSystemNotification",
    payload: { sessionID: "s1", title: "Agent has a question", body: "Which option?" },
  })
})

it("回复、拒绝和会话删除会释放提问通知 ID", async () => {
  const emitter = new EventEmitter()
  mocks.bridgeInstalled.mockReturnValue(true)
  mount(emitter)

  await act(async () => {
    emitter.emit(ask("q1"))
    emitter.emit({ type: "question.replied", properties: { sessionID: "s1", requestID: "q1", answers: [] } })
    emitter.emit(ask("q1"))
    emitter.emit({ type: "question.rejected", properties: { sessionID: "s1", requestID: "q1" } })
    emitter.emit(ask("q1"))
    emitter.emit({ type: "session.deleted", properties: { info: { id: "s1" } } } as unknown as ServerEvent)
    emitter.emit(ask("q1"))
  })

  expect(mocks.bridgeSend).toHaveBeenCalledTimes(4)
})
```

- [ ] **Step 3: Write failing suppression and hydration tests**

Add tests proving that suppressed requests are not replayed and hydration stays silent:

```ts
it("前台或 Bridge 未 ready 的提问重放时仍不通知", async () => {
  const emitter = new EventEmitter()
  mocks.bridgeInstalled.mockReturnValue(true)
  mocks.currentSession = { id: "s1" }
  hasFocus.mockReturnValue(true)
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
  mount(emitter)

  await act(async () => emitter.emit(ask("focused")))
  hasFocus.mockReturnValue(false)
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" })
  await act(async () => emitter.emit(ask("focused")))

  mocks.bridgeReady = false
  await act(async () => emitter.emit(ask("not-ready")))
  mocks.bridgeReady = true
  await act(async () => emitter.emit(ask("not-ready")))

  expect(mocks.bridgeSend).not.toHaveBeenCalled()
})

it("question hydration 只恢复状态而不补发通知", async () => {
  vi.mocked(sdk.question.list).mockResolvedValueOnce({
    data: [ask("q1").properties as QuestionRequest],
    error: null,
  })
  vi.mocked(sdk.permissions.list).mockResolvedValueOnce({ data: [], error: null })
  const emitter = new EventEmitter()
  mocks.bridgeInstalled.mockReturnValue(true)
  mount(emitter)

  await act(async () => emitter.emit({ type: "server.connected", properties: {} }))

  await waitFor(() => expect(api?.getQuestionsBySession("s1").map((item) => item.id)).toEqual(["q1"]))
  expect(mocks.bridgeSend).not.toHaveBeenCalled()
})
```

- [ ] **Step 4: Run the context test and confirm RED**

Run from `packages/opencode/webgui`:

```powershell
bun run test:run -- src/state/MessagesContext.questions.test.tsx
```

Expected: notification assertions fail because `handleQuestionAsked` does not call `sendIdeNotification`.

- [ ] **Step 5: Implement provider-local request tracking**

Add the ref beside `notifiedPermissionsRef`:

```ts
const notifiedQuestionsRef = useRef(new Map<string, string>())
```

In `handleQuestionAsked`, immediately after `touchPending(...)`, add:

```ts
const first = !notifiedQuestionsRef.current.has(request.id)
notifiedQuestionsRef.current.set(request.id, request.sessionID)
if (first) {
  sendIdeNotification(
    "question",
    request.sessionID,
    session.currentSession?.id ?? null,
    request.questions[0]?.question,
  )
}
```

Add `session.currentSession?.id` to that callback's dependency list.

Delete the request ID in both terminal handlers:

```ts
notifiedQuestionsRef.current.delete(requestID)
```

Extend `handleSessionDeletedNotification` after permission cleanup:

```ts
for (const [requestID, targetSessionID] of notifiedQuestionsRef.current) {
  if (targetSessionID === sessionID) notifiedQuestionsRef.current.delete(requestID)
}
```

- [ ] **Step 6: Run both focused suites and confirm GREEN**

Run from `packages/opencode/webgui`:

```powershell
bun run test:run -- src/lib/ideNotifications.test.ts src/state/MessagesContext.questions.test.tsx
```

Expected: both test files pass with no failed tests.

### Task 3: Verify, package, install, and smoke-test Windows x64

**Files:**
- Regenerate: `packages/opencode/webgui/webgui-dist/**`
- Regenerate: `hosts/vscode-plugin/opencode-vscode-win-amd64-26.7.2401.vsix`
- Update evidence: `.superpowers/sdd/native-foreground-task-3-review.md`
- Update evidence: `.superpowers/sdd/task-4-report.md`

**Interfaces:**
- Consumes: Tasks 1-2 plus the existing custom SnoreToast x64 binary and `pid: process.ppid` backend.
- Produces: an installed, hash-recorded `26.7.2401` Windows x64 VSIX and explicit immediate/delayed click-smoke evidence.

- [ ] **Step 1: Run complete WebGUI verification**

Run from `packages/opencode/webgui`:

```powershell
bun run test:run
bun run build
```

Expected: all Vitest files pass and the production build exits `0`; record any Vite size warning without treating it as a failure.

- [ ] **Step 2: Run VS Code extension verification**

Run from `hosts/vscode-plugin`:

```powershell
pnpm run compile
pnpm run lint
pnpm test
```

Expected: compile and lint exit `0`; tests may retain only the documented `readUris` descriptor baseline failure. Record exact pass/pending/fail and warning counts.

- [ ] **Step 3: Recheck the native binary**

Run from `hosts/vscode-plugin/native/snoretoast` with the installed CMake executable:

```powershell
& "C:\Program Files (x86)\Microsoft Visual Studio\2017\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\ctest.exe" --test-dir build-x64 -C Release --output-on-failure
Get-FileHash -Algorithm SHA256 "build-x64\Release\snoretoast.exe", "..\..\resources\windows\snoretoast-x64.exe"
```

Expected: `1/1` CTest passes and both hashes remain `F1254C18E09B81E40B83C7B93CE850E554ED00ABCEB7113E1D906ADF2B59FACF`.

- [ ] **Step 4: Rebuild and name the Windows x64 VSIX**

Run from the repository root:

```powershell
& "C:\Program Files\Git\bin\bash.exe" -lc 'export PATH="/c/Users/<local-user>/.version-fox/sdks/bun:/c/Users/<local-user>/.version-fox/sdks/nodejs:$PATH"; OPENCODE_VERSION=1.17.15 ./hosts/scripts/build_vscode.sh --production --skip-tests --single'
```

Then run from `hosts/vscode-plugin`:

```powershell
pnpm exec vsce package --allow-missing-repository --out opencode-vscode-win-amd64-26.7.2401.vsix
```

Expected: both commands exit `0`; the final named package contains `version: 26.7.2401`.

- [ ] **Step 5: Validate and install the exact package**

Record the final file size and SHA-256:

```powershell
Get-Item "opencode-vscode-win-amd64-26.7.2401.vsix" | Format-List Length,FullName
Get-FileHash -Algorithm SHA256 "opencode-vscode-win-amd64-26.7.2401.vsix"
code.cmd --install-extension "opencode-vscode-win-amd64-26.7.2401.vsix" --force
```

Expected: install reports success. Confirm archive entries include `extension/resources/windows/snoretoast-x64.exe`, its LGPL license, the matching native source, and the updated WebGUI bundle; confirm native build objects, `.opencode`, and `out/test` are absent.

- [ ] **Step 6: Run the immediate activation smoke**

1. Open two VS Code windows on distinguishable workspaces and leave the target OpenCode session in the background window.
2. Cause that session to emit a real `question.asked` event.
3. Confirm exactly one notification appears with title `Agent has a question` and the first question as body.
4. Click it within 60 seconds.
5. Confirm the correct VS Code window becomes foreground, OpenCode opens, and the originating session is selected.

Expected: all five observations pass through the in-process `ToastEventHandler::Invoke` path.

- [ ] **Step 7: Run the delayed COM activation smoke**

1. Cause a second real `question.asked` event in the background target session.
2. Wait more than 60 seconds without dismissing the notification.
3. Click it from Windows Action Center.
4. Confirm the same exact target window, OpenCode view, and originating session routing.

Expected: delayed activation passes through the COM activator path; the 60-second split does not expire the notification.

- [ ] **Step 8: Record final evidence and review**

Update the two evidence reports with exact commands, counts, final package hash, install result, and both smoke outcomes. Run a final diff-focused review; do not claim smoke success unless the real desktop observations in Steps 6-7 were completed.
