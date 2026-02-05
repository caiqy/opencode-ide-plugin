import { $getRoot, $getSelection, $isRangeSelection, $isTextNode } from "lexical"
import { extractSlashQuery } from "../utils"

export function extractSlashQueryFromSelection(setStart: (offset: number | null) => void): string | null {
  const selection = $getSelection()
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null
  const node = selection.anchor.getNode()
  if (!$isTextNode(node)) return null

  // 强约束：slash 只允许在输入框整体开头触发。
  // 仅检查当前 TextNode 的开头不够：Lexical 可能因为 node split 或插入 inline node
  // 产生新的 TextNode（例如 mention node 后的文本节点）。
  const parent = node.getParent()
  const root = $getRoot()
  if (!parent) return null
  if (root.getFirstChild() !== parent) return null
  if (parent.getFirstChild() !== node) return null
  if (node.getPreviousSibling() !== null) return null

  const text = node.getTextContent()
  const offset = selection.anchor.offset
  const beforeCursor = text.slice(0, offset)
  const query = extractSlashQuery(beforeCursor)
  if (query === null) return null
  setStart(0)
  return query
}

export function updateSlashPopoverPosition(
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
  const popover = root.ownerDocument.querySelector<HTMLElement>("[data-slash-popover]")
  const popoverRect = popover ? popover.getBoundingClientRect() : null
  const rawHeight = popoverRect && popoverRect.height > 0 ? Math.ceil(popoverRect.height) : 280
  const desiredHeight = Math.min(rawHeight, viewportHeight - gap * 2)
  const below = viewportHeight - rect.bottom - gap
  const above = rect.top - gap
  const placement =
    above >= desiredHeight ? "top" : below >= desiredHeight ? "bottom" : above >= below ? "top" : "bottom"

  const viewportWidth = window.innerWidth
  const rawWidth = popoverRect && popoverRect.width > 0 ? Math.ceil(popoverRect.width) : 520
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
  setPosition({ top, left, placement })
}
