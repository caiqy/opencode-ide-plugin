import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { KeyboardHandler } from "./keyboardHandler"

type HistoryAction = "undo" | "redo"

describe("KeyboardHandler", () => {
  let originalParent: Window
  let postMessageSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    originalParent = window.parent
    postMessageSpy = vi.fn()
    Object.defineProperty(window, "parent", {
      value: {
        postMessage: postMessageSpy,
      },
      configurable: true,
    })
    document.body.innerHTML = ""
  })

  afterEach(() => {
    document.body.innerHTML = ""
    Object.defineProperty(window, "parent", {
      value: originalParent,
      configurable: true,
    })
  })

  function createEditable() {
    const editable = document.createElement("textarea")
    document.body.appendChild(editable)
    editable.focus()
    return editable
  }

  function expectHistoryShortcutHandled(
    code: "KeyZ" | "KeyY",
    expectedAction: HistoryAction,
    options?: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
  ) {
    const editable = createEditable()
    const historySpy = vi.fn((event: Event) => {
      event.preventDefault()
    })
    editable.addEventListener("opencode:history", historySpy as EventListener, true)

    const handler = new KeyboardHandler()
    const event = new KeyboardEvent("keydown", {
      key: code === "KeyY" ? "y" : "z",
      code,
      ctrlKey: options?.ctrlKey ?? true,
      metaKey: options?.metaKey ?? false,
      shiftKey: !!options?.shiftKey,
      bubbles: true,
      cancelable: true,
    })

    editable.dispatchEvent(event)

    expect(historySpy).toHaveBeenCalledTimes(1)
    const [historyEvent] = historySpy.mock.calls[0]
    expect((historyEvent as CustomEvent<{ action: HistoryAction }>).detail.action).toBe(expectedAction)
    expect(event.defaultPrevented).toBe(true)
    expect(postMessageSpy).not.toHaveBeenCalled()

    handler.destroy()
  }

  it("在可编辑区域按 Ctrl+Z 应派发 undo 历史事件而非转发给父级", () => {
    expectHistoryShortcutHandled("KeyZ", "undo")
  })

  it("在可编辑区域按 Ctrl+Y 应派发 redo 历史事件而非转发给父级", () => {
    expectHistoryShortcutHandled("KeyY", "redo")
  })

  it("在可编辑区域按 Cmd+Shift+Z 应派发 redo 历史事件而非转发给父级", () => {
    expectHistoryShortcutHandled("KeyZ", "redo", {
      shiftKey: true,
      ctrlKey: false,
      metaKey: true,
    })
  })
})
