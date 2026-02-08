import { describe, it, expect, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import { REDO_COMMAND, UNDO_COMMAND, type LexicalEditor } from "lexical"
import { useEditorKeyboard } from "./useEditorKeyboard"

function setup() {
  const onSubmit = vi.fn()
  const dispatchCommand = vi.fn()
  let enterHandler: ((event?: KeyboardEvent) => boolean) | undefined

  const editor = {
    registerCommand: vi.fn((_command, handler: (event?: KeyboardEvent) => boolean) => {
      enterHandler = handler
      return vi.fn()
    }),
    dispatchCommand,
  } as unknown as LexicalEditor

  const contentEditableRef = { current: document.createElement("div") } as React.RefObject<HTMLDivElement | null>

  renderHook(() =>
    useEditorKeyboard({
      editor,
      contentEditableRef,
      parseWithRange: (value) => ({ display: value, path: value }),
      onSubmit,
    }),
  )

  if (!enterHandler) {
    throw new Error("Enter handler not registered")
  }

  return { onSubmit, enterHandler, dispatchCommand, contentEditableRef }
}

describe("useEditorKeyboard", () => {
  it("Enter 应发送消息", () => {
    const { onSubmit, enterHandler } = setup()
    const event = new KeyboardEvent("keydown", { key: "Enter" })
    const preventDefaultSpy = vi.spyOn(event, "preventDefault")

    const handled = enterHandler(event)

    expect(handled).toBe(true)
    expect(preventDefaultSpy).toHaveBeenCalledTimes(1)
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it("Ctrl/Cmd+Enter 应保留为换行（不发送）", () => {
    const { onSubmit, enterHandler } = setup()
    const event = new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true })
    const preventDefaultSpy = vi.spyOn(event, "preventDefault")

    const handled = enterHandler(event)

    expect(handled).toBe(false)
    expect(preventDefaultSpy).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("Shift+Enter 应保留为换行（不发送）", () => {
    const { onSubmit, enterHandler } = setup()
    const event = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true })
    const preventDefaultSpy = vi.spyOn(event, "preventDefault")

    const handled = enterHandler(event)

    expect(handled).toBe(false)
    expect(preventDefaultSpy).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("提及/命令弹层打开时，Enter 不应发送消息", () => {
    const { onSubmit, enterHandler } = setup()
    const popover = document.createElement("div")
    popover.setAttribute("data-mention-popover", "")
    document.body.appendChild(popover)

    const event = new KeyboardEvent("keydown", { key: "Enter" })
    const handled = enterHandler(event)

    expect(handled).toBe(false)
    expect(onSubmit).not.toHaveBeenCalled()

    document.body.removeChild(popover)
  })

  it("收到 opencode:history undo 事件时应触发 Lexical UNDO_COMMAND", () => {
    const { contentEditableRef, dispatchCommand } = setup()
    const historyEvent = new CustomEvent("opencode:history", {
      detail: { action: "undo" },
      bubbles: true,
      cancelable: true,
    })

    contentEditableRef.current?.dispatchEvent(historyEvent)

    expect(historyEvent.defaultPrevented).toBe(true)
    expect(dispatchCommand).toHaveBeenCalledWith(UNDO_COMMAND, undefined)
  })

  it("收到 opencode:history redo 事件时应触发 Lexical REDO_COMMAND", () => {
    const { contentEditableRef, dispatchCommand } = setup()
    const historyEvent = new CustomEvent("opencode:history", {
      detail: { action: "redo" },
      bubbles: true,
      cancelable: true,
    })

    contentEditableRef.current?.dispatchEvent(historyEvent)

    expect(historyEvent.defaultPrevented).toBe(true)
    expect(dispatchCommand).toHaveBeenCalledWith(REDO_COMMAND, undefined)
  })
})
