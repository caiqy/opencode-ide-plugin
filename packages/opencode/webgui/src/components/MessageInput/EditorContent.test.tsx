import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { EditorContent } from "./EditorContent"

vi.mock("@lexical/react/LexicalRichTextPlugin", () => {
  return {
    RichTextPlugin: ({ contentEditable }: { contentEditable: any }) => <div>{contentEditable}</div>,
  }
})

vi.mock("@lexical/react/LexicalContentEditable", () => {
  return {
    ContentEditable: ({ placeholder, ...props }: any) => <div {...props}>{placeholder}</div>,
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
})
