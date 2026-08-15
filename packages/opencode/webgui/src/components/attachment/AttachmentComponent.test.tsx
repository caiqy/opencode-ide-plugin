import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

const mockEditor = vi.hoisted(() => ({
  update: vi.fn((fn) => fn()),
  getEditorState: vi.fn(() => ({ _nodeMap: new Map() })),
}))

const attachmentNode = vi.hoisted(() => ({
  remove: vi.fn(),
}))

const imagePreview = vi.hoisted(() => vi.fn())

vi.mock("@lexical/react/LexicalComposerContext", () => ({
  useLexicalComposerContext: () => [mockEditor],
}))

vi.mock("lexical", async (importOriginal) => {
  const lexical = await importOriginal<typeof import("lexical")>()
  return { ...lexical, $getNodeByKey: () => attachmentNode }
})

vi.mock("../parts/ImagePreview", () => ({
  ImagePreview: (props: { alt: string; src: string; filename?: string }) => {
    imagePreview(props)
    return <button data-testid="image-preview">{props.alt}</button>
  },
}))

import { AttachmentComponent } from "./AttachmentComponent"

describe("AttachmentComponent", () => {
  it("普通附件删除按钮具备无障碍名称、稳定点击区并删除 Lexical 节点", () => {
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
    expect(removeButton).toHaveAttribute("aria-label", "移除附件")
    expect(removeButton).toHaveClass("h-[18px]", "w-[18px]")

    fireEvent.click(removeButton)
    expect(attachmentNode.remove).toHaveBeenCalledTimes(1)
  })

  it("图片附件显示可预览缩略图", () => {
    render(
      <AttachmentComponent
        nodeKey={"node-1" as any}
        metadata={{
          id: "image-1",
          display: "Image #1",
          filename: "image.png",
          mime: "image/png",
          size: 1024,
          url: "data:image/png;base64,AA==",
        }}
      />,
    )

    expect(screen.getByTestId("image-preview")).toHaveTextContent("image.png")
    expect(screen.getByRole("button", { name: "移除附件" })).toBeInTheDocument()
    expect(imagePreview).toHaveBeenLastCalledWith(
      expect.objectContaining({
        src: "data:image/png;base64,AA==",
        alt: "image.png",
        filename: "image.png",
      }),
    )
  })
})
