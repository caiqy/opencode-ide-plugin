import { describe, expect, it } from "vitest"
import { $getRoot, $isElementNode, createEditor } from "lexical"
import { AttachmentNode } from "../attachment/AttachmentNode"
import { MentionNode } from "../mention/MentionNode"
import { restoreDraftImpl } from "./utils"

describe("restoreDraftImpl", () => {
  it("restores attachment and agent nodes from a structured draft", async () => {
    const editor = createEditor({
      nodes: [AttachmentNode, MentionNode],
      onError(error) {
        throw error
      },
    })
    restoreDraftImpl(editor, {
      parts: [
        { type: "text", text: "draft [Image #1] @explore" },
        {
          type: "file",
          mime: "image/png",
          filename: "image.png",
          url: "data:image/png;base64,AA==",
          source: { type: "file", path: "image.png", text: { value: "[Image #1]", start: 6, end: 16 } },
        },
        { type: "agent", name: "explore", source: { value: "@explore", start: 17, end: 25 } },
      ],
      agent: "review",
      model: { providerID: "openai", modelID: "gpt-5", variant: "high" },
    })
    await Promise.resolve()

    editor.getEditorState().read(() => {
      const paragraph = $getRoot().getFirstChildOrThrow()
      expect($isElementNode(paragraph)).toBe(true)
      expect(paragraph.getTextContent()).toBe("draft [Image #1] @explore")
      expect(paragraph.getChildren().map((node) => node.getType())).toContain("attachment")
      expect(paragraph.getChildren().map((node) => node.getType())).toContain("mention")
    })
  })

  it("keeps source-less agents and resource files in draft-part order", async () => {
    const editor = createEditor({
      nodes: [AttachmentNode, MentionNode],
      onError(error) {
        throw error
      },
    })
    restoreDraftImpl(editor, {
      parts: [
        { type: "text", text: "first@exploresecond" },
        { type: "agent", name: "explore" },
        {
          type: "file",
          mime: "text/plain",
          filename: "resource.txt",
          url: "resource://server/item",
          source: {
            type: "resource",
            clientName: "server",
            uri: "resource://server/item",
            text: { value: "[resource.txt]", start: 0, end: 14 },
          },
        },
      ],
      agent: "build",
      model: undefined,
    })
    await Promise.resolve()

    editor.getEditorState().read(() => {
      const paragraph = $getRoot().getFirstChildOrThrow()
      expect(paragraph.getChildren().map((node) => node.getType())).toEqual(["text", "mention", "text", "attachment"])
    })
  })
})
