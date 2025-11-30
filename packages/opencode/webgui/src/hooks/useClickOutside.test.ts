import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook } from "@testing-library/react"
import { useClickOutside, useClickOutsideMultiple, useClickOutsideWithEscape } from "./useClickOutside"
import { createRef } from "react"

describe("useClickOutside", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  it("calls callback when clicking outside element", () => {
    const callback = vi.fn()
    const ref = createRef<HTMLDivElement>()
    const element = document.createElement("div")
    document.body.appendChild(element)
    ;(ref as any).current = element

    renderHook(() => useClickOutside(ref, callback))

    const event = new MouseEvent("mousedown", { bubbles: true })
    document.body.dispatchEvent(event)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it("does not call callback when clicking inside element", () => {
    const callback = vi.fn()
    const ref = createRef<HTMLDivElement>()
    const element = document.createElement("div")
    document.body.appendChild(element)
    ;(ref as any).current = element

    renderHook(() => useClickOutside(ref, callback))

    element.click()
    expect(callback).not.toHaveBeenCalled()
  })

  it("does not call callback when clicking excluded element", () => {
    const callback = vi.fn()
    const ref = createRef<HTMLDivElement>()
    const excludeRef = createRef<HTMLDivElement>()

    const element = document.createElement("div")
    const excludedElement = document.createElement("div")
    document.body.appendChild(element)
    document.body.appendChild(excludedElement)
    ;(ref as any).current = element
    ;(excludeRef as any).current = excludedElement

    renderHook(() => useClickOutside(ref, callback, { excludeRefs: [excludeRef as any] }))

    const event = new MouseEvent("mousedown", { bubbles: true })
    excludedElement.dispatchEvent(event)
    expect(callback).not.toHaveBeenCalled()
  })

  it("handles ref with null current", () => {
    const callback = vi.fn()
    const ref = createRef<HTMLDivElement>()

    expect(() => renderHook(() => useClickOutside(ref, callback))).not.toThrow()

    document.body.click()
    expect(callback).not.toHaveBeenCalled()
  })

  it("cleans up event listener on unmount", () => {
    const callback = vi.fn()
    const ref = createRef<HTMLDivElement>()
    const element = document.createElement("div")
    document.body.appendChild(element)
    ;(ref as any).current = element

    const { unmount } = renderHook(() => useClickOutside(ref, callback))

    unmount()

    document.body.click()
    expect(callback).not.toHaveBeenCalled()
  })
})

describe("useClickOutsideMultiple", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  it("calls callback when clicking outside all elements", () => {
    const callback = vi.fn()
    const ref1 = createRef<HTMLDivElement>()
    const ref2 = createRef<HTMLDivElement>()

    const element1 = document.createElement("div")
    const element2 = document.createElement("div")
    document.body.appendChild(element1)
    document.body.appendChild(element2)
    ;(ref1 as any).current = element1
    ;(ref2 as any).current = element2

    renderHook(() => useClickOutsideMultiple([ref1, ref2], callback))

    const event = new MouseEvent("mousedown", { bubbles: true })
    document.body.dispatchEvent(event)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it("does not call callback when clicking inside any element", () => {
    const callback = vi.fn()
    const ref1 = createRef<HTMLDivElement>()
    const ref2 = createRef<HTMLDivElement>()

    const element1 = document.createElement("div")
    const element2 = document.createElement("div")
    document.body.appendChild(element1)
    document.body.appendChild(element2)
    ;(ref1 as any).current = element1
    ;(ref2 as any).current = element2

    renderHook(() => useClickOutsideMultiple([ref1, ref2], callback))

    element1.click()
    expect(callback).not.toHaveBeenCalled()

    element2.click()
    expect(callback).not.toHaveBeenCalled()
  })

  it("handles empty refs array", () => {
    const callback = vi.fn()

    expect(() => renderHook(() => useClickOutsideMultiple([], callback))).not.toThrow()

    const event = new MouseEvent("mousedown", { bubbles: true })
    document.body.dispatchEvent(event)
    expect(callback).toHaveBeenCalled()
  })
})

describe("useClickOutsideWithEscape", () => {
  beforeEach(() => {
    document.body.innerHTML = ""
  })

  it("calls callback when clicking outside", () => {
    const callback = vi.fn()
    const ref = createRef<HTMLDivElement>()
    const element = document.createElement("div")
    document.body.appendChild(element)
    ;(ref as any).current = element

    renderHook(() => useClickOutsideWithEscape(ref, callback))

    const event = new MouseEvent("mousedown", { bubbles: true })
    document.body.dispatchEvent(event)
    expect(callback).toHaveBeenCalledTimes(1)
  })

  it("calls callback when pressing Escape key", () => {
    const callback = vi.fn()
    const ref = createRef<HTMLDivElement>()
    const element = document.createElement("div")
    document.body.appendChild(element)
    ;(ref as any).current = element

    renderHook(() => useClickOutsideWithEscape(ref, callback))

    const event = new KeyboardEvent("keydown", { key: "Escape" })
    document.dispatchEvent(event)

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it("does not call callback for other keys", () => {
    const callback = vi.fn()
    const ref = createRef<HTMLDivElement>()
    const element = document.createElement("div")
    document.body.appendChild(element)
    ;(ref as any).current = element

    renderHook(() => useClickOutsideWithEscape(ref, callback))

    const event = new KeyboardEvent("keydown", { key: "Enter" })
    document.dispatchEvent(event)

    expect(callback).not.toHaveBeenCalled()
  })

  it("cleans up event listeners on unmount", () => {
    const callback = vi.fn()
    const ref = createRef<HTMLDivElement>()
    const element = document.createElement("div")
    document.body.appendChild(element)
    ;(ref as any).current = element

    const { unmount } = renderHook(() => useClickOutsideWithEscape(ref, callback))

    unmount()

    const mouseEvent = new MouseEvent("mousedown", { bubbles: true })
    document.body.dispatchEvent(mouseEvent)
    const event = new KeyboardEvent("keydown", { key: "Escape" })
    document.dispatchEvent(event)

    expect(callback).not.toHaveBeenCalled()
  })
})
