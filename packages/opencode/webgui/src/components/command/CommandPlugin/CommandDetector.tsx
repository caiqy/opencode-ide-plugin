import { useCallback, useRef } from "react"
import type { LexicalEditor } from "lexical"
import { extractCommandQuery, updatePopoverPosition } from "./utils"

export function useCommandDetector(
  editor: LexicalEditor,
  setQuery: (query: string) => void,
  setShowPopover: (show: boolean) => void,
  setCommandStartOffset: (offset: number | null) => void,
  setPosition: (pos: { top: number; left: number; placement: "top" | "bottom" }) => void,
) {
  const leftRef = useRef<{ left: number; width: number } | null>(null)

  const handlePositionUpdate = useCallback(() => {
    updatePopoverPosition(editor, leftRef, setPosition)
  }, [editor, setPosition])

  const handleTextChange = useCallback(() => {
    editor.getEditorState().read(() => {
      const commandQuery = extractCommandQuery(setCommandStartOffset)

      if (commandQuery === null) {
        leftRef.current = null
        setShowPopover(false)
        setQuery("")
        setCommandStartOffset(null)
        return
      }

      setQuery(commandQuery)
      setShowPopover(true)
      handlePositionUpdate()
    })
  }, [editor, setQuery, setShowPopover, setCommandStartOffset, handlePositionUpdate])

  const resetState = useCallback(() => {
    setShowPopover(false)
    setQuery("")
    setCommandStartOffset(null)
    leftRef.current = null
  }, [setShowPopover, setQuery, setCommandStartOffset])

  return {
    handleTextChange,
    handlePositionUpdate,
    resetState,
  }
}
