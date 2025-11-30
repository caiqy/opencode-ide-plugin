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

  for (const mention of sortedMentions) {
    // Add text before mention
    if (mention.start > lastIndex) {
      elements.push(text.substring(lastIndex, mention.start))
    }

    // Add mention component
    if (mention.part.type === "file") {
      elements.push(<FilePart key={mention.part.id} part={mention.part as any} />)
    } else if (mention.part.type === "agent") {
      elements.push(<AgentPart key={mention.part.id} part={mention.part as any} />)
    }

    lastIndex = mention.end
  }

  // Add remaining text
  if (lastIndex < text.length) {
    elements.push(text.substring(lastIndex))
  }

  return <>{elements}</>
}

interface TextPartProps {
  part: Part
  isUser: boolean
  attachedParts?: Part[]
}

export function TextPart({ part, isUser, attachedParts }: TextPartProps) {
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
      e.preventDefault()
      e.stopPropagation()
      e.clipboardData.setData("text/plain", text)
    }
    return (
      <div
        key={part.id}
        className="inline-block modern-card px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-gray-50 dark:bg-gray-800/50 border-transparent dark:border-gray-800"
      >
        <div className="whitespace-pre-wrap" onCopy={handleCopy}>
          {mentions.length > 0 ? renderTextWithMentions(text, mentions) : text}
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
