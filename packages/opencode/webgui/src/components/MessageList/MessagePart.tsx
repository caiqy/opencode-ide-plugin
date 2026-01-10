import type { Part, WebguiPart } from "../../state/MessagesContext"
import { TextPart } from "./TextPart"
import { ReasoningPart } from "./ReasoningPart"
import { ToolPart } from "../parts/ToolPart"
import { PatchPart } from "../parts/PatchPart"
import { SnapshotPart } from "../parts/SnapshotPart"
import { RetryPart } from "../parts/RetryPart"
import { SessionErrorPart } from "./SessionErrorPart"

interface MessagePartProps {
  part: WebguiPart
  isUser: boolean
  allParts: WebguiPart[]
  durationMs?: number
  sessionID?: string
  messageID?: string
  skipPartIds?: Set<string>
}

export function MessagePart({
  part,
  isUser,
  allParts,
  durationMs,
  sessionID,
  messageID,
  skipPartIds,
}: MessagePartProps) {
  // Skip if this part was already rendered as an attachment
  if (skipPartIds?.has(part.id)) {
    return null
  }

  // Filter out step-start and step-finish parts (they're internal)
  if (part.type === "step-start" || part.type === "step-finish") {
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
    return <ReasoningPart key={part.id} part={part} durationMs={durationMs} />
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

  // Patches (file edits) - only show standalone ones (not associated with write/edit)
  if (part.type === "patch") {
    // Check if there's a write/edit tool before this patch
    const currentIndex = allParts.findIndex((p) => p.id === part.id)
    if (currentIndex > 0) {
      // Look backwards for a write/edit tool
      for (let i = currentIndex - 1; i >= 0; i--) {
        const prevPart = allParts[i]
        if (prevPart.type === "tool" && (prevPart.tool === "write" || prevPart.tool === "edit")) {
          // This patch is associated with a write/edit tool, skip it
          return null
        }
        // Stop if we hit another patch or non-tool part
        if (prevPart.type === "patch" || prevPart.type === "text" || prevPart.type === "reasoning") {
          break
        }
      }
    }

    // Standalone patch (e.g., from patch tool)
    return <PatchPart key={part.id} part={part as any} sessionID={sessionID || ""} messageID={messageID || ""} />
  }

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

  return null
}
