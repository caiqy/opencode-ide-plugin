import { describe, it, expect, vi } from "vitest"
import { createEditor, $createParagraphNode, $createTextNode, $getRoot, ParagraphNode, TextNode } from "lexical"
import { extractCommandQuery } from "./utils"
import { $createAttachmentNode, AttachmentNode } from "../../attachment/AttachmentNode"

function createTestEditor() {
  return createEditor({
    namespace: "test",
    nodes: [ParagraphNode, TextNode, AttachmentNode],
    onError: (error) => {
      throw error
    },
  })
}

function runExtractCommandQuery(
  editor: ReturnType<typeof createEditor>,
  text: string,
  cursorOffset: number,
): string | null {
  let result: string | null = null
  const setCommandStartOffset = vi.fn()

  editor.update(
    () => {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      const textNode = $createTextNode(text)
      paragraph.append(textNode)
      root.append(paragraph)
      textNode.select(cursorOffset, cursorOffset)

      result = extractCommandQuery(setCommandStartOffset)
    },
    { discrete: true },
  )

  return result
}

describe("extractCommandQuery", () => {
  it("returns null when query contains a trailing space (regression guard)", () => {
    const editor = createTestEditor()
    const result = runExtractCommandQuery(editor, "/help ", 6)
    expect(result).toBeNull()
  })

  it("returns query string when no whitespace in query", () => {
    const editor = createTestEditor()
    const result = runExtractCommandQuery(editor, "/hel", 4)
    expect(result).toBe("hel")
  })

  it("returns empty string for just the trigger char /", () => {
    const editor = createTestEditor()
    const result = runExtractCommandQuery(editor, "/", 1)
    expect(result).toBe("")
  })

  it("returns empty query when an attachment precedes the trigger", () => {
    const editor = createTestEditor()
    let result: string | null = null

    editor.update(
      () => {
        const paragraph = $createParagraphNode()
        const textNode = $createTextNode("/")
        paragraph.append(
          $createAttachmentNode({
            id: "image-1",
            display: "Image #1",
            filename: "image.png",
            mime: "image/png",
            url: "data:image/png;base64,AA==",
            size: 1,
          }),
          textNode,
        )
        $getRoot().append(paragraph)
        textNode.select(1, 1)
        result = extractCommandQuery(vi.fn())
      },
      { discrete: true },
    )

    expect(result).toBe("")
  })

  it("returns null when there is non-whitespace before the slash", () => {
    const editor = createTestEditor()
    const result = runExtractCommandQuery(editor, "hello /cmd", 10)
    expect(result).toBeNull()
  })
})
