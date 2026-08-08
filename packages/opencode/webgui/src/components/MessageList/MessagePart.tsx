import type { Part, WebguiPart, QuestionRequestPart as QuestionRequestPartType } from "../../state/MessagesContext"
import { TextPart } from "./TextPart"
import { ReasoningPart } from "./ReasoningPart"
import { ToolPart } from "../parts/ToolPart"
import { SnapshotPart } from "../parts/SnapshotPart"
import { RetryPart } from "../parts/RetryPart"
import { SessionErrorPart } from "./SessionErrorPart"
import { QuestionPart } from "./Parts/QuestionPart"

interface MessagePartProps {
  part: WebguiPart
  isUser: boolean
  allParts: WebguiPart[]
  durationMs?: number
  sessionID?: string
  messageID?: string
  skipPartIds?: Set<string>
  sessionInterrupted?: boolean
}

export function MessagePart({
  part,
  isUser,
  allParts,
  durationMs,
  sessionID,
  messageID,
  skipPartIds,
  sessionInterrupted,
}: MessagePartProps) {
  // Skip if this part was already rendered as an attachment
  if (skipPartIds?.has(part.id)) {
    return null
  }

  // Filter out step-start and step-finish parts (they're internal)
  if (part.type === "step-start" || part.type === "step-finish") {
    return null
  }

  // Patch parts are internal server messages and should not be rendered
  if (part.type === "patch") {
    return null
  }

  // Text parts (user and assistant messages)
  if (part.type === "text") {
    // Collect following file/agent parts to group together (they have position info)
    const currentIndex = allParts.findIndex((p) => p.id === part.id)
    const attachedParts: Part[] = []

    if (currentIndex !== -1) {
      // Look ahead for file/agent parts that should be grouped with this text
      for (let i = currentIndex + 1; i < allParts.length; i++) {
        const nextPart = allParts[i]
        if (nextPart.type === "file" || nextPart.type === "agent") {
          attachedParts.push(nextPart)
          skipPartIds?.add(nextPart.id)
        } else if (nextPart.type === "text") {
          // Stop at next NON-SYNTHETIC text part
          const isSynthetic = (nextPart as { synthetic?: boolean }).synthetic
          if (!isSynthetic) {
            break
          }
          // Skip synthetic text parts but continue looking for file/agent parts
        } else {
          // Stop at any other part type (tool, reasoning, etc.)
          break
        }
      }
    }

    return <TextPart part={part} isUser={isUser} attachedParts={attachedParts} />
  }

  // Reasoning parts (thinking blocks)
  if (part.type === "reasoning") {
    return <ReasoningPart key={part.id} part={part} durationMs={durationMs} interrupted={sessionInterrupted} />
  }

  // Tool invocations
  if (part.type === "tool") {
    // Find the next patch part after this tool (if it's a write/edit tool)
    let associatedPatch: { id: string; type: "patch"; hash: string; files: string[] } | undefined
    if (part.tool === "write" || part.tool === "edit") {
      const currentIndex = allParts.findIndex((p) => p.id === part.id)
      if (currentIndex !== -1) {
        // Look for the next patch part
        for (let i = currentIndex + 1; i < allParts.length; i++) {
          const nextPart = allParts[i]
          if (nextPart.type === "patch") {
            associatedPatch = {
              id: nextPart.id,
              type: nextPart.type,
              hash: nextPart.hash,
              files: nextPart.files,
            }
            break
          }
          // Stop looking if we hit another tool
          if (nextPart.type === "tool") {
            break
          }
        }
      }
    }

    return (
      <ToolPart
        key={part.id}
        part={part as any}
        sessionID={sessionID}
        messageID={messageID}
        associatedPatch={associatedPatch}
        interrupted={sessionInterrupted}
      />
    )
  }

  // File references (should be grouped with text, not standalone)
  if (part.type === "file") {
    // Files are now rendered inline within text parts
    return null
  }

  // Agent references (should be grouped with text, not standalone)
  if (part.type === "agent") {
    // Agents are now rendered inline within text parts
    return null
  }

  // Patches are suppressed above

  // Snapshots (file state snapshots)
  if (part.type === "snapshot") {
    return <SnapshotPart key={part.id} part={part as any} />
  }

  // Retry attempts
  if (part.type === "retry") {
    return <RetryPart key={part.id} part={part as any} />
  }

  // Session errors
  if (part.type === "session-error") {
    return <SessionErrorPart key={part.id} part={part} />
  }

  // Question requests
  if (part.type === "question") {
    const questionPart = part as QuestionRequestPartType
    return <QuestionPart key={part.id} request={questionPart.request} />
  }

  return null
}
