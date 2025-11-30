import { describe, it, expect, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { useKeyboard, useKeyboardShortcut } from "./useKeyboard"

describe("useKeyboard", () => {
  it("calls handler when key is pressed", () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboard({
        handlers: [
          {
            key: "Enter",
            handler,
          },
        ],
      }),
    )

    const event = new KeyboardEvent("keydown", { key: "Enter" })
    document.dispatchEvent(event)

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("calls handler with modifier keys", () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboard({
        handlers: [
          {
            key: "s",
            modKey: true,
            handler,
          },
        ],
      }),
    )

    const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true })
    document.dispatchEvent(event)

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("does not call handler without correct modifier", () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboard({
        handlers: [
          {
            key: "s",
            modKey: true,
            handler,
          },
        ],
      }),
    )

    const event = new KeyboardEvent("keydown", { key: "s" })
    document.dispatchEvent(event)

    expect(handler).not.toHaveBeenCalled()
  })

  it("handles meta key (Cmd on Mac)", () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboard({
        handlers: [
          {
            key: "k",
            modKey: true,
            handler,
          },
        ],
      }),
    )

    const event = new KeyboardEvent("keydown", { key: "k", metaKey: true })
    document.dispatchEvent(event)

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("handles shift key", () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboard({
        handlers: [
          {
            key: "A",
            shiftKey: true,
            handler,
          },
        ],
      }),
    )

    const event = new KeyboardEvent("keydown", { key: "A", shiftKey: true })
    document.dispatchEvent(event)

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("handles alt key", () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboard({
        handlers: [
          {
            key: "f",
            altKey: true,
            handler,
          },
        ],
      }),
    )

    const event = new KeyboardEvent("keydown", { key: "f", altKey: true })
    document.dispatchEvent(event)

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("handles multiple shortcuts", () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()
    renderHook(() =>
      useKeyboard({
        handlers: [
          { key: "a", handler: handler1 },
          { key: "b", handler: handler2 },
        ],
      }),
    )

    const eventA = new KeyboardEvent("keydown", { key: "a" })
    document.dispatchEvent(eventA)
    expect(handler1).toHaveBeenCalledTimes(1)
    expect(handler2).not.toHaveBeenCalled()

    const eventB = new KeyboardEvent("keydown", { key: "b" })
    document.dispatchEvent(eventB)
    expect(handler2).toHaveBeenCalledTimes(1)
  })

  it("prevents default when preventDefault is not false", () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboard({
        handlers: [
          {
            key: "s",
            modKey: true,
            handler,
          },
        ],
      }),
    )

    const event = new KeyboardEvent("keydown", { key: "s", ctrlKey: true })
    const preventDefaultSpy = vi.spyOn(event, "preventDefault")
    document.dispatchEvent(event)

    expect(preventDefaultSpy).toHaveBeenCalled()
  })

  it("prevents action in input fields by default", () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboard({
        handlers: [
          {
            key: "a",
            handler,
          },
        ],
      }),
    )

    const input = document.createElement("input")
    document.body.appendChild(input)

    const event = new KeyboardEvent("keydown", { key: "a", bubbles: true })
    Object.defineProperty(event, "target", { value: input, enumerable: true })
    input.dispatchEvent(event)

    expect(handler).not.toHaveBeenCalled()

    document.body.removeChild(input)
  })

  it("allows action in input fields when preventInInputs is false", () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboard({
        handlers: [
          {
            key: "a",
            handler,
          },
        ],
        preventInInputs: false,
      }),
    )

    const input = document.createElement("input")
    document.body.appendChild(input)

    const event = new KeyboardEvent("keydown", { key: "a", bubbles: true })
    Object.defineProperty(event, "target", { value: input, enumerable: true })
    input.dispatchEvent(event)

    expect(handler).toHaveBeenCalledTimes(1)

    document.body.removeChild(input)
  })

  it("listens to keyup event when specified", () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboard({
        handlers: [
          {
            key: "a",
            handler,
          },
        ],
        eventType: "keyup",
      }),
    )

    const keydownEvent = new KeyboardEvent("keydown", { key: "a" })
    document.dispatchEvent(keydownEvent)
    expect(handler).not.toHaveBeenCalled()

    const keyupEvent = new KeyboardEvent("keyup", { key: "a" })
    document.dispatchEvent(keyupEvent)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("cleans up event listener on unmount", () => {
    const handler = vi.fn()
    const { unmount } = renderHook(() =>
      useKeyboard({
        handlers: [
          {
            key: "a",
            handler,
          },
        ],
      }),
    )

    unmount()

    const event = new KeyboardEvent("keydown", { key: "a" })
    document.dispatchEvent(event)

    expect(handler).not.toHaveBeenCalled()
  })
})

describe("useKeyboardShortcut", () => {
  it("calls handler when shortcut is pressed", () => {
    const handler = vi.fn()
    renderHook(() => useKeyboardShortcut("k", handler, { modKey: true }))

    const event = new KeyboardEvent("keydown", { key: "k", ctrlKey: true })
    document.dispatchEvent(event)

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("works with default options", () => {
    const handler = vi.fn()
    renderHook(() => useKeyboardShortcut("Escape", handler))

    const event = new KeyboardEvent("keydown", { key: "Escape" })
    document.dispatchEvent(event)

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it("supports all modifier keys", () => {
    const handler = vi.fn()
    renderHook(() =>
      useKeyboardShortcut("s", handler, {
        modKey: true,
        shiftKey: true,
        altKey: true,
      }),
    )

    const event = new KeyboardEvent("keydown", {
      key: "s",
      ctrlKey: true,
      shiftKey: true,
      altKey: true,
    })
    document.dispatchEvent(event)

    expect(handler).toHaveBeenCalledTimes(1)
  })
})
