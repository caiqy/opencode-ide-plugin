import { useCallback, useEffect, useRef, useState } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
} from "lexical"
import { createPortal } from "react-dom"
import { SlashPopover } from "../SlashPopover"
import type { SlashItem } from "../utils"
import { makeSlashInsert } from "../utils"
import { extractSlashQueryFromSelection, updateSlashPopoverPosition } from "./utils"

export function SlashPlugin() {
  const [editor] = useLexicalComposerContext()
  const [showPopover, setShowPopover] = useState(false)
  const [query, setQuery] = useState("")
  const [position, setPosition] = useState<{ top: number; left: number; placement: "top" | "bottom" }>({
    top: 0,
    left: 0,
    placement: "top",
  })
  const [slashStartOffset, setSlashStartOffset] = useState<number | null>(null)
  const leftRef = useRef<{ left: number; width: number } | null>(null)

  const resetState = useCallback(() => {
    setShowPopover(false)
    setQuery("")
    setSlashStartOffset(null)
    leftRef.current = null
  }, [])

  const handlePositionUpdate = useCallback(() => {
    updateSlashPopoverPosition(editor, leftRef, setPosition)
  }, [editor])

  const handleTextChange = useCallback(() => {
    const slashQuery = extractSlashQueryFromSelection(setSlashStartOffset)
    if (slashQuery === null) {
      resetState()
      return
    }
    setQuery(slashQuery)
    setShowPopover(true)
    handlePositionUpdate()
  }, [handlePositionUpdate, resetState])

  const insert = useCallback(
    (item: SlashItem) => {
      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        const node = selection.anchor.getNode()
        if (!$isTextNode(node)) return
        if (slashStartOffset === null) return

        const off = selection.anchor.offset
        const text = makeSlashInsert(item)
        node.spliceText(slashStartOffset, off - slashStartOffset, text)
        selection.setTextNodeRange(node, text.length, node, text.length)
      })
      resetState()
    },
    [editor, resetState, slashStartOffset],
  )

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        handleTextChange()
      })
    })
  }, [editor, handleTextChange])

  useEffect(() => {
    if (!showPopover) return
    const frame = requestAnimationFrame(() => {
      handlePositionUpdate()
    })
    return () => cancelAnimationFrame(frame)
  }, [handlePositionUpdate, query, showPopover])

  useEffect(() => {
    if (!showPopover) return
    const removeArrowDownCommand = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      () => {
        return true
      },
      COMMAND_PRIORITY_LOW,
    )
    const removeArrowUpCommand = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      () => {
        return true
      },
      COMMAND_PRIORITY_LOW,
    )
    const removeEnterCommand = editor.registerCommand(
      KEY_ENTER_COMMAND,
      () => {
        return true
      },
      COMMAND_PRIORITY_LOW,
    )
    const removeTabCommand = editor.registerCommand(
      KEY_TAB_COMMAND,
      () => {
        return true
      },
      COMMAND_PRIORITY_LOW,
    )
    const removeEscapeCommand = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        resetState()
        return true
      },
      COMMAND_PRIORITY_LOW,
    )

    return () => {
      removeArrowDownCommand()
      removeArrowUpCommand()
      removeEnterCommand()
      removeTabCommand()
      removeEscapeCommand()
    }
  }, [editor, resetState, showPopover])

  return showPopover
    ? createPortal(
        <SlashPopover
          query={query}
          position={position}
          onSelect={insert}
          onClose={resetState}
          onReposition={handlePositionUpdate}
        />,
        document.body,
      )
    : null
}
