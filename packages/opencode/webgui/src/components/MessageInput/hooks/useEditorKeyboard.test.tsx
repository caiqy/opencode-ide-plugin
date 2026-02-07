import { describe, it, expect, vi } from "vitest"
import { renderHook } from "@testing-library/react"
import type { LexicalEditor } from "lexical"
import { useEditorKeyboard } from "./useEditorKeyboard"

function setup() {
  const onSubmit = vi.fn()
  let enterHandler: ((event?: KeyboardEvent) => boolean) | undefined

  const editor = {
    registerCommand: vi.fn((_command, handler: (event?: KeyboardEvent) => boolean) => {
      enterHandler = handler
      return vi.fn()
    }),
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

  return { onSubmit, enterHandler }
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
})
