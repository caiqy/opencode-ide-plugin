import { useRef, useState, useCallback } from "react"
import { getImageFilename } from "../../lib/fileUtils"
import type { Part } from "../../state/MessagesContext"
import { MarkdownRenderer } from "../MarkdownRenderer"
import { FilePart } from "../parts/FilePart"
import { AgentPart } from "../parts/AgentPart"
import { ImageOverlay } from "../parts/ImageOverlay"
import { getUserTextCopySelection } from "./messageCopy"

interface ImageFile {
  id: string
  mime: string
  url: string
  filename?: string
}

const isImageDataUrl = (p: Part): p is Part & ImageFile => {
  if (p.type !== "file") return false
  const url = (p as any).url
  if (typeof url !== "string" || !url.startsWith("data:")) return false
  // Use part.mime if present, otherwise extract from data URL
  let mime = (p as any).mime
  if (!mime || typeof mime !== "string") {
    const match = url.match(/^data:([^;,]+)/)
    mime = match ? match[1] : ""
  }
  return mime.startsWith("image/")
}

function Thumbnail({ file }: { file: ImageFile }) {
  const [preview, setPreview] = useState(false)
  const toggle = useCallback(() => setPreview((v) => !v), [])
  const alt = file.filename || "image"

  return (
    <>
      <div
        className="mt-1.5 cursor-pointer rounded-md overflow-hidden inline-block border border-white/20 dark:border-white/10 hover:border-white/40 dark:hover:border-white/30 transition-colors shadow-sm"
        onClick={toggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault()
            toggle()
          }
        }}
      >
        <img src={file.url} alt={alt} className="max-w-48 max-h-36 object-contain" />
      </div>
      {preview && (
        <ImageOverlay url={file.url} alt={alt} filename={getImageFilename(file.filename, file.mime)} onClose={toggle} />
      )}
    </>
  )
}

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

  // Collect image attachments for thumbnail display
  const images = (attachedParts || []).filter(isImageDataUrl) as unknown as ImageFile[]

  if (isUser) {
    const handleCopy = (e: React.ClipboardEvent<HTMLDivElement>) => {
      if (!e.clipboardData) return

      const selection = window.getSelection()
      const wrapper = ref.current
      if (!selection || !wrapper || selection.rangeCount === 0) return

      const value = getUserTextCopySelection({ text, wrapper, selection })
      if (!value) return

      e.preventDefault()
      e.stopPropagation()
      e.clipboardData.setData("text/plain", value)
    }

    return (
      <div key={part.id} className="w-full flex justify-end">
        <div className="inline-block min-w-0 max-w-full rounded-lg border border-gray-300 bg-gray-100 px-3.5 py-2.5 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800/70 dark:text-gray-100">
          <div ref={ref} className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]" onCopy={handleCopy}>
            {mentions.length > 0 ? renderTextWithMentions(text, mentions) : text}
          </div>
          {images.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-1">
              {images.map((img) => (
                <Thumbnail key={img.id} file={img} />
              ))}
            </div>
          )}
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
