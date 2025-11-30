import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"
import { useLocalStorage, useLocalStorageValue, useLocalStorageKey } from "./useLocalStorage"

describe("useLocalStorage", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it("returns initial value when no value in localStorage", () => {
    const { result } = renderHook(() => useLocalStorage("test-key", "initial"))
    expect(result.current[0]).toBe("initial")
  })

  it("returns stored value from localStorage", () => {
    localStorage.setItem("test-key", JSON.stringify("stored"))
    const { result } = renderHook(() => useLocalStorage("test-key", "initial"))
    expect(result.current[0]).toBe("stored")
  })

  it("updates value in localStorage", () => {
    const { result } = renderHook(() => useLocalStorage("test-key", "initial"))

    act(() => {
      result.current[1]("updated")
    })

    expect(result.current[0]).toBe("updated")
    expect(localStorage.getItem("test-key")).toBe(JSON.stringify("updated"))
  })

  it("accepts function updater", () => {
    const { result } = renderHook(() => useLocalStorage("test-key", 5))

    act(() => {
      result.current[1]((prev) => prev + 1)
    })

    expect(result.current[0]).toBe(6)
  })

  it("handles complex objects", () => {
    const obj = { name: "John", age: 30 }
    const { result } = renderHook(() => useLocalStorage("test-key", obj))

    expect(result.current[0]).toEqual(obj)

    act(() => {
      result.current[1]({ name: "Jane", age: 25 })
    })

    expect(result.current[0]).toEqual({ name: "Jane", age: 25 })
    expect(JSON.parse(localStorage.getItem("test-key") || "")).toEqual({ name: "Jane", age: 25 })
  })

  it("removes item when set to null", () => {
    localStorage.setItem("test-key", JSON.stringify("value"))
    const { result } = renderHook(() => useLocalStorage<string | null>("test-key", "initial"))

    act(() => {
      result.current[1](null)
    })

    expect(result.current[0]).toBe("initial")
    expect(localStorage.getItem("test-key")).toBeNull()
  })

  it("removes item when set to undefined", () => {
    localStorage.setItem("test-key", JSON.stringify("value"))
    const { result } = renderHook(() => useLocalStorage<string | undefined>("test-key", "initial"))

    act(() => {
      result.current[1](undefined as any)
    })

    expect(result.current[0]).toBe("initial")
    expect(localStorage.getItem("test-key")).toBeNull()
  })

  it("handles JSON parse errors gracefully", () => {
    localStorage.setItem("test-key", "invalid json")
    const { result } = renderHook(() => useLocalStorage("test-key", "fallback"))
    expect(result.current[0]).toBe("fallback")
  })

  it("syncs across tabs with storage event", () => {
    const { result } = renderHook(() => useLocalStorage("test-key", "initial", { syncAcrossTabs: true }))

    act(() => {
      localStorage.setItem("test-key", JSON.stringify("synced"))
      const event = new StorageEvent("storage", {
        key: "test-key",
        newValue: JSON.stringify("synced"),
        oldValue: JSON.stringify("initial"),
        storageArea: localStorage,
        url: window.location.href,
      })
      window.dispatchEvent(event)
    })

    expect(result.current[0]).toBe("synced")
  })

  it("ignores storage events for different keys", () => {
    const { result } = renderHook(() => useLocalStorage("test-key", "initial"))

    act(() => {
      const event = new StorageEvent("storage", {
        key: "other-key",
        newValue: JSON.stringify("other"),
        storageArea: localStorage,
      })
      window.dispatchEvent(event)
    })

    expect(result.current[0]).toBe("initial")
  })
})

describe("useLocalStorageValue", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it("returns stored value", () => {
    localStorage.setItem("test-key", JSON.stringify("stored"))
    const { result } = renderHook(() => useLocalStorageValue("test-key", "fallback"))
    expect(result.current).toBe("stored")
  })

  it("returns fallback when key does not exist", () => {
    const { result } = renderHook(() => useLocalStorageValue("test-key", "fallback"))
    expect(result.current).toBe("fallback")
  })

  it("handles complex objects", () => {
    const obj = { data: "value" }
    localStorage.setItem("test-key", JSON.stringify(obj))
    const { result } = renderHook(() => useLocalStorageValue("test-key", {}))
    expect(result.current).toEqual(obj)
  })

  it("handles JSON parse errors", () => {
    localStorage.setItem("test-key", "invalid json")
    const { result } = renderHook(() => useLocalStorageValue("test-key", "fallback"))
    expect(result.current).toBe("fallback")
  })
})

describe("useLocalStorageKey", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it("returns true when key exists", () => {
    localStorage.setItem("test-key", "value")
    const { result } = renderHook(() => useLocalStorageKey("test-key"))
    expect(result.current).toBe(true)
  })

  it("returns false when key does not exist", () => {
    const { result } = renderHook(() => useLocalStorageKey("test-key"))
    expect(result.current).toBe(false)
  })
})
