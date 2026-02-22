import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createElement, type ReactNode } from "react"

vi.mock("../lib/api/sdkClient", () => {
  return {
    sdk: {
      kv: {
        get: vi.fn(),
        update: vi.fn(),
      },
    },
  }
})

import { sdk } from "../lib/api/sdkClient"
import { TabStoreProvider, useTabStore } from "./tabStore"

const key = "webgui_tabs"
type KvGetResult = Awaited<ReturnType<typeof sdk.kv.get>>
type KvUpdateResult = Awaited<ReturnType<typeof sdk.kv.update>>

function wrapper({ children }: { children: ReactNode }) {
  return createElement(TabStoreProvider, null, children)
}

describe("useTabStore", () => {
  beforeEach(() => {
    const get = sdk.kv.get as ReturnType<typeof vi.fn>
    const update = sdk.kv.update as ReturnType<typeof vi.fn>
    vi.resetAllMocks()
    get.mockResolvedValue({ data: {}, error: null } satisfies KvGetResult)
    update.mockResolvedValue({ data: {}, error: null } satisfies KvUpdateResult)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("loads persisted tabs on mount", async () => {
    ;(sdk.kv.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        [key]: {
          openTabs: ["s1", "s2"],
          activeTab: "s2",
        },
      },
      error: null,
    } satisfies KvGetResult)

    const { result } = renderHook(() => useTabStore(), { wrapper })

    expect(result.current.loaded).toBe(false)

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    expect(result.current.openTabs).toEqual(["s1", "s2"])
    expect(result.current.activeTab).toBe("s2")
    expect(sdk.kv.get).toHaveBeenCalledTimes(1)
  })

  it("normalizes persisted active tab when id is missing", async () => {
    ;(sdk.kv.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        [key]: {
          openTabs: ["s1", "s2"],
          activeTab: "missing",
        },
      },
      error: null,
    } satisfies KvGetResult)

    const { result } = renderHook(() => useTabStore(), { wrapper })

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    expect(result.current.openTabs).toEqual(["s1", "s2"])
    expect(result.current.activeTab).toBe("s2")
  })

  it("falls back to empty state when persisted data is invalid", async () => {
    ;(sdk.kv.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        [key]: {
          openTabs: ["s1", 2],
          activeTab: null,
        },
      },
      error: null,
    } as KvGetResult)

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
    expect(sdk.kv.update).toHaveBeenCalledTimes(3)
    expect(sdk.kv.update).toHaveBeenLastCalledWith({
      body: {
        [key]: {
          openTabs: ["s1", "s2"],
          activeTab: "s1",
        },
      },
    })
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
      result.current.setActiveTab("s2")
      result.current.closeTab("s2")
    })

    expect(result.current.openTabs).toEqual(["s1", "s3"])
    expect(result.current.activeTab).toBe("s3")

    act(() => {
      result.current.closeTab("s3")
    })

    expect(result.current.openTabs).toEqual(["s1"])
    expect(result.current.activeTab).toBe("s1")

    act(() => {
      result.current.closeTab("s1")
    })

    expect(result.current.openTabs).toEqual([])
    expect(result.current.activeTab).toBe("")
  })

  it("closeTab keeps active tab when closing a different tab", async () => {
    const { result } = renderHook(() => useTabStore(), { wrapper })

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    act(() => {
      result.current.openTab("s1")
      result.current.openTab("s2")
      result.current.openTab("s3")
      result.current.setActiveTab("s2")
      result.current.closeTab("s1")
    })

    expect(result.current.openTabs).toEqual(["s2", "s3"])
    expect(result.current.activeTab).toBe("s2")
  })

  it("removeTab switches active to last remaining tab when active is removed", async () => {
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

  it("setActiveTab persists active tab without reordering", async () => {
    const { result } = renderHook(() => useTabStore(), { wrapper })

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    act(() => {
      result.current.openTab("s1")
      result.current.openTab("s2")
      result.current.setActiveTab("s1")
    })

    expect(result.current.openTabs).toEqual(["s1", "s2"])
    expect(result.current.activeTab).toBe("s1")
  })

  it("setActiveTab ignores ids that are not open", async () => {
    const { result } = renderHook(() => useTabStore(), { wrapper })

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    act(() => {
      result.current.openTab("s1")
      result.current.setActiveTab("missing")
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
      result.current.setActiveTab("s1")
      result.current.replaceTab("s1", "s1-real")
    })

    expect(result.current.activeTab).toBe("s1-real")
  })

  it("replaceTab removes old id when new id already exists", async () => {
    const { result } = renderHook(() => useTabStore(), { wrapper })

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    act(() => {
      result.current.openTab("old")
      result.current.openTab("new")
      result.current.setActiveTab("old")
      result.current.replaceTab("old", "new")
    })

    expect(result.current.openTabs).toEqual(["new"])
    expect(result.current.activeTab).toBe("new")
  })

  it("closeOtherTabs and closeTabsToRight keep the right tabs", async () => {
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

  it("shares one store instance across multiple consumers", async () => {
    const { result } = renderHook(
      () => {
        const first = useTabStore()
        const second = useTabStore()
        return { first, second }
      },
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current.first.loaded).toBe(true)
      expect(result.current.second.loaded).toBe(true)
    })

    expect(sdk.kv.get).toHaveBeenCalledTimes(1)

    act(() => {
      result.current.first.openTab("shared")
    })

    expect(result.current.second.openTabs).toEqual(["shared"])
    expect(result.current.second.activeTab).toBe("shared")
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
    ;(sdk.kv.update as ReturnType<typeof vi.fn>).mockClear()

    act(() => {
      result.current.reorderTabs(2, 0)
      result.current.reorderTabs(0, 1)
    })

    expect(result.current.openTabs).toEqual(["s1", "s3", "s2"])
    expect(sdk.kv.update).toHaveBeenCalledTimes(0)

    act(() => {
      vi.advanceTimersByTime(499)
    })

    expect(sdk.kv.update).toHaveBeenCalledTimes(0)

    act(() => {
      vi.advanceTimersByTime(1)
    })

    expect(sdk.kv.update).toHaveBeenCalledTimes(1)
    expect(sdk.kv.update).toHaveBeenCalledWith({
      body: {
        [key]: {
          openTabs: ["s1", "s3", "s2"],
          activeTab: "s3",
        },
      },
    })
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
    ;(sdk.kv.update as ReturnType<typeof vi.fn>).mockClear()

    act(() => {
      result.current.reorderTabs(2, 0)
    })

    expect(sdk.kv.update).toHaveBeenCalledTimes(0)

    unmount()

    expect(sdk.kv.update).toHaveBeenCalledTimes(1)
    expect(sdk.kv.update).toHaveBeenCalledWith({
      body: {
        [key]: {
          openTabs: ["s3", "s1", "s2"],
          activeTab: "s3",
        },
      },
    })
  })
})
