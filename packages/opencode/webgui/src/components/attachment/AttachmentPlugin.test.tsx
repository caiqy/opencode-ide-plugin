import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, render } from "@testing-library/react"

type PasteHandler = (event: ClipboardEvent) => boolean
type Reader = {
  result: string
  onload: (() => void) | null
}

const state = vi.hoisted(() => ({
  handler: undefined as PasteHandler | undefined,
  createAttachmentNode: vi.fn(),
  insertNodes: vi.fn(),
  readers: [] as Reader[],
}))

const editor = vi.hoisted(() => ({
  getEditorState: () => ({
    read: (callback: () => void) => callback(),
    _nodeMap: new Map(),
  }),
  registerCommand: vi.fn((_command: unknown, handler: PasteHandler) => {
    state.handler = handler
    return () => {}
  }),
  update: vi.fn((callback: () => void) => callback()),
}))

vi.mock("@lexical/react/LexicalComposerContext", () => ({
  useLexicalComposerContext: () => [editor],
}))

vi.mock("lexical", () => ({
  $getSelection: () => ({ insertNodes: state.insertNodes }),
  $isRangeSelection: () => true,
  COMMAND_PRIORITY_HIGH: 1,
  PASTE_COMMAND: "paste",
}))

vi.mock("./AttachmentNode", () => ({
  $createAttachmentNode: (metadata: unknown) => state.createAttachmentNode(metadata),
}))

import { AttachmentPlugin } from "./AttachmentPlugin"

describe("AttachmentPlugin", () => {
  beforeEach(() => {
    state.handler = undefined
    state.createAttachmentNode.mockReset()
    state.insertNodes.mockReset()
    state.readers.length = 0

    vi.stubGlobal(
      "FileReader",
      class {
        result = "data:image/png;base64,AA=="
        onload: (() => void) | null = null

        readAsDataURL() {
          state.readers.push(this)
        }
      },
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("在异步读取完成前保存剪贴板图片 MIME 类型", () => {
    render(<AttachmentPlugin />)

    let mime = "image/png"
    const item = {
      get type() {
        return mime
      },
      getAsFile: () => new File(["image"], "image-1.png", { type: "image/png" }),
    }
    const preventDefault = vi.fn()

    expect(
      state.handler?.({ clipboardData: { items: [item] }, preventDefault } as unknown as ClipboardEvent),
    ).toBe(true)

    mime = ""
    act(() => state.readers[0]?.onload?.())

    expect(state.createAttachmentNode).toHaveBeenCalledWith(expect.objectContaining({ mime: "image/png" }))
  })
})
