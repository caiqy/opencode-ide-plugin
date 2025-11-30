import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useDebounce, useDebouncedCallback, useDebouncedCallbackAdvanced } from "./useDebounce"

describe("useDebounce", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns initial value immediately", () => {
    const { result } = renderHook(() => useDebounce("initial", 500))
    expect(result.current).toBe("initial")
  })

  it("debounces value changes", async () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 500), {
      initialProps: { value: "initial" },
    })

    expect(result.current).toBe("initial")

    rerender({ value: "updated" })
    expect(result.current).toBe("initial")

    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(result.current).toBe("updated")
  })

  it("cancels previous timeout on rapid changes", async () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 500), {
      initialProps: { value: "initial" },
    })

    rerender({ value: "first" })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    rerender({ value: "second" })
    await act(async () => {
      vi.advanceTimersByTime(300)
    })

    expect(result.current).toBe("initial")

    await act(async () => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current).toBe("second")
  })

  it("handles different delay values", async () => {
    const { result, rerender } = renderHook(({ value }) => useDebounce(value, 1000), {
      initialProps: { value: "initial" },
    })

    rerender({ value: "updated" })
    await act(async () => {
      vi.advanceTimersByTime(999)
    })
    expect(result.current).toBe("initial")

    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current).toBe("updated")
  })

  it("cleans up timeout on unmount", () => {
    const { unmount } = renderHook(() => useDebounce("value", 500))
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe("useDebouncedCallback", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("debounces callback execution", () => {
    const callback = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(callback, 500))

    result.current()
    expect(callback).not.toHaveBeenCalled()

    vi.advanceTimersByTime(500)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it("passes arguments to callback", () => {
    const callback = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(callback, 500))

    result.current("arg1", "arg2")
    vi.advanceTimersByTime(500)

    expect(callback).toHaveBeenCalledWith("arg1", "arg2")
  })

  it("cancels previous calls on rapid invocation", () => {
    const callback = vi.fn()
    const { result } = renderHook(() => useDebouncedCallback(callback, 500))

    result.current()
    vi.advanceTimersByTime(300)

    result.current()
    vi.advanceTimersByTime(300)

    result.current()
    vi.advanceTimersByTime(500)

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it("cleans up on unmount", () => {
    const callback = vi.fn()
    const { result, unmount } = renderHook(() => useDebouncedCallback(callback, 500))

    result.current()
    unmount()

    vi.advanceTimersByTime(500)
    expect(callback).not.toHaveBeenCalled()
  })
})

describe("useDebouncedCallbackAdvanced", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns callback, cancel, flush, and isPending", () => {
    const callbackFn = vi.fn()
    const { result } = renderHook(() => useDebouncedCallbackAdvanced(callbackFn, 500))

    expect(typeof result.current.callback).toBe("function")
    expect(typeof result.current.cancel).toBe("function")
    expect(typeof result.current.flush).toBe("function")
    expect(typeof result.current.isPending).toBe("boolean")
  })

  it("sets isPending to true when callback is scheduled", async () => {
    const callbackFn = vi.fn()
    const { result } = renderHook(() => useDebouncedCallbackAdvanced(callbackFn, 500))

    expect(result.current.isPending).toBe(false)

    act(() => {
      result.current.callback()
    })
    expect(result.current.isPending).toBe(true)

    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(result.current.isPending).toBe(false)
  })

  it("cancels pending callback", () => {
    const callbackFn = vi.fn()
    const { result } = renderHook(() => useDebouncedCallbackAdvanced(callbackFn, 500))

    act(() => {
      result.current.callback()
    })
    expect(result.current.isPending).toBe(true)

    act(() => {
      result.current.cancel()
    })
    expect(result.current.isPending).toBe(false)

    vi.advanceTimersByTime(500)
    expect(callbackFn).not.toHaveBeenCalled()
  })

  it("flushes pending callback immediately", () => {
    const callbackFn = vi.fn()
    const { result } = renderHook(() => useDebouncedCallbackAdvanced(callbackFn, 500))

    act(() => {
      result.current.callback("test")
    })
    expect(callbackFn).not.toHaveBeenCalled()

    act(() => {
      result.current.flush()
    })
    expect(callbackFn).toHaveBeenCalledWith("test")
    expect(result.current.isPending).toBe(false)
  })

  it("does nothing when flushing with no pending callback", () => {
    const callback = vi.fn()
    const { result } = renderHook(() => useDebouncedCallbackAdvanced(callback, 500))

    result.current.flush()
    expect(callback).not.toHaveBeenCalled()
  })
})
