import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

const mockEditor = vi.hoisted(() => ({
  update: vi.fn(),
  getElementByKey: vi.fn(),
  getEditorState: vi.fn(() => ({ _nodeMap: new Map() })),
}))

vi.mock("@lexical/react/LexicalComposerContext", () => ({
  useLexicalComposerContext: () => [mockEditor],
}))

import { AttachmentComponent } from "./AttachmentComponent"

describe("AttachmentComponent", () => {
  it("移除按钮提示文案为中文", () => {
    render(
      <AttachmentComponent
        nodeKey={"node-1" as any}
        metadata={{
          id: "a1",
          display: "文档.pdf",
          filename: "file.pdf",
          mime: "application/pdf",
          size: 1024,
          url: "data:application/pdf;base64,AA==",
        }}
      />,
    )

    const removeButton = screen.getByTitle("移除附件")
    expect(removeButton).toHaveAttribute("data-tip", "移除附件")
  })
})
