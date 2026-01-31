import { useCallback, useRef } from "react"
import type { LexicalEditor } from "lexical"
import { extractMentionQuery, updatePopoverPosition } from "./utils"

export function useMentionDetector(
  editor: LexicalEditor,
  setQuery: (query: string) => void,
  setShowPopover: (show: boolean) => void,
  setMentionStartOffset: (offset: number | null) => void,
  setPosition: (pos: { top: number; left: number; placement: "top" | "bottom" }) => void,
) {
  const leftRef = useRef<{ left: number; width: number } | null>(null)

  const handlePositionUpdate = useCallback(() => {
    updatePopoverPosition(editor, leftRef, setPosition)
  }, [editor, setPosition])

  const handleTextChange = useCallback(() => {
    editor.getEditorState().read(() => {
      const mentionQuery = extractMentionQuery(setMentionStartOffset)

      if (mentionQuery === null) {
        leftRef.current = null
        setShowPopover(false)
        setQuery("")
        setMentionStartOffset(null)
        return
      }

      setQuery(mentionQuery)
      setShowPopover(true)
      handlePositionUpdate()
    })
  }, [editor, setQuery, setShowPopover, setMentionStartOffset, handlePositionUpdate])

  const resetState = useCallback(() => {
    setShowPopover(false)
    setQuery("")
    setMentionStartOffset(null)
    leftRef.current = null
  }, [setShowPopover, setQuery, setMentionStartOffset])

  return {
    handleTextChange,
    handlePositionUpdate,
    resetState,
  }
}
