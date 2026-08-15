import { describe, expect, it, vi } from "vitest"
import { act, render, screen, within } from "@testing-library/react"

let attachments: Array<{
  getKey: () => string
  getMetadata: () => { id: string; display: string }
}> = []
let onUpdate: ((value: { editorState: { read: (callback: () => void) => void } }) => void) | undefined

const editor = vi.hoisted(() => ({
  getEditorState: () => ({ read: (callback: () => void) => callback() }),
  registerUpdateListener: (callback: typeof onUpdate) => {
    onUpdate = callback
    return () => {}
  },
}))

vi.mock("@lexical/react/LexicalComposerContext", () => ({
  useLexicalComposerContext: () => [editor],
}))

vi.mock("lexical", () => ({
  $getRoot: () => ({
    getChildren: () => attachments,
  }),
  $isElementNode: () => false,
}))

vi.mock("./AttachmentNode", () => ({
  $isAttachmentNode: (node: { getMetadata?: unknown }) => typeof node.getMetadata === "function",
}))

vi.mock("./AttachmentComponent", () => ({
  AttachmentComponent: ({ metadata }: { metadata: { id: string; display: string } }) => (
    <div data-testid={`attachment-${metadata.id}`}>{metadata.display}</div>
  ),
}))

import { AttachmentRail } from "./AttachmentRail"

describe("AttachmentRail", () => {
  it("仅在有附件时显示同一条横向附件轨道", () => {
    attachments = [
      {
        getKey: () => "attachment-1",
        getMetadata: () => ({ id: "image-1", display: "Image #1" }),
      },
      {
        getKey: () => "attachment-2",
        getMetadata: () => ({ id: "image-2", display: "Image #2" }),
      },
    ]

    const { rerender } = render(<AttachmentRail />)

    const rail = screen.getByTestId("attachment-rail-items")
    expect(rail).toHaveClass("overflow-x-auto")
    expect(rail).toHaveClass("p-1")
    expect(within(rail).getByTestId("attachment-image-1")).toHaveTextContent("Image #1")
    expect(within(rail).getByTestId("attachment-image-2")).toHaveTextContent("Image #2")

    attachments = []
    act(() => {
      onUpdate?.({ editorState: { read: (callback) => callback() } })
    })
    rerender(<AttachmentRail />)

    expect(screen.queryByTestId("attachment-rail")).not.toBeInTheDocument()
  })
})
