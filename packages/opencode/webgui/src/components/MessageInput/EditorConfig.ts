import { MentionNode } from "../mention/MentionNode"
import { AttachmentNode } from "../attachment/AttachmentNode"

const theme = {
  paragraph: "mb-0",
  text: {
    bold: "font-bold",
    italic: "italic",
    underline: "underline",
  },
}

export function createEditorConfig() {
  return {
    namespace: "MessageInput",
    theme,
    onError: (error: Error) => {
      console.error("[MessageInput] Lexical error:", error)
    },
    nodes: [MentionNode, AttachmentNode],
  }
}
