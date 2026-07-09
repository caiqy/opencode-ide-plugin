import type { Message } from "../../state/MessagesContext"
import { getUserMessagePlainText } from "./utils"

export function getMessageCopyText(message: Message) {
  if (message.info.role === "user") return getUserMessagePlainText(message)

  const text = message.parts
    .flatMap((part) => {
      if (part.type !== "text") return []
      const synthetic = (part as { synthetic?: boolean }).synthetic
      if (synthetic) return []
      const value = (part as { text?: string }).text
      return typeof value === "string" && value.length > 0 ? [value] : []
    })
    .join("")

  return text.length > 0 ? text : null
}

export function getUserTextCopySelection(input: { text: string; wrapper: HTMLElement; selection: Selection }) {
  const { text, wrapper, selection } = input
  if (selection.rangeCount === 0) return null

  const range = selection.getRangeAt(0)
  if (!wrapper.contains(range.commonAncestorContainer)) return null
  if (range.collapsed) return text.length > 0 ? text : null

  const fallback = selection.toString()
  const parts = Array.from(wrapper.querySelectorAll<HTMLElement>("[data-rawpart]"))
  if (parts.length === 0) return fallback.length > 0 ? fallback : null

  const contains = (node: Node, element: HTMLElement) => node === element || element.contains(node)
  let start = parts.findIndex((part) => contains(range.startContainer, part))
  let end = parts.findIndex((part) => contains(range.endContainer, part))

  // Browser selections that span inline wrappers can report the message wrapper
  // itself as the range boundary; translate those child offsets back to raw parts.
  if (start === -1 && range.startContainer === wrapper) start = Math.min(range.startOffset, parts.length - 1)
  if (end === -1 && range.endContainer === wrapper) end = Math.min(range.endOffset, parts.length) - 1
  if (start < 0 || end < start) return fallback.length > 0 ? fallback : null

  let rawStart = text.length
  let rawEnd = 0

  parts.slice(start, end + 1).forEach((part, index) => {
    const partStart = Number(part.getAttribute("data-raw-start"))
    const partEnd = Number(part.getAttribute("data-raw-end"))
    if (Number.isNaN(partStart) || Number.isNaN(partEnd)) return

    // Mentions render as rich labels, but copying should preserve the exact text
    // the user sent so pasted prompts can be replayed without losing references.
    if (part.hasAttribute("data-raw-mention")) {
      rawStart = Math.min(rawStart, partStart)
      rawEnd = Math.max(rawEnd, partEnd)
      return
    }

    const first = index === 0
    const last = index === end - start
    const localStart =
      first && contains(range.startContainer, part) ? offsetWithin(part, range.startContainer, range.startOffset) : 0
    const localEnd =
      last && contains(range.endContainer, part)
        ? offsetWithin(part, range.endContainer, range.endOffset)
        : partEnd - partStart
    const boundedStart = Math.max(0, Math.min(localStart, partEnd - partStart))
    const boundedEnd = Math.max(0, Math.min(localEnd, partEnd - partStart))

    if (boundedEnd > boundedStart) {
      rawStart = Math.min(rawStart, partStart + boundedStart)
      rawEnd = Math.max(rawEnd, partStart + boundedEnd)
    }
  })

  if (rawEnd > rawStart) return text.slice(rawStart, rawEnd)
  return fallback.length > 0 ? fallback : null
}

function offsetWithin(element: HTMLElement, container: Node, offset: number) {
  const range = document.createRange()
  range.selectNodeContents(element)
  range.setEnd(container, offset)
  return range.toString().length
}
