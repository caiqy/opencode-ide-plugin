# Webgui Draft Session Load Guard Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent non-draft sessions from overwriting `draftSession` while session messages are still loading, with both data-layer guardrails and UI interaction blocking.

**Architecture:** Add per-session message load state in `MessagesContext`, use that state as a hard precondition before writing `draftSession`, and add a loading/error overlay over the chat body (message list + input area) during session hydration. This is defense-in-depth: UI blocking reduces accidental actions, while data-layer checks prevent regressions if UI blocking is bypassed.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing `MessagesContext` / `MessageInput` / `App` composition.

---

### Task 1: Add failing race regression test (draft pointer contamination)

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageInput/index.test.tsx`
- Test: `packages/opencode/webgui/src/components/MessageInput/index.test.tsx`

**Step 1: Keep the new race test as failing guardrail**

Ensure a test exists that reproduces:

- Existing draft pointer is `s-draft`
- Open `s-other`
- Messages not yet loaded
- User types immediately
- Expect pointer stays `s-draft`

**Step 2: Run test to verify it fails**

Run:
`bun run test:run src/components/MessageInput/index.test.tsx`

Expected: this race test fails, proving current bug reproduction.

---

### Task 2: Introduce per-session message load status in MessagesContext

**Files:**

- Modify: `packages/opencode/webgui/src/state/MessagesContext.tsx`
- Test: `packages/opencode/webgui/src/state/useSessionActivation.test.tsx` (or a new focused context test file if easier)

**Step 1: Extend context contract**

Add methods:

- `isSessionLoading(sessionID: string): boolean`
- `isSessionLoaded(sessionID: string): boolean`
- `isSessionLoadError(sessionID: string): boolean`

And add local state map:

- `sessionLoadMap: Record<string, "loading" | "loaded" | "error">`

**Step 2: Wire load status transitions into `loadSessionMessages(sessionID)`**

Behavior:

- before request: set `loading`
- success (including empty array): set `loaded`
- failure/exception: set `error`

**Step 3: Prevent stale load result from old requests overriding latest state**

Use per-session request token/counter so only latest request writes final status.

**Step 4: Run targeted tests**

Run:
`bun run test:run src/state/useSessionActivation.test.tsx`

Expected: pass.

---

### Task 3: Add data-layer guard before writing draftSession

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageInput/index.tsx`
- Test: `packages/opencode/webgui/src/components/MessageInput/index.test.tsx`

**Step 1: Consume load status from MessagesContext**

From `useMessages()`, read:

- `getMessagesBySession`
- `isSessionLoaded`

**Step 2: Guard both write sites**

For both:

- `handleEditorChange` path
- `fillPhrase` path

Before `saveDraftSession(sessionID)` require:

- `isSessionLoaded(sessionID) === true`
- `getMessagesBySession(sessionID).length === 0`

**Step 3: Re-run failing race regression test**

Run:
`bun run test:run src/components/MessageInput/index.test.tsx`

Expected: previously failing race test turns green.

---

### Task 4: Add chat-body loading/error overlay in App

**Files:**

- Modify: `packages/opencode/webgui/src/App.tsx`
- (Optional create): `packages/opencode/webgui/src/components/ChatLoadOverlay.tsx`
- Test: `packages/opencode/webgui/src/App.newSession.test.ts` (or a dedicated App/UI test)

**Step 1: Compute current session load flags**

In App layer where `currentSession` is available, derive:

- `chatLoading = currentSession?.id ? isSessionLoading(currentSession.id) : false`
- `chatLoadError = currentSession?.id ? isSessionLoadError(currentSession.id) : false`

**Step 2: Overlay scope**

Cover only chat body:

- message list area
- input area

Do NOT block top header/session switch controls.

**Step 3: Interaction policy**

While loading/error overlay visible:

- intercept pointer events on chat body
- mark container `aria-busy={chatLoading}`
- show text `正在加载会话内容…`
- if error, show `重试加载` button invoking `loadSessionMessages(currentSession.id)`

**Step 4: Test overlay behavior**

Add at least one test proving:

- loading state renders overlay and blocks input interaction path

Run:
`bun run test:run src/App.newSession.test.ts src/components/MessageInput/index.test.tsx`

Expected: pass.

---

### Task 5: Full verification

**Files:**

- No code changes

**Step 1: Run focused regression suite**

Run:
`bun run test:run src/components/MessageInput/index.test.tsx src/components/MessageInput/hooks/useMessageInput.test.tsx src/App.newSession.test.ts src/state/useSessionActivation.test.tsx`

Expected: all pass.

**Step 2: Confirm race fix evidence**

Validate that:

- race regression test is green
- no code path can write `draftSession` before `isSessionLoaded(sessionID)` is true
