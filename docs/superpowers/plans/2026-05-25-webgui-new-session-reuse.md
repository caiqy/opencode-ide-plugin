# webgui New Session Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent webgui from creating duplicate empty `New session` sessions by persisting browser state, fixing tab recovery races, and reusing recent empty default sessions when the draft pointer is missing.

**Architecture:** Keep existing public APIs where possible. Add browser `localStorage` fallback inside `scopedStorage`, make `tabStore` persist full tab state atomically, and extend `prepareSession()` to support three-state draft checks plus a reusable-session fallback callback.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Bun, existing `@opencode-ai/sdk` client wrappers.

**Repository rule:** Do not commit from this plan unless the user explicitly asks for commits. Use `git diff --check` and targeted tests as checkpoints instead.

---

## Files

- Modify: `packages/opencode/webgui/src/state/scopedStorage.ts`
  - Responsibility: scoped state storage; add browser `localStorage` fallback for non-IDE global/workspace scopes.
- Modify: `packages/opencode/webgui/src/state/scopedStorage.test.ts`
  - Responsibility: verify host storage, browser storage, memory scope, and fallback behavior.
- Modify: `packages/opencode/webgui/src/state/tabStore.ts`
  - Responsibility: tab state in React; change persistence to atomic `saveTabs()`.
- Modify: `packages/opencode/webgui/src/state/tabStore.test.ts`
  - Responsibility: verify tab store persistence behavior uses full tab state.
- Modify: `packages/opencode/webgui/src/components/CompactHeader/index.tsx`
  - Responsibility: restore active tab or recover from persisted half-state before creating a new session.
- Modify: `packages/opencode/webgui/src/components/CompactHeader/index.test.tsx`
  - Responsibility: verify `activeTab` empty recovery path.
- Modify: `packages/opencode/webgui/src/App.tsx`
  - Responsibility: session preparation and new-session orchestration; add three-state reuse and default-session fallback scanning.
- Modify: `packages/opencode/webgui/src/App.test.tsx`
  - Responsibility: unit-test `prepareSession()` and fallback helpers.
- Optional Modify: `packages/opencode/webgui/src/state/repo/tabsRepo.ts`
  - Responsibility: already has `saveTabs()`; no behavior change expected unless implementation needs export adjustments.

---

## Task 1: Browser `localStorage` fallback for scopedStorage

**Files:**

- Modify: `packages/opencode/webgui/src/state/scopedStorage.ts`
- Modify: `packages/opencode/webgui/src/state/scopedStorage.test.ts`

- [ ] **Step 1: Write failing tests for browser fallback**

Add these tests inside `describe("scopedStorage", () => { ... })` in `packages/opencode/webgui/src/state/scopedStorage.test.ts`:

```ts
it("无 ideBridge 时 global/workspace 会写入 localStorage 并可读回", async () => {
  vi.mocked(ideBridge.isInstalled).mockReturnValue(false)

  await scopedStateSetJSON("workspace", "opencode:webgui:workspace:tabs:v1", {
    open_tabs: ["s1"],
    active_tab: "s1",
  })
  await scopedStateSetJSON("global", "opencode:webgui:global:theme:v1", "dark")

  resetScopedStateForTest()
  vi.mocked(ideBridge.isInstalled).mockReturnValue(false)

  await expect(
    scopedStateGetJSON("workspace", "opencode:webgui:workspace:tabs:v1", {
      open_tabs: [],
      active_tab: "",
    }),
  ).resolves.toEqual({ open_tabs: ["s1"], active_tab: "s1" })
  await expect(scopedStateGetJSON("global", "opencode:webgui:global:theme:v1", "light")).resolves.toBe("dark")
})

it("无 ideBridge 时 mem 只保存在内存且不进入 localStorage", async () => {
  vi.mocked(ideBridge.isInstalled).mockReturnValue(false)

  await scopedStateSetJSON("mem", "opencode:webgui:mem:runtime:v1", { panel: "chat" })

  expect(localStorage.getItem("opencode:webgui:scoped:mem:opencode:webgui:mem:runtime:v1")).toBeNull()
  await expect(scopedStateGetJSON("mem", "opencode:webgui:mem:runtime:v1", {})).resolves.toEqual({ panel: "chat" })

  resetScopedStateForTest()
  vi.mocked(ideBridge.isInstalled).mockReturnValue(false)
  await expect(scopedStateGetJSON("mem", "opencode:webgui:mem:runtime:v1", {})).resolves.toEqual({})
})

it("localStorage 写失败时保留内存值并报告写入失败", async () => {
  vi.mocked(ideBridge.isInstalled).mockReturnValue(false)
  const report = vi.fn()
  setScopedStateWriteErrorReporter(report)
  const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota")
  })

  await scopedStateSetJSON("workspace", "opencode:webgui:workspace:draft_session:v1", "s1")

  await expect(scopedStateGetJSON("workspace", "opencode:webgui:workspace:draft_session:v1", null)).resolves.toBe("s1")
  expect(report).toHaveBeenCalledWith({
    key: "opencode:webgui:workspace:draft_session:v1",
    error: "host_write_failed",
    message: "设置未保存，本次会话可继续使用",
  })

  setItem.mockRestore()
})
```

Also update `beforeEach` to clear browser storage:

```ts
localStorage.clear()
```

- [ ] **Step 2: Run scopedStorage tests and verify failure**

Run:

```powershell
bun --cwd "packages/opencode/webgui" test:run src/state/scopedStorage.test.ts
```

Expected: the new browser persistence tests fail because non-IDE `scopedStorage` only uses memory.

- [ ] **Step 3: Implement browser fallback**

In `packages/opencode/webgui/src/state/scopedStorage.ts`, add helper functions near the existing module-level constants:

```ts
function browserKey(scope: StorageScope, key: string) {
  return `opencode:webgui:scoped:${scope}:${key}`
}

function browserGet(scope: StorageScope, key: string) {
  if (scope === "mem") return undefined
  try {
    return window.localStorage.getItem(browserKey(scope, key)) ?? undefined
  } catch {
    return undefined
  }
}

function browserSet(scope: StorageScope, key: string, value: string) {
  if (scope === "mem") return true
  try {
    window.localStorage.setItem(browserKey(scope, key), value)
    return true
  } catch {
    return false
  }
}
```

Change `scopedStateGet()` non-IDE branch to prefer `localStorage` for global/workspace while keeping memory fallback:

```ts
if (!ideBridge.isInstalled()) {
  return Object.fromEntries(keys.map((key) => [key, browserGet(scope, key) ?? mem.get(key)]))
}
```

Change `scopedStateSet()` non-IDE branch:

```ts
if (!ideBridge.isInstalled()) {
  const ok = browserSet(scope, key, value)
  if (ok) return { ok: true }
  warn(key, "host_write_failed")
  return {
    ok: false,
    error: "host_write_failed",
  }
}
```

- [ ] **Step 4: Run scopedStorage tests and verify pass**

Run:

```powershell
bun --cwd "packages/opencode/webgui" test:run src/state/scopedStorage.test.ts
```

Expected: all tests in `scopedStorage.test.ts` pass.

- [ ] **Step 5: Review diff checkpoint**

Run:

```powershell

```

Expected: only browser fallback and tests changed.

---

## Task 2: Make tab persistence atomic

**Files:**

- Modify: `packages/opencode/webgui/src/state/tabStore.ts`
- Modify: `packages/opencode/webgui/src/state/tabStore.test.ts`

- [ ] **Step 1: Update tabStore test mock to expose saveTabs**

In `packages/opencode/webgui/src/state/tabStore.test.ts`, change the hoisted mocks to include `saveTabs`:

```ts
    saveTabs: vi.fn(async (_value: unknown) => ({ open_tabs: [], active_tab: "" })),
```

Change the `vi.mock("./repo/tabsRepo", ...)` return to include:

```ts
    saveTabs: (value: unknown) => mocks.saveTabs(value),
```

Keep `saveOpenTabs` in the mock for existing assertions until they are updated.

In `beforeEach`, add:

```ts
mocks.saveTabs.mockResolvedValue({ open_tabs: [], active_tab: "" })
```

- [ ] **Step 2: Update existing persistence expectations to expect saveTabs**

Change the `openTab appends new tabs and activates existing tabs` test expectations from `saveOpenTabs` to `saveTabs`:

```ts
expect(mocks.saveTabs).toHaveBeenCalledTimes(2)
expect(mocks.activateTab).toHaveBeenCalledWith("s1")
expect(mocks.saveTabs).toHaveBeenLastCalledWith({ open_tabs: ["s1", "s2"], active_tab: "s2" })
```

Add a new test after that test:

```ts
it("openTab 原子保存 open_tabs 与 active_tab", async () => {
  const { result } = renderHook(() => useTabStore(), { wrapper })

  await waitFor(() => {
    expect(result.current.loaded).toBe(true)
  })

  act(() => {
    result.current.openTab("s1")
    result.current.openTab("s2")
  })

  expect(mocks.saveTabs).toHaveBeenLastCalledWith({ open_tabs: ["s1", "s2"], active_tab: "s2" })
  expect(mocks.saveOpenTabs).not.toHaveBeenCalled()
})
```

In tests that currently clear or assert `mocks.saveOpenTabs`, switch to `mocks.saveTabs` when the action adds/removes/reorders tabs. Keep `mocks.activateTab` assertions for “activate existing tab only”.

- [ ] **Step 3: Run tabStore tests and verify failure**

Run:

```powershell
bun --cwd "packages/opencode/webgui" test:run src/state/tabStore.test.ts
```

Expected: tests fail because `tabStore.ts` still imports and calls `saveOpenTabs`.

- [ ] **Step 4: Implement atomic persistence**

In `packages/opencode/webgui/src/state/tabStore.ts`, change the import:

```ts
import { activateTab as activateTabRepo, loadTabs, saveTabs } from "./repo/tabsRepo"
```

Replace `persist(next)` with:

```ts
function persist(next: TabState) {
  void saveTabs({ open_tabs: next.openTabs, active_tab: next.activeTab }).catch(() => {})
}
```

No other tab store behavior should change.

- [ ] **Step 5: Run tabStore tests and verify pass**

Run:

```powershell
bun --cwd "packages/opencode/webgui" test:run src/state/tabStore.test.ts
```

Expected: all tests in `tabStore.test.ts` pass.

- [ ] **Step 6: Review diff checkpoint**

Run:

```powershell

```

Expected: `tabStore` uses `saveTabs`; tests no longer expect two-phase persistence for tab state changes.

---

## Task 3: Recover persisted tabs when activeTab is empty

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/index.tsx`
- Modify: `packages/opencode/webgui/src/components/CompactHeader/index.test.tsx`

- [ ] **Step 1: Add failing CompactHeader test**

In `packages/opencode/webgui/src/components/CompactHeader/index.test.tsx`, add this test near the existing `activeTab 为空时会触发 onNewSession` test:

```ts
  it("activeTab 为空但 openTabs 非空时恢复最后一个标签而不是创建新会话", async () => {
    const switchSession = vi.fn().mockResolvedValue(undefined)
    const activateTab = vi.fn()
    const onNewSession = vi.fn()

    mocks.useSession.mockReturnValue({
      currentSession: null,
      setCurrentSession: vi.fn(),
      sessions: [{ id: "s1", title: "会话 1" }, { id: "s2", title: "会话 2" }],
      setSessions: vi.fn(),
      switchSession,
      regenerateSessionTitle: vi.fn(),
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      hasMore: false,
      isLoading: false,
      isLoadingMore: false,
      loadMoreSessions: vi.fn(),
    })
    mocks.useTabStore.mockReturnValue({
      openTabs: ["s1", "s2"],
      activeTab: "",
      loaded: true,
      openTab: vi.fn(),
      closeTab: vi.fn(),
      removeTab: vi.fn(),
      activateTab,
      reorderTabs: vi.fn(),
      replaceTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeTabsToRight: vi.fn(),
      pruneTabs: vi.fn(),
    })

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={onNewSession}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(switchSession).toHaveBeenCalledWith("s2")
    })
    await waitFor(() => {
      expect(activateTab).toHaveBeenCalledWith("s2")
    })
    expect(onNewSession).not.toHaveBeenCalled()
  })
```

Keep the existing `activeTab 为空时会触发 onNewSession` test, but change its tab state to `openTabs: []` so it remains the explicit empty-tabs behavior:

```ts
      openTabs: [],
      activeTab: "",
```

- [ ] **Step 2: Run CompactHeader test and verify failure**

Run:

```powershell
bun --cwd "packages/opencode/webgui" test:run src/components/CompactHeader/index.test.tsx
```

Expected: new test fails because current code calls `onNewSession()` whenever `activeTab` is empty.

- [ ] **Step 3: Implement activeTab fallback**

In `packages/opencode/webgui/src/components/CompactHeader/index.tsx`, inside the effect starting around `if (tabStore.openTabs.length > 0)`, replace the active-tab empty branch:

```ts
if (!tabStore.activeTab) {
  const target = tabStore.openTabs[tabStore.openTabs.length - 1]
  if (!target) {
    onNewSession()
    return
  }
  if (!restoring) {
    setRestoring(true)
    void switchWithRollback(
      target,
      () => tabStore.activateTab(target),
      () => {
        if (activeRef.current) return
        onNewSession()
      },
    ).finally(() => {
      setRestoring(false)
    })
  }
  return
}
```

Do not change the rest of the effect except dependencies if TypeScript requires it. `tabStore.activateTab` is already covered by the `tabStore` object dependency.

- [ ] **Step 4: Run CompactHeader tests and verify pass**

Run:

```powershell
bun --cwd "packages/opencode/webgui" test:run src/components/CompactHeader/index.test.tsx
```

Expected: all tests in `index.test.tsx` pass.

- [ ] **Step 5: Review diff checkpoint**

Run:

```powershell

```

Expected: empty `activeTab` with non-empty tabs now recovers the last tab.

---

## Task 4: Add three-state prepareSession and reusable-session fallback

**Files:**

- Modify: `packages/opencode/webgui/src/App.tsx`
- Modify: `packages/opencode/webgui/src/App.test.tsx`

- [ ] **Step 1: Add prepareSession tests**

In `packages/opencode/webgui/src/App.test.tsx`, update the import to include `prepareSession`:

```ts
import { handleSessionUiEvent, prepareSession } from "./App"
```

Add this `describe` block before `describe("handleSessionUiEvent", ...)`:

```ts
describe("prepareSession", () => {
  it("draft 可复用时打开并切换，不创建新会话", async () => {
    const create = vi.fn()
    const open = vi.fn()
    const switchTo = vi.fn().mockResolvedValue(undefined)
    const setDraft = vi.fn()

    await prepareSession({
      draft: "s-draft",
      reusable: vi.fn().mockResolvedValue("reusable"),
      create,
      open,
      switchTo,
      setDraft,
      fail: vi.fn(),
    })

    expect(open).toHaveBeenCalledWith("s-draft")
    expect(switchTo).toHaveBeenCalledWith("s-draft")
    expect(create).not.toHaveBeenCalled()
    expect(setDraft).not.toHaveBeenCalled()
  })

  it("draft 明确不可复用时清理指针并复用 fallback", async () => {
    const open = vi.fn()
    const switchTo = vi.fn().mockResolvedValue(undefined)
    const setDraft = vi.fn()

    await prepareSession({
      draft: "s-used",
      reusable: vi.fn().mockResolvedValue("not_reusable"),
      fallback: vi.fn().mockResolvedValue({ id: "s-empty" }),
      create: vi.fn(),
      open,
      switchTo,
      setDraft,
      fail: vi.fn(),
    })

    expect(setDraft).toHaveBeenNthCalledWith(1, null)
    expect(open).toHaveBeenCalledWith("s-empty")
    expect(switchTo).toHaveBeenCalledWith("s-empty")
    expect(setDraft).toHaveBeenLastCalledWith("s-empty")
  })

  it("draft 状态 unknown 时不清理指针并继续 fallback", async () => {
    const setDraft = vi.fn()

    await prepareSession({
      draft: "s-unknown",
      reusable: vi.fn().mockResolvedValue("unknown"),
      fallback: vi.fn().mockResolvedValue({ id: "s-empty" }),
      create: vi.fn(),
      open: vi.fn(),
      switchTo: vi.fn().mockResolvedValue(undefined),
      setDraft,
      fail: vi.fn(),
    })

    expect(setDraft).not.toHaveBeenCalledWith(null)
    expect(setDraft).toHaveBeenCalledWith("s-empty")
  })

  it("没有 draft 和 fallback 时创建新会话", async () => {
    const open = vi.fn()
    const setDraft = vi.fn()

    await prepareSession({
      draft: null,
      reusable: vi.fn(),
      fallback: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "s-new" }),
      open,
      switchTo: vi.fn().mockResolvedValue(undefined),
      setDraft,
      fail: vi.fn(),
    })

    expect(open).toHaveBeenCalledWith("s-new")
    expect(setDraft).toHaveBeenCalledWith("s-new")
  })
})
```

- [ ] **Step 2: Run App tests and verify failure**

Run:

```powershell
bun --cwd "packages/opencode/webgui" test:run src/App.test.tsx
```

Expected: tests fail because `prepareSession()` still expects boolean `reusable` and has no `fallback` option.

- [ ] **Step 3: Implement prepareSession type and flow**

In `packages/opencode/webgui/src/App.tsx`, add above `prepareSession`:

```ts
type ReuseCheck = "reusable" | "not_reusable" | "unknown"

type SessionCandidate = { id: string }
```

Replace the `prepareSession` signature and body with:

```ts
export async function prepareSession(input: {
  draft: string | null
  restore?: () => Promise<string | null>
  reusable: (id: string) => Promise<ReuseCheck>
  fallback?: () => Promise<SessionCandidate | null>
  create: () => Promise<SessionCandidate | null>
  open: (id: string) => void
  switchTo: (id: string) => Promise<void>
  setDraft: (id: string | null) => void
  fail: () => void
}) {
  const draft = input.draft ?? (input.restore ? await input.restore().catch(() => null) : null)
  if (draft) {
    const ok = await input.reusable(draft).catch((): ReuseCheck => "unknown")
    if (ok === "reusable") {
      input.open(draft)
      const restored = await input
        .switchTo(draft)
        .then(() => true)
        .catch(() => false)
      if (restored) return
    }
    if (ok === "not_reusable") {
      input.setDraft(null)
    }
  }

  const fallback = input.fallback ? await input.fallback().catch(() => null) : null
  if (fallback) {
    input.open(fallback.id)
    const restored = await input
      .switchTo(fallback.id)
      .then(() => true)
      .catch(() => false)
    if (restored) {
      input.setDraft(fallback.id)
      return
    }
  }

  const next = await input.create()
  if (!next) {
    input.fail()
    return
  }
  input.open(next.id)
  input.setDraft(next.id)
}
```

- [ ] **Step 4: Run App tests and verify pass**

Run:

```powershell
bun --cwd "packages/opencode/webgui" test:run src/App.test.tsx
```

Expected: all tests in `App.test.tsx` pass.

- [ ] **Step 5: Review diff checkpoint**

Run:

```powershell

```

Expected: `prepareSession()` supports `ReuseCheck` and optional fallback without changing UI rendering.

---

## Task 5: Add default empty New session fallback scanning

**Files:**

- Modify: `packages/opencode/webgui/src/App.tsx`
- Modify: `packages/opencode/webgui/src/App.test.tsx`

- [ ] **Step 1: Add helper exports and tests for candidate selection**

In `packages/opencode/webgui/src/App.test.tsx`, update the import:

```ts
import { findReusableDefaultSession, handleSessionUiEvent, prepareSession, reuseCheckFromResponses } from "./App"
```

Add this test block after the `prepareSession` describe block:

```ts
describe("new session reuse helpers", () => {
  const sessions = [
    {
      id: "s-used",
      title: "New session - 2026-05-25T01:00:00.000Z",
      time: { created: 1, updated: 5 },
    },
    {
      id: "s-empty",
      title: "New session - 2026-05-25T02:00:00.000Z",
      time: { created: 2, updated: 6 },
    },
    {
      id: "s-named",
      title: "Real work",
      time: { created: 3, updated: 7 },
    },
  ]

  it("reuseCheckFromResponses 区分可复用、不可复用与 unknown", () => {
    expect(reuseCheckFromResponses({ exists: true, messages: [] })).toBe("reusable")
    expect(reuseCheckFromResponses({ exists: true, messages: [{ id: "m1" }] })).toBe("not_reusable")
    expect(reuseCheckFromResponses({ exists: false, messages: [] })).toBe("not_reusable")
    expect(reuseCheckFromResponses({ exists: "unknown", messages: [] })).toBe("unknown")
    expect(reuseCheckFromResponses({ exists: true, messages: "unknown" })).toBe("unknown")
  })

  it("findReusableDefaultSession 返回最近的空默认 New session", async () => {
    const messages = vi.fn(async (id: string) => {
      if (id === "s-empty") return []
      if (id === "s-used") return [{ id: "m1" }]
      return []
    })

    await expect(findReusableDefaultSession(sessions as any, messages)).resolves.toEqual({ id: "s-empty" })
    expect(messages).toHaveBeenCalledWith("s-empty")
  })

  it("findReusableDefaultSession 跳过 messages 请求失败的候选", async () => {
    const messages = vi.fn(async (id: string) => {
      if (id === "s-empty") throw new Error("network")
      if (id === "s-used") return []
      return []
    })

    await expect(findReusableDefaultSession(sessions as any, messages)).resolves.toEqual({ id: "s-used" })
  })
})
```

- [ ] **Step 2: Run App tests and verify failure**

Run:

```powershell
bun --cwd "packages/opencode/webgui" test:run src/App.test.tsx
```

Expected: tests fail because helper functions are not defined.

- [ ] **Step 3: Implement helper functions**

In `packages/opencode/webgui/src/App.tsx`, add these helpers below `prepareSession`:

```ts
function defaultNewSessionTitle(title: string | undefined) {
  return /^New session - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(title ?? "")
}

function sessionTimeValue(session: { time?: { updated?: number; created?: number } }) {
  return session.time?.updated ?? session.time?.created ?? 0
}

export function reuseCheckFromResponses(input: {
  exists: boolean | "unknown"
  messages: unknown[] | "unknown"
}): ReuseCheck {
  if (input.exists === "unknown" || input.messages === "unknown") return "unknown"
  if (!input.exists) return "not_reusable"
  return input.messages.length === 0 ? "reusable" : "not_reusable"
}

export async function findReusableDefaultSession<
  T extends {
    id: string
    title?: string
    parentID?: string
    time?: { archived?: number; updated?: number; created?: number }
  },
>(sessions: T[], messages: (id: string) => Promise<unknown[]>): Promise<SessionCandidate | null> {
  const candidates = sessions
    .filter((session) => !session.parentID)
    .filter((session) => !session.time?.archived)
    .filter((session) => defaultNewSessionTitle(session.title))
    .sort((a, b) => sessionTimeValue(b) - sessionTimeValue(a))

  for (const session of candidates) {
    const rows = await messages(session.id).catch(() => null)
    if (!rows) continue
    if (rows.length === 0) return { id: session.id }
  }
  return null
}
```

This uses one local generic type instead of importing SDK `Session` into helper tests.

- [ ] **Step 4: Wire fallback into handleNewSession**

In `AppInner.handleNewSession`, replace `reusable` with three-state logic:

```ts
      reusable: async (id) => {
        const session = await sdk.session.get({ path: { id } }).catch(() => ({ data: null, error: { message: "unknown" } }))
        if (session.error) return "unknown"
        if (!session.data) return "not_reusable"
        const messages = await sdk.session.messages({ path: { id } }).catch(() => ({ data: null, error: { message: "unknown" } }))
        if (messages.error) return "unknown"
        return reuseCheckFromResponses({ exists: true, messages: messages.data ?? [] })
      },
```

Add `fallback` before `create`:

```ts
      fallback: async () => {
        const loaded = sessions.length > 0 ? sessions : (await sdk.session.list({ limit: 50, roots: true })).data ?? []
        return findReusableDefaultSession(loaded, async (id) => {
          const messages = await sdk.session.messages({ path: { id } })
          if (messages.error) throw new Error(messages.error.message)
          return messages.data ?? []
        })
      },
```

Update the `useCallback` dependency list for `handleNewSession` to include `sessions`:

```ts
  }, [createSession, sessions, switchSession, tabStore.openTab, showToast])
```

- [ ] **Step 5: Run App tests and verify pass**

Run:

```powershell
bun --cwd "packages/opencode/webgui" test:run src/App.test.tsx
```

Expected: all tests in `App.test.tsx` pass.

- [ ] **Step 6: Review diff checkpoint**

Run:

```powershell

```

Expected: `handleNewSession` now checks draft with three-state semantics and scans recent default empty sessions before creating.

---

## Task 6: Run focused regression suite

**Files:**

- Verify only; no file edits expected.

- [ ] **Step 1: Run focused webgui tests**

Run:

```powershell
bun --cwd "packages/opencode/webgui" test:run src/state/scopedStorage.test.ts src/state/tabStore.test.ts src/components/CompactHeader/index.test.tsx src/App.test.tsx
```

Expected: all four focused test files pass.

- [ ] **Step 2: Run lint or targeted type/build check**

Run:

```powershell
bun --cwd "packages/opencode/webgui" run build
```

Expected: TypeScript build and Vite build complete with exit code 0.

- [ ] **Step 3: Check diff formatting**

Run:

```powershell

```

Expected: no whitespace errors.

- [ ] **Step 4: Inspect final changed files**

Run:

```powershell

```

Expected: changed files are limited to the planned webgui source/tests plus this spec/plan document unless pre-existing workspace changes are present.

---

## Self-review checklist

- Spec coverage:
  - Browser localStorage fallback: Task 1.
  - Atomic tab persistence: Task 2.
  - activeTab empty recovery: Task 3.
  - draft three-state validation: Task 4 and Task 5.
  - recent empty default New session fallback: Task 5.
  - verification: Task 6.
- Placeholder scan: no incomplete sections or deferred implementation markers.
- Type consistency:
  - `ReuseCheck` is defined before use.
  - `SessionCandidate` uses only `{ id: string }`, matching `prepareSession` needs.
  - `findReusableDefaultSession()` accepts minimal session-like objects for testability and SDK compatibility.
