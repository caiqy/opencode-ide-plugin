import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { forwardRef } from "react"
import { EditorContent } from "./EditorContent"

vi.mock("@lexical/react/LexicalRichTextPlugin", () => {
  return {
    RichTextPlugin: ({ contentEditable }: { contentEditable: any }) => <div>{contentEditable}</div>,
  }
})

vi.mock("@lexical/react/LexicalContentEditable", () => {
  return {
    ContentEditable: forwardRef<HTMLDivElement, any>(({ placeholder, ...props }, ref) => (
      <div ref={ref} {...props}>
        {placeholder}
      </div>
    )),
  }
})

vi.mock("@lexical/react/LexicalOnChangePlugin", () => {
  return { OnChangePlugin: () => null }
})

vi.mock("@lexical/react/LexicalHistoryPlugin", () => {
  return { HistoryPlugin: () => null }
})

vi.mock("@lexical/react/LexicalErrorBoundary", () => {
  return { LexicalErrorBoundary: () => null }
})

vi.mock("../mention/MentionPlugin", () => {
  return { MentionPlugin: () => null }
})

vi.mock("../attachment/AttachmentPlugin", () => {
  return { AttachmentPlugin: () => null }
})

vi.mock("../attachment/AttachmentRail", () => {
  return { AttachmentRail: () => null }
})

vi.mock("../command/CommandPlugin", () => {
  return { CommandPlugin: () => null }
})

describe("EditorContent", () => {
  it("输入框 placeholder 与 aria-placeholder 为中文", () => {
    render(
      <EditorContent
        contentEditableRef={{ current: null } as any}
        containerRef={{ current: null } as any}
        onEditorChange={vi.fn()}
      />,
    )

    const placeholder = "输入消息（回车发送）"
    const placeholderNode = screen.getByText(placeholder)
    expect(placeholderNode).toBeInTheDocument()

    const contentEditable = placeholderNode.parentElement
    expect(contentEditable).toHaveAttribute("aria-placeholder", placeholder)
  })

  it("输入框提供稳定的表单标识与可访问名称", () => {
    const { container } = render(
      <EditorContent
        contentEditableRef={{ current: null } as any}
        containerRef={{ current: null } as any}
        onEditorChange={vi.fn()}
      />,
    )

    const input = container.querySelector("#opencode-message-input")
    expect(input).toHaveAttribute("id", "opencode-message-input")
    expect(input).toHaveAttribute("aria-label", "输入消息（回车发送）")
  })

  it("向下拖动分隔线会缩小输入框", () => {
    const { container } = render(
      <EditorContent
        contentEditableRef={{ current: null } as any}
        containerRef={{ current: null } as any}
        onEditorChange={vi.fn()}
      />,
    )

    const input = container.querySelector("#opencode-message-input") as HTMLDivElement
    Object.defineProperty(input, "getBoundingClientRect", { value: () => ({ height: 128 }) })
    const handle = screen.getByRole("separator", { name: "调整输入框高度" })

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 140 })

    expect(input).toHaveStyle({ height: "88px" })
  })

  it("双击分隔线会恢复输入框默认高度", () => {
    const { container } = render(
      <EditorContent
        contentEditableRef={{ current: null } as any}
        containerRef={{ current: null } as any}
        onEditorChange={vi.fn()}
      />,
    )

    const input = container.querySelector("#opencode-message-input") as HTMLDivElement
    Object.defineProperty(input, "getBoundingClientRect", { value: () => ({ height: 64 }) })
    const handle = screen.getByRole("separator", { name: "调整输入框高度" })

    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientY: 100 })
    fireEvent.pointerMove(handle, { pointerId: 1, clientY: 140 })
    fireEvent.doubleClick(handle)

    expect(input).not.toHaveStyle({ height: "104px" })
  })

  it("分隔线可通过键盘调整输入框高度", () => {
    const { container } = render(
      <EditorContent
        contentEditableRef={{ current: null } as any}
        containerRef={{ current: null } as any}
        onEditorChange={vi.fn()}
      />,
    )

    const input = container.querySelector("#opencode-message-input") as HTMLDivElement
    Object.defineProperty(input, "getBoundingClientRect", { value: () => ({ height: 64 }) })
    const handle = screen.getByRole("separator", { name: "调整输入框高度" })

    fireEvent.keyDown(handle, { key: "ArrowDown" })

    expect(input).toHaveStyle({ height: "88px" })
  })
})
