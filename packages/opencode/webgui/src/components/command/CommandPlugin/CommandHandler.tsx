import { useCallback } from "react"
import type { LexicalEditor } from "lexical"
import { $getSelection, $isRangeSelection, $isTextNode, TextNode } from "lexical"

export interface CommandMetadata {
  name: string
  description?: string
  source?: "command" | "mcp" | "skill"
}

export function useCommandHandler(
  editor: LexicalEditor,
  commandStartOffset: number | null,
  resetState: () => void,
) {

  const insertCommand = useCallback(
    (metadata: CommandMetadata) => {
      const res = { inserted: false }

      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          return
        }

        const anchor = selection.anchor
        const node = anchor.getNode()
        if (!$isTextNode(node)) {
          return
        }

        const offset = anchor.offset

        const textContent = node.getTextContent()
        const beforeCursor = textContent.slice(0, offset)
        const start = commandStartOffset ?? beforeCursor.lastIndexOf("/")
        if (start === -1) {
          return
        }

        const before = textContent.slice(0, start)
        const after = textContent.slice(offset)

        const commandText = `/${metadata.name}`
        const newText = before + commandText + after
        const textNode = node as TextNode
        textNode.setTextContent(newText)

        const newOffset = start + commandText.length
        textNode.select(newOffset, newOffset)
        res.inserted = true

        resetState()
      })

      if (res.inserted) return
    },
    [editor, commandStartOffset, resetState],
  )

  return { insertCommand }
}
