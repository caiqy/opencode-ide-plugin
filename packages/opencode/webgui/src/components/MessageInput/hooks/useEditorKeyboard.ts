import { useEffect } from "react"
import {
  KEY_ENTER_COMMAND,
  COMMAND_PRIORITY_HIGH,
  REDO_COMMAND,
  UNDO_COMMAND,
  $getSelection,
  $isRangeSelection,
  $createTextNode,
  type LexicalEditor,
} from "lexical"

interface UseEditorKeyboardOptions {
  editor: LexicalEditor
  contentEditableRef: React.RefObject<HTMLDivElement | null>
  onSubmit: () => void
}

export function useEditorKeyboard({ editor, contentEditableRef, onSubmit }: UseEditorKeyboardOptions) {
  // Register Enter-to-send command
  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (!event || event.key !== "Enter") return false
        if (event.metaKey || event.ctrlKey || event.shiftKey) return false
        if (document.querySelector("[data-mention-popover], [data-command-popover]")) return false

        event.preventDefault()
        onSubmit()
        return true
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor, onSubmit])

  // Handle paste as plain text
  useEffect(() => {
    const el = contentEditableRef.current
    if (!el) return

    const onHistory = (e: Event) => {
      const ev = e as CustomEvent<{ action?: "undo" | "redo" }>
      const action = ev.detail?.action
      if (action !== "undo" && action !== "redo") return
      e.preventDefault()
      e.stopPropagation()
      editor.dispatchCommand(action === "undo" ? UNDO_COMMAND : REDO_COMMAND, undefined)
    }

    const insertPlain = (text: string) => {
      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        selection.insertNodes([$createTextNode(text)])
      })
    }

    const onPasteText = (e: Event) => {
      const ev = e as CustomEvent<{ text?: string }>
      const text = ev.detail?.text
      if (!text) return
      e.preventDefault()
      e.stopPropagation()
      insertPlain(text)
    }

    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return
      const plain = e.clipboardData.getData("text/plain")
      if (!plain) return
      e.preventDefault()
      e.stopPropagation()
      insertPlain(plain)
    }

    el.addEventListener("opencode:history", onHistory as any, true)
    el.addEventListener("opencode:paste-text", onPasteText as any, true)
    el.addEventListener("paste", onPaste as any, true)
    return () => {
      el.removeEventListener("opencode:history", onHistory as any, true)
      el.removeEventListener("opencode:paste-text", onPasteText as any, true)
      el.removeEventListener("paste", onPaste as any, true)
    }
  }, [contentEditableRef.current, editor])
}
