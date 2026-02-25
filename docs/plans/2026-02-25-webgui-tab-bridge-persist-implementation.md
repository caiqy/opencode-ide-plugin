# Webgui Tab Bridge Persistence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist webgui tab state (`openTabs`, `activeTab`) through VS Code's `ideBridge.setState()` so tabs survive webview recreation (VS Code restart, port change).

**Architecture:** Add `openTabs`/`activeTab` to `UiBridgeState` (v2→v3). `tabStore` reads bridge state on init as primary source, falls back to localStorage. On every tab change, `tabStore` syncs into bridge state alongside existing `sdk.kv` writes.

**Tech Stack:** React, Vitest, TypeScript

---

### Task 1: Add openTabs/activeTab to UiBridgeState type and hydrate

**Files:**

- Modify: `packages/opencode/webgui/src/state/uiBridgeState.ts:3-22` (type + empty)
- Modify: `packages/opencode/webgui/src/state/uiBridgeState.ts:139-174` (uiBridgeHydrate)
- Test: `packages/opencode/webgui/src/state/uiBridgeState.test.ts`

**Step 1: Write failing tests**

Add to `uiBridgeState.test.ts`:

```ts
it("hydrates v3 openTabs and activeTab", () => {
  const state = uiBridgeStateModule.uiBridgeHydrate({
    sessionID: "s1",
    openTabs: ["s1", "s2"],
    activeTab: "s2",
  })
  expect(state.openTabs).toEqual(["s1", "s2"])
  expect(state.activeTab).toBe("s2")
})

it("falls back to empty tabs when hydrating v2 payload", () => {
  const state = uiBridgeStateModule.uiBridgeHydrate({
    sessionID: "s1",
  })
  expect(state.openTabs).toEqual([])
  expect(state.activeTab).toBe("")
})

it("filters virtual tabs during hydrate", () => {
  const state = uiBridgeStateModule.uiBridgeHydrate({
    openTabs: ["s1", "virtual-temp", "s2"],
    activeTab: "virtual-temp",
  })
  expect(state.openTabs).toEqual(["s1", "s2"])
  expect(state.activeTab).toBe("s2")
})

it("normalizes invalid openTabs entries", () => {
  const state = uiBridgeStateModule.uiBridgeHydrate({
    openTabs: ["s1", 42, null, "s2"],
    activeTab: "s1",
  })
  expect(state.openTabs).toEqual(["s1", "s2"])
  expect(state.activeTab).toBe("s1")
})

it("falls back activeTab when not in openTabs", () => {
  const state = uiBridgeStateModule.uiBridgeHydrate({
    openTabs: ["s1", "s2"],
    activeTab: "missing",
  })
  expect(state.openTabs).toEqual(["s1", "s2"])
  expect(state.activeTab).toBe("s2")
})
```

**Step 2: Run tests to verify they fail**

Run (from webgui dir): `npx vitest run src/state/uiBridgeState.test.ts`
Expected: FAIL — `openTabs` and `activeTab` don't exist on `UiBridgeState`.

**Step 3: Implement changes in uiBridgeState.ts**

1. Update the `UiBridgeState` type — add `openTabs: string[]` and `activeTab: string`, change `v: 2` to `v: 3`.

2. Update `empty` constant to include `openTabs: []` and `activeTab: ""`.

3. Add helper functions:

```ts
function parseTabs(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  return input.filter((id): id is string => typeof id === "string" && !id.startsWith("virtual-"))
}

function sanitizeActiveTab(openTabs: string[], activeTab: unknown): string {
  if (typeof activeTab === "string" && openTabs.includes(activeTab)) return activeTab
  return openTabs[openTabs.length - 1] || ""
}
```

4. In `uiBridgeHydrate()`, parse and add `openTabs`/`activeTab` to the constructed `next` object:

```ts
const openTabs = parseTabs(obj?.openTabs)
const activeTab = sanitizeActiveTab(openTabs, obj?.activeTab)

const next: UiBridgeState = {
  v: 3,
  sessionID,
  // ... existing fields ...
  drafts: nextDrafts,
  openTabs,
  activeTab,
}
```

5. In `uiBridgeUpdate()` (line 221-262), handle `openTabs`/`activeTab` in the patch merge. Filter virtual tabs from `openTabs` when building the next state:

```ts
const nextOpenTabs = Array.isArray(patch.openTabs)
  ? patch.openTabs.filter((id) => typeof id === "string" && !id.startsWith("virtual-"))
  : prev.openTabs
const nextActiveTab =
  typeof patch.activeTab === "string"
    ? nextOpenTabs.includes(patch.activeTab)
      ? patch.activeTab
      : nextOpenTabs[nextOpenTabs.length - 1] || ""
    : prev.activeTab
```

Add these to the `next` object construction. Also update `hasNonDraftChange()` to include `openTabs`/`activeTab` changes (tab changes should send immediately, not be debounced like drafts).

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/state/uiBridgeState.test.ts`
Expected: All PASS.

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/state/uiBridgeState.ts packages/opencode/webgui/src/state/uiBridgeState.test.ts
git commit -m "feat(webgui): add openTabs/activeTab to uiBridgeState v3"
```

---

### Task 2: Export bridge tab accessors from uiBridgeState

**Files:**

- Modify: `packages/opencode/webgui/src/state/uiBridgeState.ts` (add exports)
- Test: `packages/opencode/webgui/src/state/uiBridgeState.test.ts`

**Step 1: Write failing test**

```ts
it("uiBridgeUpdateTabs syncs openTabs and activeTab", () => {
  uiBridgeStateModule.uiBridgeHydrate({})
  uiBridgeStateModule.uiBridgeEnable()
  const setState = ideBridge.setState as any
  setState.mockClear()

  uiBridgeStateModule.uiBridgeUpdateTabs(["s1", "s2"], "s2")

  const state = uiBridgeStateModule.uiBridgeState()
  expect(state.openTabs).toEqual(["s1", "s2"])
  expect(state.activeTab).toBe("s2")
  expect(setState).toHaveBeenCalledTimes(1)
})

it("uiBridgeUpdateTabs filters virtual tabs", () => {
  uiBridgeStateModule.uiBridgeHydrate({})

  uiBridgeStateModule.uiBridgeUpdateTabs(["s1", "virtual-new", "s2"], "virtual-new")

  const state = uiBridgeStateModule.uiBridgeState()
  expect(state.openTabs).toEqual(["s1", "s2"])
  expect(state.activeTab).toBe("s2")
})

it("uiBridgeTabs returns current openTabs and activeTab", () => {
  uiBridgeStateModule.uiBridgeHydrate({ openTabs: ["s1", "s2"], activeTab: "s1" })
  const tabs = uiBridgeStateModule.uiBridgeTabs()
  expect(tabs).toEqual({ openTabs: ["s1", "s2"], activeTab: "s1" })
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/state/uiBridgeState.test.ts`
Expected: FAIL — `uiBridgeUpdateTabs` and `uiBridgeTabs` don't exist.

**Step 3: Implement**

Add to `uiBridgeState.ts`:

```ts
export function uiBridgeTabs() {
  return { openTabs: store.state.openTabs, activeTab: store.state.activeTab }
}

export function uiBridgeUpdateTabs(openTabs: string[], activeTab: string) {
  return uiBridgeUpdate({ openTabs, activeTab })
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/state/uiBridgeState.test.ts`
Expected: All PASS.

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/state/uiBridgeState.ts packages/opencode/webgui/src/state/uiBridgeState.test.ts
git commit -m "feat(webgui): add uiBridgeTabs and uiBridgeUpdateTabs accessors"
```

---

### Task 3: Wire tabStore to read bridge state on init

**Files:**

- Modify: `packages/opencode/webgui/src/state/tabStore.ts:1-101`
- Test: `packages/opencode/webgui/src/state/tabStore.test.ts`

**Step 1: Write failing tests**

Add to `tabStore.test.ts`. First add import and mock setup:

```ts
// At top-level, add mock for uiBridgeState module
vi.mock("./uiBridgeState", () => ({
  uiBridgeTabs: vi.fn(() => ({ openTabs: [], activeTab: "" })),
  uiBridgeUpdateTabs: vi.fn(),
}))

import { uiBridgeTabs, uiBridgeUpdateTabs } from "./uiBridgeState"
```

Then add test:

```ts
it("prefers bridge state over empty localStorage on mount", async () => {
  ;(sdk.kv.get as ReturnType<typeof vi.fn>).mockResolvedValue({
    data: {},
    error: null,
  } satisfies KvGetResult)
  ;(uiBridgeTabs as ReturnType<typeof vi.fn>).mockReturnValue({
    openTabs: ["b1", "b2"],
    activeTab: "b2",
  })

  const { result } = renderHook(() => useTabStore(), { wrapper })

  await waitFor(() => {
    expect(result.current.loaded).toBe(true)
  })

  expect(result.current.openTabs).toEqual(["b1", "b2"])
  expect(result.current.activeTab).toBe("b2")
})

it("prefers localStorage over bridge state when localStorage has tabs", async () => {
  ;(sdk.kv.get as ReturnType<typeof vi.fn>).mockResolvedValue({
    data: {
      [key]: {
        openTabs: ["ls1", "ls2"],
        activeTab: "ls1",
      },
    },
    error: null,
  } satisfies KvGetResult)
  ;(uiBridgeTabs as ReturnType<typeof vi.fn>).mockReturnValue({
    openTabs: ["b1"],
    activeTab: "b1",
  })

  const { result } = renderHook(() => useTabStore(), { wrapper })

  await waitFor(() => {
    expect(result.current.loaded).toBe(true)
  })

  expect(result.current.openTabs).toEqual(["ls1", "ls2"])
  expect(result.current.activeTab).toBe("ls1")
})
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/state/tabStore.test.ts`
Expected: FAIL — bridge state is not consulted.

**Step 3: Implement**

In `tabStore.ts`, add import:

```ts
import { uiBridgeTabs, uiBridgeUpdateTabs } from "./uiBridgeState"
```

Modify the `useEffect` that loads initial state (lines 73-101). After the `sdk.kv.get()` resolves, if localStorage returns no tabs, fall back to bridge state:

```ts
useEffect(() => {
  let live = true
  void sdk.kv
    .get()
    .then((res) => {
      if (!live) return
      const data = parse(res.data?.[key])
      if (data && data.openTabs.length > 0) {
        const tabs = data.openTabs
        const active = data.activeTab
        const validActive = tabs.includes(active) ? active : tabs[tabs.length - 1] || ""
        const next = { openTabs: tabs, activeTab: validActive }
        ref.current = next
        setState(next)
      } else {
        const bridge = uiBridgeTabs()
        if (bridge.openTabs.length > 0) {
          const validActive = bridge.openTabs.includes(bridge.activeTab)
            ? bridge.activeTab
            : bridge.openTabs[bridge.openTabs.length - 1] || ""
          const next = { openTabs: bridge.openTabs, activeTab: validActive }
          ref.current = next
          setState(next)
        }
      }
      setLoaded(true)
    })
    .catch(() => {
      if (!live) return
      const bridge = uiBridgeTabs()
      if (bridge.openTabs.length > 0) {
        const validActive = bridge.openTabs.includes(bridge.activeTab)
          ? bridge.activeTab
          : bridge.openTabs[bridge.openTabs.length - 1] || ""
        const next = { openTabs: bridge.openTabs, activeTab: validActive }
        ref.current = next
        setState(next)
      }
      setLoaded(true)
    })

  return () => {
    live = false
  }
}, [])
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/state/tabStore.test.ts`
Expected: All PASS.

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/state/tabStore.ts packages/opencode/webgui/src/state/tabStore.test.ts
git commit -m "feat(webgui): tabStore reads bridge state as fallback on init"
```

---

### Task 4: Wire tabStore to write bridge state on save

**Files:**

- Modify: `packages/opencode/webgui/src/state/tabStore.ts:39-47,55-59`
- Test: `packages/opencode/webgui/src/state/tabStore.test.ts`

**Step 1: Write failing test**

```ts
it("save calls uiBridgeUpdateTabs alongside sdk.kv.update", async () => {
  ;(uiBridgeTabs as ReturnType<typeof vi.fn>).mockReturnValue({ openTabs: [], activeTab: "" })

  const { result } = renderHook(() => useTabStore(), { wrapper })

  await waitFor(() => {
    expect(result.current.loaded).toBe(true)
  })
  ;(uiBridgeUpdateTabs as ReturnType<typeof vi.fn>).mockClear()

  act(() => {
    result.current.openTab("s1")
    result.current.openTab("s2")
  })

  expect(uiBridgeUpdateTabs).toHaveBeenCalledTimes(2)
  expect(uiBridgeUpdateTabs).toHaveBeenLastCalledWith(["s1", "s2"], "s2")
})
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/state/tabStore.test.ts`
Expected: FAIL — `uiBridgeUpdateTabs` not called.

**Step 3: Implement**

Modify the `store()` function in `tabStore.ts` to also call `uiBridgeUpdateTabs`:

```ts
function store(next: TabState) {
  void sdk.kv
    .update({
      body: {
        [key]: next,
      },
    })
    .catch(() => {})
  uiBridgeUpdateTabs(next.openTabs, next.activeTab)
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/state/tabStore.test.ts`
Expected: All PASS.

**Step 5: Run all webgui tests**

Run: `npx vitest run`
Expected: All PASS — no regressions.

**Step 6: Commit**

```bash
git add packages/opencode/webgui/src/state/tabStore.ts packages/opencode/webgui/src/state/tabStore.test.ts
git commit -m "feat(webgui): tabStore syncs tab state to uiBridgeState on save"
```

---

### Task 5: Verify round-trip and cleanup

**Files:**

- Test: `packages/opencode/webgui/src/state/uiBridgeState.test.ts`

**Step 1: Write round-trip test**

```ts
it("round-trips openTabs through hydrate", () => {
  uiBridgeStateModule.uiBridgeHydrate({ openTabs: ["s1", "s2"], activeTab: "s1" })
  uiBridgeStateModule.uiBridgeUpdateTabs(["s1", "s2", "s3"], "s3")

  const snapshot = uiBridgeStateModule.uiBridgeState()
  uiBridgeStateModule.uiBridgeHydrate(snapshot)

  expect(uiBridgeStateModule.uiBridgeTabs()).toEqual({
    openTabs: ["s1", "s2", "s3"],
    activeTab: "s3",
  })
})
```

**Step 2: Run test**

Run: `npx vitest run src/state/uiBridgeState.test.ts`
Expected: PASS.

**Step 3: Run full webgui test suite**

Run: `npx vitest run`
Expected: All PASS.

**Step 4: Commit**

```bash
git add packages/opencode/webgui/src/state/uiBridgeState.test.ts
git commit -m "test(webgui): add round-trip test for tab bridge persistence"
```
