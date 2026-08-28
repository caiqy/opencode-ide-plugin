import { $getRoot, $getSelection, $isElementNode, $isRangeSelection, $isTextNode, type TextNode } from "lexical"
import { $isAttachmentNode } from "../../attachment/AttachmentNode"

export const TRIGGER_CHAR = "/"
const WHITESPACE_REGEX = /\s/
const ZERO_WIDTH_REGEX = /\u200B|\u200C|\u200D|\u2060|\uFEFF/g

export function extractCommandQuery(setCommandStartOffset: (offset: number | null) => void): string | null {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return null
  }

  const anchor = selection.anchor
  const node = anchor.getNode()
  if (!$isTextNode(node)) {
    return null
  }

  const offset = anchor.offset

  const beforeCursor = node.getTextContent().slice(0, offset)
  const lastSlashIndex = beforeCursor.lastIndexOf(TRIGGER_CHAR)

  if (lastSlashIndex === -1) {
    return null
  }

  const hasLeadingContent = hasNonWhitespaceBeforeOffset(node, lastSlashIndex)
  if (hasLeadingContent) {
    return null
  }

  const query = beforeCursor.slice(lastSlashIndex + 1)
  if (WHITESPACE_REGEX.test(query)) {
    return null
  }

  setCommandStartOffset(lastSlashIndex)

  return query
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
  const popover = root.ownerDocument.querySelector<HTMLElement>("[data-command-popover]")
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

  const anchorLeft = rect.left + window.scrollX
  const stored = leftRef.current
  const shouldReanchor = stored === null || Math.abs(stored.width - desiredWidth) > 8
  const openedLeft = (() => {
    const viewportRight = window.scrollX + viewportWidth - gap
    const start = anchorLeft
    const end = anchorLeft - desiredWidth

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

function hasNonWhitespaceBeforeOffset(node: TextNode, offset: number): boolean {
  const root = $getRoot()
  const paragraphs = root.getChildren()

  for (const paragraph of paragraphs) {
    if (!$isElementNode(paragraph)) continue

    const children = paragraph.getChildren()
    const inParagraph = children.includes(node)

    for (const child of children) {
      if (child === node) {
        const text = node.getTextContent().slice(0, offset)
        return text.replace(ZERO_WIDTH_REGEX, "").trim().length > 0
      }

      if ($isAttachmentNode(child)) continue
      const raw = child.getTextContent ? child.getTextContent() : ""
      const normalized = raw.replace(ZERO_WIDTH_REGEX, "")
      if (normalized.trim().length > 0) return true
    }

    if (inParagraph) {
      return false
    }
  }

  return false
}
