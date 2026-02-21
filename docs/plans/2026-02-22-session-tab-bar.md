# Session Tab Bar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the dropdown-based session selector with a browser-style tab bar supporting drag-to-reorder, close/open tabs, inline rename, right-click context menu, and status indicators.

**Architecture:** Independent `useTabStore` hook manages tab state (open tabs, order, active tab) persisted via KV API. New `TabBar`, `Tab`, and `TabContextMenu` components render the tab UI inside `CompactHeader`. The existing `SessionDropdown` becomes a history panel triggered by a clock icon button.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vitest + @testing-library/react, native HTML5 Drag and Drop API, existing `sdk.kv` for persistence.

**Design doc:** `docs/plans/2026-02-22-session-tab-bar-design.md`

---

### Task 1: Create `useTabStore` hook — core logic

**Files:**

- Create: `packages/opencode/webgui/src/state/tabStore.ts`
- Test: `packages/opencode/webgui/src/state/tabStore.test.ts`

**Step 1: Write the test file**

Create `packages/opencode/webgui/src/state/tabStore.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

vi.mock("../lib/api/sdkClient", () => ({
  sdk: {
    kv: {
      get: vi.fn(),
      update: vi.fn(),
    },
  },
}))

import { sdk } from "../lib/api/sdkClient"
import { useTabStore } from "./tabStore"

function setup(initial?: { openTabs: string[]; activeTab: string }) {
  vi.mocked(sdk.kv.get).mockResolvedValue({
    data: initial ? { webgui_tabs: initial } : {},
  } as any)
  vi.mocked(sdk.kv.update).mockResolvedValue({} as any)
  return renderHook(() => useTabStore())
}

describe("useTabStore", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("initializes with empty state when KV has no data", async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.openTabs).toEqual([])
    expect(result.current.activeTab).toBe("")
  })

  it("restores tabs from KV on mount", async () => {
    const { result } = setup({ openTabs: ["s1", "s2"], activeTab: "s2" })
    await waitFor(() => expect(result.current.loaded).toBe(true))
    expect(result.current.openTabs).toEqual(["s1", "s2"])
    expect(result.current.activeTab).toBe("s2")
  })

  it("openTab appends and activates a new tab", async () => {
    const { result } = setup({ openTabs: ["s1"], activeTab: "s1" })
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.openTab("s2"))
    expect(result.current.openTabs).toEqual(["s1", "s2"])
    expect(result.current.activeTab).toBe("s2")
  })

  it("openTab activates existing tab without duplicating", async () => {
    const { result } = setup({ openTabs: ["s1", "s2"], activeTab: "s1" })
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.openTab("s2"))
    expect(result.current.openTabs).toEqual(["s1", "s2"])
    expect(result.current.activeTab).toBe("s2")
  })

  it("closeTab removes tab and switches to right neighbor", async () => {
    const { result } = setup({ openTabs: ["s1", "s2", "s3"], activeTab: "s2" })
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.closeTab("s2"))
    expect(result.current.openTabs).toEqual(["s1", "s3"])
    expect(result.current.activeTab).toBe("s3")
  })

  it("closeTab switches to left neighbor when closing rightmost", async () => {
    const { result } = setup({ openTabs: ["s1", "s2"], activeTab: "s2" })
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.closeTab("s2"))
    expect(result.current.openTabs).toEqual(["s1"])
    expect(result.current.activeTab).toBe("s1")
  })

  it("closeTab returns empty when closing last tab", async () => {
    const { result } = setup({ openTabs: ["s1"], activeTab: "s1" })
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.closeTab("s1"))
    expect(result.current.openTabs).toEqual([])
    expect(result.current.activeTab).toBe("")
  })

  it("reorderTabs moves tab from one index to another", async () => {
    const { result } = setup({ openTabs: ["s1", "s2", "s3"], activeTab: "s1" })
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.reorderTabs(2, 0))
    expect(result.current.openTabs).toEqual(["s3", "s1", "s2"])
  })

  it("removeTab silently removes without switching active", async () => {
    const { result } = setup({ openTabs: ["s1", "s2", "s3"], activeTab: "s1" })
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.removeTab("s3"))
    expect(result.current.openTabs).toEqual(["s1", "s2"])
    expect(result.current.activeTab).toBe("s1")
  })

  it("replaceTab swaps one ID for another preserving position", async () => {
    const { result } = setup({ openTabs: ["v1", "s2"], activeTab: "v1" })
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.replaceTab("v1", "real1"))
    expect(result.current.openTabs).toEqual(["real1", "s2"])
    expect(result.current.activeTab).toBe("real1")
  })

  it("closeOtherTabs closes all except the specified tab", async () => {
    const { result } = setup({ openTabs: ["s1", "s2", "s3"], activeTab: "s2" })
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.closeOtherTabs("s2"))
    expect(result.current.openTabs).toEqual(["s2"])
    expect(result.current.activeTab).toBe("s2")
  })

  it("closeTabsToRight closes tabs after the specified one", async () => {
    const { result } = setup({ openTabs: ["s1", "s2", "s3"], activeTab: "s1" })
    await waitFor(() => expect(result.current.loaded).toBe(true))
    act(() => result.current.closeTabsToRight("s1"))
    expect(result.current.openTabs).toEqual(["s1"])
    expect(result.current.activeTab).toBe("s1")
  })
})
```

**Step 2: Run tests to verify they fail**

Run from `packages/opencode/webgui`:

```bash
npx vitest run src/state/tabStore.test.ts
```

Expected: FAIL — `useTabStore` module not found.

**Step 3: Implement `useTabStore`**

Create `packages/opencode/webgui/src/state/tabStore.ts`:

```ts
import { useState, useCallback, useEffect, useRef } from "react"
import { sdk } from "../lib/api/sdkClient"

const KV_KEY = "webgui_tabs"

interface TabState {
  openTabs: string[]
  activeTab: string
}

function persist(state: TabState) {
  sdk.kv.update({ body: { [KV_KEY]: state } }).catch(() => {})
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null

function persistDebounced(state: TabState) {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => persist(state), 500)
}

export function useTabStore() {
  const [openTabs, setOpenTabs] = useState<string[]>([])
  const [activeTab, setActiveTabState] = useState("")
  const [loaded, setLoaded] = useState(false)
  const ref = useRef({ openTabs, activeTab })
  ref.current = { openTabs, activeTab }

  useEffect(() => {
    sdk.kv
      .get()
      .then((res) => {
        const data = (res.data as any)?.[KV_KEY] as TabState | undefined
        if (data?.openTabs) {
          setOpenTabs(data.openTabs)
          setActiveTabState(data.activeTab || data.openTabs[data.openTabs.length - 1] || "")
        }
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  const setActiveTab = useCallback((id: string) => {
    setActiveTabState(id)
    const next = { openTabs: ref.current.openTabs, activeTab: id }
    ref.current = next
    persist(next)
  }, [])

  const openTab = useCallback((id: string) => {
    setOpenTabs((prev) => {
      if (prev.includes(id)) {
        setActiveTabState(id)
        const next = { openTabs: prev, activeTab: id }
        ref.current = next
        persist(next)
        return prev
      }
      const tabs = [...prev, id]
      setActiveTabState(id)
      const next = { openTabs: tabs, activeTab: id }
      ref.current = next
      persist(next)
      return tabs
    })
  }, [])

  const closeTab = useCallback((id: string) => {
    setOpenTabs((prev) => {
      const idx = prev.indexOf(id)
      if (idx === -1) return prev
      const tabs = prev.filter((t) => t !== id)
      let nextActive = ref.current.activeTab
      if (nextActive === id) {
        nextActive = tabs[Math.min(idx, tabs.length - 1)] || ""
      }
      setActiveTabState(nextActive)
      const next = { openTabs: tabs, activeTab: nextActive }
      ref.current = next
      persist(next)
      return tabs
    })
  }, [])

  const removeTab = useCallback((id: string) => {
    setOpenTabs((prev) => {
      if (!prev.includes(id)) return prev
      const tabs = prev.filter((t) => t !== id)
      let nextActive = ref.current.activeTab
      if (nextActive === id) {
        nextActive = tabs[tabs.length - 1] || ""
      }
      setActiveTabState(nextActive)
      const next = { openTabs: tabs, activeTab: nextActive }
      ref.current = next
      persist(next)
      return tabs
    })
  }, [])

  const reorderTabs = useCallback((from: number, to: number) => {
    setOpenTabs((prev) => {
      const tabs = [...prev]
      const [moved] = tabs.splice(from, 1)
      tabs.splice(to, 0, moved)
      const next = { openTabs: tabs, activeTab: ref.current.activeTab }
      ref.current = next
      persistDebounced(next)
      return tabs
    })
  }, [])

  const replaceTab = useCallback((oldId: string, newId: string) => {
    setOpenTabs((prev) => {
      const tabs = prev.map((t) => (t === oldId ? newId : t))
      const nextActive = ref.current.activeTab === oldId ? newId : ref.current.activeTab
      setActiveTabState(nextActive)
      const next = { openTabs: tabs, activeTab: nextActive }
      ref.current = next
      persist(next)
      return tabs
    })
  }, [])

  const closeOtherTabs = useCallback((keepId: string) => {
    setOpenTabs(() => {
      const tabs = [keepId]
      setActiveTabState(keepId)
      const next = { openTabs: tabs, activeTab: keepId }
      ref.current = next
      persist(next)
      return tabs
    })
  }, [])

  const closeTabsToRight = useCallback((id: string) => {
    setOpenTabs((prev) => {
      const idx = prev.indexOf(id)
      if (idx === -1) return prev
      const tabs = prev.slice(0, idx + 1)
      let nextActive = ref.current.activeTab
      if (!tabs.includes(nextActive)) nextActive = id
      setActiveTabState(nextActive)
      const next = { openTabs: tabs, activeTab: nextActive }
      ref.current = next
      persist(next)
      return tabs
    })
  }, [])

  return {
    openTabs,
    activeTab,
    loaded,
    openTab,
    closeTab,
    removeTab,
    setActiveTab,
    reorderTabs,
    replaceTab,
    closeOtherTabs,
    closeTabsToRight,
  }
}
```

**Step 4: Run tests to verify they pass**

Run from `packages/opencode/webgui`:

```bash
npx vitest run src/state/tabStore.test.ts
```

Expected: ALL PASS.

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/state/tabStore.ts packages/opencode/webgui/src/state/tabStore.test.ts
git commit -m "feat(webgui): add useTabStore hook for browser-style tab state management"
```

---

### Task 2: Create `TabContextMenu` component

**Files:**

- Create: `packages/opencode/webgui/src/components/CompactHeader/TabContextMenu.tsx`

**Step 1: Implement the context menu**

Create `packages/opencode/webgui/src/components/CompactHeader/TabContextMenu.tsx`:

```tsx
import { useEffect, useRef } from "react"

interface TabContextMenuProps {
  x: number
  y: number
  sessionId: string
  isShared: boolean
  onClose: () => void
  onCloseTab: () => void
  onCloseOtherTabs: () => void
  onCloseTabsToRight: () => void
  onRename: () => void
  onDelete: () => void
  onToggleShare: () => void
  onOpenShareLink: () => void
}

export function TabContextMenu({
  x,
  y,
  sessionId,
  isShared,
  onClose,
  onCloseTab,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onRename,
  onDelete,
  onToggleShare,
  onOpenShareLink,
}: TabContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [onClose])

  const item =
    "w-full px-3 py-1.5 text-xs text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
  const separator = "my-1 h-px bg-gray-200 dark:bg-gray-700"

  return (
    <div
      ref={ref}
      className="fixed z-[100] min-w-[180px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1"
      style={{ left: x, top: y }}
    >
      <button className={item} onClick={onCloseTab}>
        关闭标签
      </button>
      <button className={item} onClick={onCloseOtherTabs}>
        关闭其他标签
      </button>
      <button className={item} onClick={onCloseTabsToRight}>
        关闭右侧标签
      </button>
      <div className={separator} />
      <button className={item} onClick={onRename}>
        重命名
      </button>
      <button
        className={`${item} text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950`}
        onClick={onDelete}
      >
        删除会话
      </button>
      <div className={separator} />
      <button className={item} onClick={onToggleShare}>
        {isShared ? "取消分享" : "分享会话"}
      </button>
      {isShared && (
        <button className={item} onClick={onOpenShareLink}>
          打开分享链接
        </button>
      )}
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/TabContextMenu.tsx
git commit -m "feat(webgui): add TabContextMenu component for tab right-click actions"
```

---

### Task 3: Create `Tab` component

**Files:**

- Create: `packages/opencode/webgui/src/components/CompactHeader/Tab.tsx`

**Step 1: Implement single tab component**

Create `packages/opencode/webgui/src/components/CompactHeader/Tab.tsx`:

This component handles:

- Display: title (truncated), status dot, close button
- Active state: blue bottom border
- Drag: `draggable`, opacity on drag, events
- Double-click: inline rename via `<input>`
- Right-click: context menu trigger (coordinates passed to parent)

```tsx
import { useState, useRef, useCallback } from "react"
import { isDefaultTitle } from "../../state/SessionContext"

interface TabProps {
  sessionId: string
  title: string
  isActive: boolean
  isBusy: boolean
  isReasoning: boolean
  onActivate: () => void
  onClose: () => void
  onRename: (title: string) => void
  onContextMenu: (x: number, y: number) => void
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
  isDragOver: "left" | "right" | null
}

export function Tab({
  sessionId,
  title,
  isActive,
  isBusy,
  isReasoning,
  onActivate,
  onClose,
  onRename,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragOver,
}: TabProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const displayTitle = title || "新建会话"
  const hasDefault = isDefaultTitle(displayTitle)

  const startEdit = useCallback(() => {
    setEditValue(displayTitle)
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }, [displayTitle])

  const saveEdit = useCallback(() => {
    setEditing(false)
    if (editValue.trim() && editValue !== displayTitle) {
      onRename(editValue.trim())
    }
  }, [editValue, displayTitle, onRename])

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      startEdit()
    },
    [startEdit],
  )

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      onContextMenu(e.clientX, e.clientY)
    },
    [onContextMenu],
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Middle-click close
      if (e.button === 1) {
        e.preventDefault()
        onClose()
      }
    },
    [onClose],
  )

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      setDragging(true)
      e.dataTransfer.effectAllowed = "move"
      e.dataTransfer.setData("text/plain", sessionId)
      onDragStart(e)
    },
    [sessionId, onDragStart],
  )

  const handleDragEnd = useCallback(() => {
    setDragging(false)
    onDragEnd()
  }, [onDragEnd])

  return (
    <div
      className={`group relative flex items-center gap-1 px-2 h-full cursor-pointer select-none flex-shrink-0 border-b-2 transition-colors ${
        isActive
          ? "border-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
          : "border-transparent hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400"
      } ${dragging ? "opacity-50" : ""} ${
        isDragOver === "left" ? "border-l-2 border-l-blue-500" : ""
      } ${isDragOver === "right" ? "border-r-2 border-r-blue-500" : ""}`}
      style={{ minWidth: 120, maxWidth: 200 }}
      draggable={!editing}
      onClick={onActivate}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onMouseDown={handleMouseDown}
      onDragStart={handleDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={handleDragEnd}
    >
      {/* Status dot */}
      {(isBusy || isReasoning) && (
        <span
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            isReasoning ? "bg-purple-500 animate-pulse" : "bg-yellow-500 animate-pulse"
          }`}
        />
      )}

      {/* Title or edit input */}
      {editing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveEdit()
            if (e.key === "Escape") setEditing(false)
          }}
          onBlur={saveEdit}
          onClick={(e) => e.stopPropagation()}
          className="flex-1 min-w-0 px-0.5 py-0 text-xs bg-transparent border border-blue-500 rounded outline-none text-gray-900 dark:text-gray-100"
        />
      ) : (
        <span
          className={`flex-1 min-w-0 truncate text-xs ${hasDefault ? "italic text-gray-400 dark:text-gray-500" : ""}`}
          title={displayTitle}
        >
          {displayTitle}
        </span>
      )}

      {/* Close button */}
      <button
        className={`w-4 h-4 flex items-center justify-center rounded-sm flex-shrink-0 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 ${
          isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        } transition-opacity`}
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        title="关闭标签"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/Tab.tsx
git commit -m "feat(webgui): add Tab component with drag, rename, context menu support"
```

---

### Task 4: Create `TabBar` container component

**Files:**

- Create: `packages/opencode/webgui/src/components/CompactHeader/TabBar.tsx`

**Step 1: Implement the scrollable tab bar container**

Create `packages/opencode/webgui/src/components/CompactHeader/TabBar.tsx`:

This component handles:

- Horizontal scrolling container with wheel→horizontal mapping
- Gradient shadow overflow hints
- Hidden native scrollbar
- Rendering `Tab` components
- Drag state coordination across tabs

```tsx
import { useRef, useState, useCallback, useEffect } from "react"
import { Tab } from "./Tab"
import { TabContextMenu } from "./TabContextMenu"
import { useSession } from "../../state/SessionContext"
import { ideBridge } from "../../lib/ideBridge"

interface TabBarProps {
  openTabs: string[]
  activeTab: string
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onReorder: (from: number, to: number) => void
  onCloseOtherTabs: (id: string) => void
  onCloseTabsToRight: (id: string) => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  onToggleShare: (id: string) => void
}

export function TabBar({
  openTabs,
  activeTab,
  onActivate,
  onClose,
  onReorder,
  onCloseOtherTabs,
  onCloseTabsToRight,
  onRename,
  onDelete,
  onToggleShare,
}: TabBarProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { sessions, isSessionIdle, isSessionReasoning } = useSession()
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const [showLeftShadow, setShowLeftShadow] = useState(false)
  const [showRightShadow, setShowRightShadow] = useState(false)

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null)

  // Check scroll overflow for gradient shadows
  const checkScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setShowLeftShadow(el.scrollLeft > 0)
    setShowRightShadow(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }, [])

  useEffect(() => {
    checkScroll()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener("scroll", checkScroll)
    const observer = new ResizeObserver(checkScroll)
    observer.observe(el)
    return () => {
      el.removeEventListener("scroll", checkScroll)
      observer.disconnect()
    }
  }, [checkScroll, openTabs])

  // Wheel → horizontal scroll
  const handleWheel = useCallback((e: React.WheelEvent) => {
    const el = scrollRef.current
    if (!el) return
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault()
      el.scrollLeft += e.deltaY
    }
  }, [])

  // Drag helpers
  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    setDragOverIdx(idx)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent, toIdx: number) => {
      e.preventDefault()
      if (dragIdx !== null && dragIdx !== toIdx) {
        onReorder(dragIdx, toIdx)
      }
      setDragOverIdx(null)
      setDragIdx(null)
    },
    [dragIdx, onReorder],
  )

  const handleDragEnd = useCallback(() => {
    setDragOverIdx(null)
    setDragIdx(null)
  }, [])

  // Session lookup helper
  const sessionMap = new Map(sessions.map((s) => [s.id, s]))

  return (
    <div className="relative flex-1 h-full min-w-0">
      {/* Left gradient shadow */}
      {showLeftShadow && (
        <div className="absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-white dark:from-gray-950 to-transparent z-10 pointer-events-none" />
      )}

      {/* Scrollable tab area */}
      <div
        ref={scrollRef}
        className="flex h-full items-stretch overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
        onWheel={handleWheel}
      >
        {openTabs.map((id, idx) => {
          const session = sessionMap.get(id)
          const title = session?.title || ""
          const isBusy = !isSessionIdle(id)
          const reasoning = isSessionReasoning(id)
          const isShared = !!session?.share?.url

          return (
            <Tab
              key={id}
              sessionId={id}
              title={title}
              isActive={id === activeTab}
              isBusy={isBusy}
              isReasoning={reasoning}
              onActivate={() => onActivate(id)}
              onClose={() => onClose(id)}
              onRename={(t) => onRename(id, t)}
              onContextMenu={(x, y) => setCtxMenu({ x, y, sessionId: id })}
              onDragStart={() => setDragIdx(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
              isDragOver={
                dragOverIdx === idx && dragIdx !== null && dragIdx !== idx ? (dragIdx < idx ? "right" : "left") : null
              }
            />
          )
        })}
      </div>

      {/* Right gradient shadow */}
      {showRightShadow && (
        <div className="absolute right-0 top-0 bottom-0 w-6 bg-gradient-to-l from-white dark:from-gray-950 to-transparent z-10 pointer-events-none" />
      )}

      {/* Context menu */}
      {ctxMenu && (
        <TabContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          sessionId={ctxMenu.sessionId}
          isShared={!!sessionMap.get(ctxMenu.sessionId)?.share?.url}
          onClose={() => setCtxMenu(null)}
          onCloseTab={() => {
            onClose(ctxMenu.sessionId)
            setCtxMenu(null)
          }}
          onCloseOtherTabs={() => {
            onCloseOtherTabs(ctxMenu.sessionId)
            setCtxMenu(null)
          }}
          onCloseTabsToRight={() => {
            onCloseTabsToRight(ctxMenu.sessionId)
            setCtxMenu(null)
          }}
          onRename={() => {
            // Trigger double-click rename on the Tab — dispatch custom event
            // Simplified: just close menu, user double-clicks
            setCtxMenu(null)
          }}
          onDelete={() => {
            onDelete(ctxMenu.sessionId)
            setCtxMenu(null)
          }}
          onToggleShare={() => {
            onToggleShare(ctxMenu.sessionId)
            setCtxMenu(null)
          }}
          onOpenShareLink={() => {
            const url = sessionMap.get(ctxMenu.sessionId)?.share?.url
            if (url) {
              if (ideBridge.isInstalled()) {
                ideBridge.send({ type: "openUrl", payload: { url } })
              } else {
                window.open(url, "_blank", "noopener,noreferrer")
              }
            }
            setCtxMenu(null)
          }}
        />
      )}
    </div>
  )
}
```

**Step 2: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/TabBar.tsx
git commit -m "feat(webgui): add TabBar container with horizontal scroll, drag coordination, context menu"
```

---

### Task 5: Modify `ActionButtons` — add history button, reorder

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/ActionButtons.tsx`

**Step 1: Update ActionButtons**

Changes needed:

1. Add `onToggleHistory` prop
2. Add history (clock) icon button between new-session and more-menu
3. Reorder: StatusIndicator is handled in parent, so just add history button

In `ActionButtons.tsx`, add:

- New prop: `onToggleHistory: () => void`
- A clock icon button after the `+` button and before the `⋮` button

The clock icon SVG: `M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z`

Specific edits:

- Add `onToggleHistory` to the props interface and destructured params
- Add the history button JSX between new-session button and more-menu div

**Step 2: Run existing tests**

Run from `packages/opencode/webgui`:

```bash
npx vitest run src/components/CompactHeader/ActionButtons.test.tsx
```

Fix any failures due to the new prop (add `onToggleHistory: vi.fn()` to test setup).

**Step 3: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/ActionButtons.tsx packages/opencode/webgui/src/components/CompactHeader/ActionButtons.test.tsx
git commit -m "feat(webgui): add history button to ActionButtons, reorder button layout"
```

---

### Task 6: Modify `CompactHeader` — integrate TabBar

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/index.tsx`

**Step 1: Replace dropdown trigger with TabBar**

Key changes:

1. Import `TabBar` and `useTabStore`
2. Remove the left-side dropdown trigger button (title + chevron)
3. Replace with `<TabBar />` in the left section
4. Move `SessionDropdown` to be triggered by the history button (via `ActionButtons.onToggleHistory`)
5. Wire `useTabStore` actions to `SessionContext` (switchSession on activate, updateSessionTitle on rename, deleteSession on delete, share/unshare on toggle share)
6. Handle session lifecycle: when `sessions` changes, clean up stale tabs; when current session materializes, replace virtual tab
7. Move `dropdownRef` logic to be tied to the history button area instead of the title button area

The `CompactHeader` still receives `onNewSession` from `App.tsx`. When `onNewSession` is called, also call `tabStore.openTab(newVirtualId)`.

Add an effect that watches `currentSession` — if it changed from virtual to real, call `tabStore.replaceTab(virtualId, realId)`.

**Step 2: Run existing tests**

```bash
npx vitest run src/components/CompactHeader/index.test.tsx
```

Update tests to account for the new TabBar rendering instead of the dropdown trigger button.

**Step 3: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/index.tsx packages/opencode/webgui/src/components/CompactHeader/index.test.tsx
git commit -m "feat(webgui): integrate TabBar into CompactHeader, replace dropdown trigger"
```

---

### Task 7: Modify `SessionDropdown` — history panel mode

**Files:**

- Modify: `packages/opencode/webgui/src/components/CompactHeader/SessionDropdown.tsx`

**Step 1: Update session click behavior**

In `SessionDropdown.tsx`, the `handleSelect` function currently calls `uiBridgeUpdate` + `onSessionSelect`. No structural changes needed to this component itself — the parent (`CompactHeader`) will pass a different `onSessionSelect` that calls `tabStore.openTab(sessionId)` instead of `switchSession` directly.

The dropdown positioning may need adjustment since it's now triggered from the right side (history button) rather than the left. Consider changing `left-0` to `right-0` on the dropdown container, or keep it full-width as before.

**Step 2: Run existing tests**

```bash
npx vitest run src/components/CompactHeader/SessionDropdown.test.tsx
```

**Step 3: Commit**

```bash
git add packages/opencode/webgui/src/components/CompactHeader/SessionDropdown.tsx packages/opencode/webgui/src/components/CompactHeader/SessionDropdown.test.tsx
git commit -m "refactor(webgui): adapt SessionDropdown as history panel triggered by history button"
```

---

### Task 8: Modify `App.tsx` — wire tab store to session lifecycle

**Files:**

- Modify: `packages/opencode/webgui/src/App.tsx`

**Step 1: Update App.tsx**

Changes:

1. Import `useTabStore`
2. In `handleNewSession`, after `newVirtual()`, call `tabStore.openTab(virtualSession.id)`
3. Pass `tabStore` to `CompactHeader` (or let `CompactHeader` use the hook directly)
4. When bridge restores a session on startup, also call `tabStore.openTab(sessionId)`

The `CompactHeader` ref interface changes — remove `toggleSessionDropdown` since it's now internal to `CompactHeader`.

**Step 2: Run the full test suite**

```bash
npx vitest run
```

Fix any failures.

**Step 3: Commit**

```bash
git add packages/opencode/webgui/src/App.tsx
git commit -m "feat(webgui): wire tab store into App session lifecycle"
```

---

### Task 9: CSS cleanup and scrollbar hiding

**Files:**

- Modify: `packages/opencode/webgui/src/index.css`

**Step 1: Add scrollbar-hide utility**

Add to `index.css` (if not already present):

```css
/* Hide scrollbar for tab bar */
.scrollbar-hide::-webkit-scrollbar {
  display: none;
}
.scrollbar-hide {
  -ms-overflow-style: none;
  scrollbar-width: none;
}
```

Then update `TabBar.tsx` to use `className="... scrollbar-hide"` instead of inline `style={{ scrollbarWidth: "none" }}`.

**Step 2: Commit**

```bash
git add packages/opencode/webgui/src/index.css packages/opencode/webgui/src/components/CompactHeader/TabBar.tsx
git commit -m "style(webgui): add scrollbar-hide CSS utility for tab bar"
```

---

### Task 10: Full integration test and cleanup

**Step 1: Run the full test suite**

From `packages/opencode/webgui`:

```bash
npx vitest run
```

Fix any remaining test failures. Common issues:

- Tests mocking `useSession` may need to also mock `useTabStore` or provide it
- Tests rendering `CompactHeader` need to account for the TabBar
- Snapshot tests may need updating

**Step 2: Manual smoke test**

Start the dev server and verify:

1. Tabs appear in the header
2. Clicking a tab switches to that session
3. New session creates a tab on the right
4. Close button removes tab (doesn't delete session)
5. Drag-to-reorder works
6. Double-click starts rename
7. Right-click shows context menu
8. History button opens the session dropdown
9. Clicking a session in history opens it as a tab
10. Tabs persist across page reload (KV)
11. Status indicators show on busy/reasoning tabs
12. Horizontal scroll works with mouse wheel
13. Gradient shadows appear on overflow

**Step 3: Final commit**

```bash
git add -A
git commit -m "test(webgui): fix tests for session tab bar integration"
```
