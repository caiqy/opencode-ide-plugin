import { $getSelection, $isRangeSelection, $isTextNode } from "lexical"

export const TRIGGER_CHAR = "@"

export function extractMentionQuery(setMentionStartOffset: (offset: number | null) => void): string | null {
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
}

export function updatePopoverPosition(
  editor: { getRootElement: () => HTMLElement | null },
  leftRef: React.MutableRefObject<{ left: number; width: number } | null>,
  setPosition: (pos: { top: number; left: number; placement: "top" | "bottom" }) => void,
) {
  const root = editor.getRootElement()
  if (!root) return

  const selection = root.ownerDocument.getSelection()
  if (!selection) return

  if (selection.rangeCount === 0) return

  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer)) return

  const rect = range.getBoundingClientRect()
  const gap = 8

  const viewportHeight = window.innerHeight
  const popover = root.ownerDocument.querySelector<HTMLElement>("[data-mention-popover]")
  const popoverRect = popover ? popover.getBoundingClientRect() : null
  const rawHeight = popoverRect && popoverRect.height > 0 ? Math.ceil(popoverRect.height) : 280
  const desiredHeight = Math.min(rawHeight, viewportHeight - gap * 2)
  const below = viewportHeight - rect.bottom - gap
  const above = rect.top - gap
  const placement =
    above >= desiredHeight ? "top" : below >= desiredHeight ? "bottom" : above >= below ? "top" : "bottom"

  const viewportWidth = window.innerWidth
  const rawWidth = popoverRect && popoverRect.width > 0 ? Math.ceil(popoverRect.width) : 500
  const desiredWidth = Math.min(rawWidth, viewportWidth - gap * 2)
  const minLeft = window.scrollX + gap
  const maxLeft = window.scrollX + viewportWidth - desiredWidth - gap

  const clamp = (value: number) => {
    if (maxLeft <= minLeft) return minLeft
    if (value < minLeft) return minLeft
    if (value > maxLeft) return maxLeft
    return value
  }

  const anchor = rect.left + window.scrollX
  const stored = leftRef.current
  const shouldReanchor = stored === null || Math.abs(stored.width - desiredWidth) > 8
  const openedLeft = (() => {
    const viewportRight = window.scrollX + viewportWidth - gap
    const start = anchor
    const end = anchor - desiredWidth

    if (start + desiredWidth <= viewportRight) return start
    if (end >= minLeft) return end
    return clamp(start)
  })()

  const preferred = shouldReanchor ? openedLeft : stored.left
  const left = clamp(preferred)

  leftRef.current = { left, width: desiredWidth }

  const top = placement === "top" ? rect.top + window.scrollY - gap : rect.bottom + window.scrollY + gap

  setPosition({
    top,
    left,
    placement,
  })
}
