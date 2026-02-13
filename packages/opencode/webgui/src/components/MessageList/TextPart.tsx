import { useRef } from "react"
import type { Part } from "../../state/MessagesContext"
import { MarkdownRenderer } from "../MarkdownRenderer"
import { FilePart } from "../parts/FilePart"
import { AgentPart } from "../parts/AgentPart"

function renderTextWithMentions(text: string, mentions: Array<{ start: number; end: number; part: Part }>) {
  if (mentions.length === 0) {
    return text
  }

  // Sort mentions by start position
  const sortedMentions = [...mentions].sort((a, b) => a.start - b.start)
  const elements: React.ReactNode[] = []
  let lastIndex = 0
  let key = 0

  for (const mention of sortedMentions) {
    // Add text before mention
    if (mention.start > lastIndex) {
      const chunk = text.substring(lastIndex, mention.start)
      elements.push(
        <span
          key={`t-${key++}`}
          data-rawpart="1"
          data-raw={chunk}
          data-raw-start={lastIndex}
          data-raw-end={mention.start}
        >
          {chunk}
        </span>,
      )
    }

    const raw = text.substring(mention.start, mention.end)

    // Add mention component (wrapped so copy can map back to raw text)
    if (mention.part.type === "file") {
      elements.push(
        <span
          key={`m-${key++}`}
          data-rawpart="1"
          data-raw-mention="1"
          data-raw={raw}
          data-raw-start={mention.start}
          data-raw-end={mention.end}
        >
          <FilePart part={mention.part as any} />
        </span>,
      )
    } else if (mention.part.type === "agent") {
      elements.push(
        <span
          key={`m-${key++}`}
          data-rawpart="1"
          data-raw-mention="1"
          data-raw={raw}
          data-raw-start={mention.start}
          data-raw-end={mention.end}
        >
          <AgentPart part={mention.part as any} />
        </span>,
      )
    }

    lastIndex = mention.end
  }

  // Add remaining text
  if (lastIndex < text.length) {
    const chunk = text.substring(lastIndex)
    elements.push(
      <span key={`t-${key++}`} data-rawpart="1" data-raw={chunk} data-raw-start={lastIndex} data-raw-end={text.length}>
        {chunk}
      </span>,
    )
  }

  return <>{elements}</>
}

interface TextPartProps {
  part: Part
  isUser: boolean
  attachedParts?: Part[]
}

export function TextPart({ part, isUser, attachedParts }: TextPartProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  if (part.type !== "text") return null

  // Skip synthetic text parts (like tool call descriptions)
  const synthetic = (part as { synthetic?: boolean }).synthetic
  if (synthetic) return null

  const text = part.text || ""

  // Extract mentions from attached parts that have position info
  const mentions: Array<{ start: number; end: number; part: Part }> = []
  if (attachedParts) {
    for (const attachedPart of attachedParts) {
      const source = (attachedPart as any).source
      if (source?.text?.start >= 0 && source?.text?.end > source.text.start) {
        mentions.push({
          start: source.text.start,
          end: source.text.end,
          part: attachedPart,
        })
      }
    }
  }

  if (isUser) {
    const handleCopy = (e: React.ClipboardEvent<HTMLDivElement>) => {
      if (!e.clipboardData) return

      const selection = window.getSelection()
      const wrapper = ref.current
      if (!selection || !wrapper || selection.rangeCount === 0) return

      const range = selection.getRangeAt(0)
      if (!wrapper.contains(range.commonAncestorContainer)) return

      if (range.collapsed) {
        e.preventDefault()
        e.stopPropagation()
        e.clipboardData.setData("text/plain", text)
        return
      }

      e.preventDefault()
      e.stopPropagation()

      const parts = Array.from(wrapper.querySelectorAll<HTMLElement>("[data-rawpart]"))

      const containsNode = (needle: Node, element: HTMLElement): boolean => {
        return needle === element || element.contains(needle)
      }

      // Find start part and offset
      let startPartIndex = parts.findIndex((p) => containsNode(range.startContainer, p))
      if (startPartIndex === -1 && range.startContainer === wrapper) {
        startPartIndex = Math.min(range.startOffset, parts.length - 1)
      }

      // Find end part - use focusNode for accurate end detection (fixes Firefox)
      // In Firefox, when selection ends inside non-text elements (like SVG in mentions),
      // range.endContainer points to the SVG but focusNode points to actual selection end
      const focusNode = selection.focusNode
      const focusOffset = selection.focusOffset
      let endPartIndex = focusNode ? parts.findIndex((p) => containsNode(focusNode, p)) : -1

      // Fallback to range.endContainer if focusNode didn't match
      if (endPartIndex === -1) {
        endPartIndex = parts.findIndex((p) => containsNode(range.endContainer, p))
      }
      if (endPartIndex === -1 && range.endContainer === wrapper) {
        endPartIndex = Math.min(range.endOffset, parts.length) - 1
      }

      // Calculate start offset within first part
      let startOffset = 0
      if (startPartIndex >= 0 && !parts[startPartIndex].hasAttribute("data-raw-mention")) {
        const partEl = parts[startPartIndex]
        if (containsNode(range.startContainer, partEl)) {
          const tempRange = document.createRange()
          tempRange.selectNodeContents(partEl)
          tempRange.setEnd(range.startContainer, range.startOffset)
          startOffset = tempRange.toString().length
        }
      }

      // Calculate end offset within last part
      let endOffset = 0
      if (endPartIndex >= 0) {
        const partEl = parts[endPartIndex]
        if (partEl.hasAttribute("data-raw-mention")) {
          endOffset = partEl.textContent?.length || 0
        } else if (focusNode && containsNode(focusNode, partEl) && focusNode.nodeType === Node.TEXT_NODE) {
          const tempRange = document.createRange()
          tempRange.selectNodeContents(partEl)
          tempRange.setEnd(focusNode, focusOffset)
          endOffset = tempRange.toString().length
        } else if (containsNode(range.endContainer, partEl)) {
          const tempRange = document.createRange()
          tempRange.selectNodeContents(partEl)
          tempRange.setEnd(range.endContainer, range.endOffset)
          endOffset = tempRange.toString().length
        } else {
          endOffset = partEl.textContent?.length || 0
        }
      }

      // Map to raw text indices
      let rawStart = text.length
      let rawEnd = 0

      for (let i = startPartIndex; i <= endPartIndex && i >= 0 && i < parts.length; i++) {
        const partEl = parts[i]
        const partStart = Number(partEl.getAttribute("data-raw-start"))
        const partEnd = Number(partEl.getAttribute("data-raw-end"))
        if (Number.isNaN(partStart) || Number.isNaN(partEnd)) continue

        if (partEl.hasAttribute("data-raw-mention")) {
          rawStart = Math.min(rawStart, partStart)
          rawEnd = Math.max(rawEnd, partEnd)
          continue
        }

        let localStart = i === startPartIndex ? startOffset : 0
        let localEnd = i === endPartIndex ? endOffset : partEnd - partStart

        localStart = Math.max(0, Math.min(localStart, partEnd - partStart))
        localEnd = Math.max(0, Math.min(localEnd, partEnd - partStart))

        if (localEnd > localStart) {
          rawStart = Math.min(rawStart, partStart + localStart)
          rawEnd = Math.max(rawEnd, partStart + localEnd)
        }
      }

      if (rawEnd > rawStart) {
        e.clipboardData.setData("text/plain", text.slice(rawStart, rawEnd))
      }
    }

    return (
      <div key={part.id} className="w-full flex justify-end">
        <div className="inline-block min-w-0 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-blue-50 dark:bg-blue-900/20 border border-blue-400 dark:border-blue-600">
          <div ref={ref} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]" onCopy={handleCopy}>
            {mentions.length > 0 ? renderTextWithMentions(text, mentions) : text}
          </div>
        </div>
      </div>
    )
  }

  // Assistant text with markdown rendering
  return (
    <div key={part.id} className="text-sm">
      <MarkdownRenderer>{text}</MarkdownRenderer>
    </div>
  )
}
