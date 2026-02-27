import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createElement, type ReactNode } from "react"

const mocks = vi.hoisted(() => {
  return {
    loadTabs: vi.fn(
      async (): Promise<{ open_tabs: string[]; active_tab: string }> => ({
        open_tabs: [],
        active_tab: "",
      }),
    ),
    saveOpenTabs: vi.fn(async (_value: unknown) => ({ open_tabs: [], active_tab: "" })),
    activateTab: vi.fn(async (_sessionId: string) => ({ ok: true })),
  }
})

vi.mock("./repo/tabsRepo", () => {
  return {
    loadTabs: () => mocks.loadTabs(),
    saveOpenTabs: (value: unknown) => mocks.saveOpenTabs(value),
    activateTab: (sessionId: string) => mocks.activateTab(sessionId),
  }
})

import { TabStoreProvider, useTabStore } from "./tabStore"

function wrapper({ children }: { children: ReactNode }) {
  return createElement(TabStoreProvider, null, children)
}

describe("useTabStore", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.loadTabs.mockResolvedValue({ open_tabs: [], active_tab: "" })
    mocks.saveOpenTabs.mockResolvedValue({ open_tabs: [], active_tab: "" })
    mocks.activateTab.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("loads persisted tabs on mount", async () => {
    mocks.loadTabs.mockResolvedValueOnce({
      open_tabs: ["s1", "s2"],
      active_tab: "s2",
    })

    const { result } = renderHook(() => useTabStore(), { wrapper })

    expect(result.current.loaded).toBe(false)

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    expect(result.current.openTabs).toEqual(["s1", "s2"])
    expect(result.current.activeTab).toBe("s2")
    expect(mocks.loadTabs).toHaveBeenCalledTimes(1)
  })

  it("normalizes persisted active tab when id is missing", async () => {
    mocks.loadTabs.mockResolvedValueOnce({
      open_tabs: ["s1", "s2"],
      active_tab: "missing",
    })

    const { result } = renderHook(() => useTabStore(), { wrapper })

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    expect(result.current.openTabs).toEqual(["s1", "s2"])
    expect(result.current.activeTab).toBe("s2")
  })

  it("falls back to empty state when persisted data is invalid", async () => {
    mocks.loadTabs.mockResolvedValueOnce({
      open_tabs: [],
      active_tab: "",
    })

    const { result } = renderHook(() => useTabStore(), { wrapper })

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    expect(result.current.openTabs).toEqual([])
    expect(result.current.activeTab).toBe("")
  })

  it("openTab appends new tabs and activates existing tabs", async () => {
    const { result } = renderHook(() => useTabStore(), { wrapper })

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    act(() => {
      result.current.openTab("s1")
      result.current.openTab("s2")
      result.current.openTab("s1")
    })

    expect(result.current.openTabs).toEqual(["s1", "s2"])
    expect(result.current.activeTab).toBe("s1")
    expect(mocks.saveOpenTabs).toHaveBeenCalledTimes(2)
    expect(mocks.activateTab).toHaveBeenCalledWith("s1")
    expect(mocks.saveOpenTabs).toHaveBeenLastCalledWith(["s1", "s2"])
  })

  it("openTab 仅激活已存在标签时走 activateTab 入口", async () => {
    const { result } = renderHook(() => useTabStore(), { wrapper })

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    act(() => {
      result.current.openTab("s1")
    })

    mocks.saveOpenTabs.mockClear()
    mocks.activateTab.mockClear()

    act(() => {
      result.current.openTab("s1")
    })

    expect(result.current.openTabs).toEqual(["s1"])
    expect(result.current.activeTab).toBe("s1")
    expect(mocks.activateTab).toHaveBeenCalledWith("s1")
    expect(mocks.saveOpenTabs).not.toHaveBeenCalled()
  })

  it("openTab keeps at most six tabs and evicts oldest", async () => {
    const { result } = renderHook(() => useTabStore(), { wrapper })

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    act(() => {
      result.current.openTab("s1")
      result.current.openTab("s2")
      result.current.openTab("s3")
      result.current.openTab("s4")
      result.current.openTab("s5")
      result.current.openTab("s6")
      result.current.openTab("s7")
    })

    expect(result.current.openTabs).toEqual(["s2", "s3", "s4", "s5", "s6", "s7"])
    expect(result.current.activeTab).toBe("s7")
  })

  it("closeTab switches active to right neighbor or left when rightmost", async () => {
    const { result } = renderHook(() => useTabStore(), { wrapper })

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    act(() => {
      result.current.openTab("s1")
      result.current.openTab("s2")
      result.current.openTab("s3")
      result.current.activateTab("s2")
      result.current.closeTab("s2")
    })

    expect(result.current.openTabs).toEqual(["s1", "s3"])
    expect(result.current.activeTab).toBe("s3")

    act(() => {
      result.current.closeTab("s3")
    })

    expect(result.current.openTabs).toEqual(["s1"])
    expect(result.current.activeTab).toBe("s1")
  })

  it("closeTab clears activeTab when closing last tab", async () => {
    const { result } = renderHook(() => useTabStore(), { wrapper })

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    act(() => {
      result.current.openTab("s1")
      result.current.closeTab("s1")
    })

    expect(result.current.openTabs).toEqual([])
    expect(result.current.activeTab).toBe("")
  })

  it("activateTab is no-op for non-existing tab", async () => {
    const { result } = renderHook(() => useTabStore(), { wrapper })

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    act(() => {
      result.current.openTab("s1")
    })

    mocks.saveOpenTabs.mockClear()

    act(() => {
      result.current.activateTab("missing")
    })

    expect(result.current.openTabs).toEqual(["s1"])
    expect(result.current.activeTab).toBe("s1")
    expect(mocks.saveOpenTabs).not.toHaveBeenCalled()
  })

  it("removeTab switches active to last remaining tab when removing active", async () => {
    const { result } = renderHook(() => useTabStore(), { wrapper })

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    act(() => {
      result.current.openTab("s1")
      result.current.openTab("s2")
      result.current.removeTab("s2")
    })

    expect(result.current.openTabs).toEqual(["s1"])
    expect(result.current.activeTab).toBe("s1")
  })

  it("replaceTab keeps position and updates active when needed", async () => {
    const { result } = renderHook(() => useTabStore(), { wrapper })

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    act(() => {
      result.current.openTab("v1")
      result.current.openTab("s2")
      result.current.replaceTab("v1", "s1")
    })

    expect(result.current.openTabs).toEqual(["s1", "s2"])
    expect(result.current.activeTab).toBe("s2")

    act(() => {
      result.current.activateTab("s1")
      result.current.replaceTab("s1", "s1-real")
    })

    expect(result.current.activeTab).toBe("s1-real")
  })

  it("replaceTab removes old tab when new tab already exists", async () => {
    const { result } = renderHook(() => useTabStore(), { wrapper })

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    act(() => {
      result.current.openTab("old")
      result.current.openTab("new")
      result.current.activateTab("old")
      result.current.replaceTab("old", "new")
    })

    expect(result.current.openTabs).toEqual(["new"])
    expect(result.current.activeTab).toBe("new")
  })

  it("closeOtherTabs and closeTabsToRight keep expected tabs", async () => {
    const { result } = renderHook(() => useTabStore(), { wrapper })

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    act(() => {
      result.current.openTab("s1")
      result.current.openTab("s2")
      result.current.openTab("s3")
      result.current.closeTabsToRight("s2")
    })

    expect(result.current.openTabs).toEqual(["s1", "s2"])
    expect(result.current.activeTab).toBe("s2")

    act(() => {
      result.current.closeOtherTabs("s2")
    })

    expect(result.current.openTabs).toEqual(["s2"])
    expect(result.current.activeTab).toBe("s2")
  })

  it("reorderTabs updates order and persists with 500ms debounce", async () => {
    const { result } = renderHook(() => useTabStore(), { wrapper })

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    vi.useFakeTimers()

    act(() => {
      result.current.openTab("s1")
      result.current.openTab("s2")
      result.current.openTab("s3")
    })

    mocks.saveOpenTabs.mockClear()

    act(() => {
      result.current.reorderTabs(2, 0)
      result.current.reorderTabs(0, 1)
    })

    expect(result.current.openTabs).toEqual(["s1", "s3", "s2"])
    expect(mocks.saveOpenTabs).toHaveBeenCalledTimes(0)

    act(() => {
      vi.advanceTimersByTime(499)
    })

    expect(mocks.saveOpenTabs).toHaveBeenCalledTimes(0)

    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(mocks.saveOpenTabs).toHaveBeenCalledTimes(1)
    expect(mocks.saveOpenTabs).toHaveBeenCalledWith(["s1", "s3", "s2"])
  })

  it("flushes pending reorder persistence on unmount", async () => {
    const { result, unmount } = renderHook(() => useTabStore(), { wrapper })

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    vi.useFakeTimers()

    act(() => {
      result.current.openTab("s1")
      result.current.openTab("s2")
      result.current.openTab("s3")
    })

    mocks.saveOpenTabs.mockClear()

    act(() => {
      result.current.reorderTabs(2, 0)
    })

    expect(mocks.saveOpenTabs).toHaveBeenCalledTimes(0)

    unmount()

    expect(mocks.saveOpenTabs).toHaveBeenCalledTimes(1)
    expect(mocks.saveOpenTabs).toHaveBeenCalledWith(["s3", "s1", "s2"])
  })

  it("pruneTabs is a no-op when all tabs are valid", async () => {
    const { result } = renderHook(() => useTabStore(), { wrapper })

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    act(() => {
      result.current.openTab("s1")
      result.current.openTab("s2")
    })

    mocks.saveOpenTabs.mockClear()

    act(() => {
      result.current.pruneTabs(new Set(["s1", "s2"]))
    })

    expect(result.current.openTabs).toEqual(["s1", "s2"])
    expect(mocks.saveOpenTabs).not.toHaveBeenCalled()
  })

  it("pruneTabs removes deleted sessions and normalizes active tab", async () => {
    const { result } = renderHook(() => useTabStore(), { wrapper })

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    act(() => {
      result.current.openTab("s1")
      result.current.openTab("s2")
      result.current.openTab("s3")
      result.current.activateTab("s2")
    })

    mocks.saveOpenTabs.mockClear()

    act(() => {
      result.current.pruneTabs(new Set(["s1", "s3"]))
    })

    expect(result.current.openTabs).toEqual(["s1", "s3"])
    expect(result.current.activeTab).toBe("s3")
    await waitFor(() => {
      expect(mocks.saveOpenTabs).toHaveBeenCalledWith(["s1", "s3"])
      expect(mocks.activateTab).toHaveBeenCalledWith("s3")
    })
  })
})
