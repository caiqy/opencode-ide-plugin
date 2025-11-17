import { useEffect, useState, useCallback, useRef } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  TextNode,
} from "lexical"
import { $createMentionNode, type MentionMetadata } from "./MentionNode"
import { MentionPopover } from "./MentionPopover"
import { createPortal } from "react-dom"
import { useIdeBridgeState } from "../../state/IdeBridgeContext"

const TRIGGER_CHAR = "@"

export function MentionPlugin() {
  const [editor] = useLexicalComposerContext()
  const [showPopover, setShowPopover] = useState(false)
  const [query, setQuery] = useState("")
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [mentionStartOffset, setMentionStartOffset] = useState<number | null>(null)
  const leftRef = useRef<number | null>(null)
  const { openedFiles } = useIdeBridgeState()

  const updatePopoverPosition = useCallback(() => {
    const root = editor.getRootElement()
    if (!root) return

    const selection = root.ownerDocument.getSelection()
    if (!selection) return

    if (selection.rangeCount === 0) return

    const range = selection.getRangeAt(0)
    if (!root.contains(range.startContainer)) return

    const rect = range.getBoundingClientRect()
    const rootRect = root.getBoundingClientRect()
    const gap = 8

    const viewportWidth = window.innerWidth
    const estimatedWidth = 500
    const minLeft = window.scrollX + gap
    const maxLeft = window.scrollX + viewportWidth - estimatedWidth - gap

    let left = leftRef.current
    if (left === null) {
      left = rect.left + window.scrollX
    }
    if (maxLeft <= minLeft) {
      left = minLeft
    }
    if (left < minLeft) {
      left = minLeft
    }
    if (left > maxLeft) {
      left = maxLeft
    }

    leftRef.current = left

    setPosition({
      top: rootRect.top + window.scrollY - gap,
      left,
    })
  }, [editor])

  const extractMentionQuery = useCallback((): string | null => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
      return null
    }

    const anchor = selection.anchor
    const node = anchor.getNode()
    if (!$isTextNode(node)) {
      return null
    }

    const textContent = node.getTextContent()
    const offset = anchor.offset

    // Find the last '@' before cursor
    const beforeCursor = textContent.slice(0, offset)
    const lastAtIndex = beforeCursor.lastIndexOf(TRIGGER_CHAR)

    if (lastAtIndex === -1) {
      return null
    }

    // Check if there's whitespace between @ and cursor
    const textBetween = beforeCursor.slice(lastAtIndex + 1)
    if (/\s/.test(textBetween)) {
      return null
    }

    // Store the start offset for later deletion
    setMentionStartOffset(lastAtIndex)

    return textBetween
  }, [])

  const handleTextChange = useCallback(() => {
    editor.getEditorState().read(() => {
      const mentionQuery = extractMentionQuery()

      if (mentionQuery === null) {
        leftRef.current = null
        setShowPopover(false)
        setQuery("")
        setMentionStartOffset(null)
        return
      }

      setQuery(mentionQuery)
      setShowPopover(true)
      updatePopoverPosition()
    })
  }, [editor, extractMentionQuery, updatePopoverPosition])

  const insertMention = useCallback(
    (metadata: MentionMetadata) => {
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

        // Find and delete the mention text (from @ to cursor)
        if (mentionStartOffset !== null) {
          const textContent = node.getTextContent()
          const before = textContent.slice(0, mentionStartOffset)
          const after = textContent.slice(offset)

          // Replace text node content
          const newText = before + after
          const textNode = node as TextNode
          textNode.setTextContent(newText)

          if (metadata.display === "All opened files") {
            const nodes: Array<TextNode | ReturnType<typeof $createMentionNode>> = []
            for (const p of openedFiles) {
              if (!p) continue
              const md: MentionMetadata = { type: p.endsWith("/") ? "directory" : "file", display: p, path: p }
              nodes.push($createMentionNode(md))
              nodes.push(new TextNode(" "))
            }
            if (nodes.length > 0) {
              if (mentionStartOffset > 0) {
                const [beforeNode] = textNode.splitText(mentionStartOffset)
                for (const n of nodes) beforeNode.insertAfter(n)
              } else {
                // insert in reverse order before to keep original order after insertion
                for (let i = nodes.length - 1; i >= 0; i--) textNode.insertBefore(nodes[i])
              }
              // place cursor after the last inserted node
              const last = nodes[nodes.length - 1]
              if (last instanceof TextNode) last.select()
            }
          } else {
            // Create and insert single mention node
            const mentionNode = $createMentionNode(metadata)
            if (mentionStartOffset > 0) {
              const [beforeNode] = textNode.splitText(mentionStartOffset)
              beforeNode.insertAfter(mentionNode)
            } else {
              textNode.insertBefore(mentionNode)
            }
            const spaceNode = new TextNode(" ")
            mentionNode.insertAfter(spaceNode)
            spaceNode.select()
          }
        }

        setShowPopover(false)
        setQuery("")
        setMentionStartOffset(null)
        leftRef.current = null
      })
    },
    [editor, mentionStartOffset],
  )

  const closePopover = useCallback(() => {
    setShowPopover(false)
    setQuery("")
    setMentionStartOffset(null)
    leftRef.current = null
  }, [])

  // Listen for text changes
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
      updatePopoverPosition()
    })

    return () => cancelAnimationFrame(frame)
  }, [showPopover, query, updatePopoverPosition])

  // Prevent default keyboard commands when popover is open
  useEffect(() => {
    if (!showPopover) return

    const removeArrowDownCommand = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      () => {
        return true // Prevent default
      },
      COMMAND_PRIORITY_LOW,
    )

    const removeArrowUpCommand = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      () => {
        return true // Prevent default
      },
      COMMAND_PRIORITY_LOW,
    )

    const removeEnterCommand = editor.registerCommand(
      KEY_ENTER_COMMAND,
      () => {
        return true // Prevent default
      },
      COMMAND_PRIORITY_LOW,
    )

    const removeTabCommand = editor.registerCommand(
      KEY_TAB_COMMAND,
      () => {
        return true // Prevent default
      },
      COMMAND_PRIORITY_LOW,
    )

    const removeEscapeCommand = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        closePopover()
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
  }, [editor, showPopover, closePopover])

  return showPopover
    ? createPortal(
        <MentionPopover query={query} position={position} onSelect={insertMention} onClose={closePopover} />,
        document.body,
      )
    : null
}
