import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $getSelection, $isRangeSelection, PASTE_COMMAND, COMMAND_PRIORITY_HIGH } from "lexical"
import { $createAttachmentNode, type AttachmentMetadata } from "./AttachmentNode"

export function AttachmentPlugin() {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        const clipboardData = event.clipboardData
        if (!clipboardData) return false

        // Check for image files in clipboard
        const items = Array.from(clipboardData.items)
        for (const item of items) {
          if (item.type.startsWith("image/")) {
            event.preventDefault()
            // Clipboard item metadata may be cleared before FileReader finishes.
            const mime = item.type

            const file = item.getAsFile()
            if (!file) continue

            // Read the file and create attachment
            const reader = new FileReader()
            reader.onload = () => {
              const dataUrl = reader.result as string
              const attachmentCount = countAttachments(editor)

              const metadata: AttachmentMetadata = {
                id: crypto.randomUUID(),
                display: `Image #${attachmentCount + 1}`,
                filename: `image-${attachmentCount + 1}.${getExtensionFromMime(mime)}`,
                mime,
                url: dataUrl,
                size: file.size,
              }

              editor.update(() => {
                const selection = $getSelection()
                if ($isRangeSelection(selection)) {
                  const attachmentNode = $createAttachmentNode(metadata)
                  selection.insertNodes([attachmentNode])
                }
              })
            }
            reader.readAsDataURL(file)

            return true
          }
        }

        return false
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor])

  return null
}

function countAttachments(editor: ReturnType<typeof useLexicalComposerContext>[0]): number {
  let count = 0
  editor.getEditorState().read(() => {
    const nodeMap = editor.getEditorState()._nodeMap
    for (const [, node] of nodeMap) {
      if (node.__type === "attachment") {
        count++
      }
    }
  })
  return count
}

function getExtensionFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
  }
  return map[mime] || "png"
}
