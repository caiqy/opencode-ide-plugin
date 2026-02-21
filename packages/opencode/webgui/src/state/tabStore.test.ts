import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
import { useTabStore } from "./tabStore"

const key = "webgui_tabs"

describe("useTabStore", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    ;(sdk.kv.get as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.kv.update as any).mockResolvedValue({ data: {}, error: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("loads persisted tabs on mount", async () => {
    ;(sdk.kv.get as any).mockResolvedValue({
      data: {
        [key]: {
          openTabs: ["s1", "s2"],
          activeTab: "s2",
        },
      },
      error: null,
    })

    const { result } = renderHook(() => useTabStore())

    expect(result.current.loaded).toBe(false)

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    expect(result.current.openTabs).toEqual(["s1", "s2"])
    expect(result.current.activeTab).toBe("s2")
    expect(sdk.kv.get).toHaveBeenCalledTimes(1)
  })

  it("falls back to empty state when persisted data is invalid", async () => {
    ;(sdk.kv.get as any).mockResolvedValue({
      data: {
        [key]: {
          openTabs: ["s1", 2],
          activeTab: null,
        },
      },
      error: null,
    })

    const { result } = renderHook(() => useTabStore())

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    expect(result.current.openTabs).toEqual([])
    expect(result.current.activeTab).toBe("")
  })

  it("openTab appends new tabs and activates existing tabs", async () => {
    const { result } = renderHook(() => useTabStore())

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
    const { result } = renderHook(() => useTabStore())

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
    const { result } = renderHook(() => useTabStore())

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

  it("removeTab removes silently without switching active", async () => {
    const { result } = renderHook(() => useTabStore())

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    act(() => {
      result.current.openTab("s1")
      result.current.openTab("s2")
      result.current.removeTab("s2")
    })

    expect(result.current.openTabs).toEqual(["s1"])
    expect(result.current.activeTab).toBe("s2")
  })

  it("setActiveTab persists active tab without reordering", async () => {
    const { result } = renderHook(() => useTabStore())

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

  it("replaceTab keeps position and updates active when needed", async () => {
    const { result } = renderHook(() => useTabStore())

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

  it("closeOtherTabs and closeTabsToRight keep the right tabs", async () => {
    const { result } = renderHook(() => useTabStore())

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
    expect(result.current.activeTab).toBe("s3")

    act(() => {
      result.current.closeOtherTabs("s2")
    })

    expect(result.current.openTabs).toEqual(["s2"])
    expect(result.current.activeTab).toBe("s2")
  })

  it("reorderTabs updates order and persists with 500ms debounce", async () => {
    const { result } = renderHook(() => useTabStore())

    await waitFor(() => {
      expect(result.current.loaded).toBe(true)
    })

    vi.useFakeTimers()

    act(() => {
      result.current.openTab("s1")
      result.current.openTab("s2")
      result.current.openTab("s3")
    })
    ;(sdk.kv.update as any).mockClear()

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
})
