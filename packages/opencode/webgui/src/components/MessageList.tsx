import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import { useMessages, type Message, type Part } from "../state/MessagesContext"
import { useSession } from "../state/SessionContext"
import { MarkdownRenderer } from "./MarkdownRenderer"
import { TypingIndicator } from "./TypingIndicator"
import { ToolPart } from "./parts/ToolPart"
import { FilePart } from "./parts/FilePart"
import { PatchPart } from "./parts/PatchPart"
import { SnapshotPart } from "./parts/SnapshotPart"
import { AgentPart } from "./parts/AgentPart"
import { RetryPart } from "./parts/RetryPart"
import { ConfirmModal } from "./ConfirmModal"

// Compact rendering for different part types

// Helper to render text with inline mentions
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

function renderTextPart(part: Part, isUser: boolean, attachedParts?: Part[]) {
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

// Reusable collapsible component for reasoning parts
interface CollapsiblePartProps {
  trigger: React.ReactNode
  triggerClassName?: string
  content: React.ReactNode
  contentClassName?: string
  defaultExpanded?: boolean
}

function CollapsiblePart({
  trigger,
  triggerClassName,
  content,
  contentClassName,
  defaultExpanded = false,
}: CollapsiblePartProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const baseClass = "relative inline-flex items-center gap-1 pr-4"
  const buttonClass = triggerClassName ? `${baseClass} ${triggerClassName}` : baseClass

  return (
    <div className="my-1">
      <button onClick={() => setIsExpanded(!isExpanded)} className={buttonClass}>
        {trigger}
        <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 flex h-3 w-3 items-center justify-center text-gray-400">
          <svg
            viewBox="0 0 24 24"
            className={`w-3 h-3 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 5l7 7-7 7" />
          </svg>
        </span>
      </button>
      {isExpanded && <div className={contentClassName}>{content}</div>}
    </div>
  )
}

function getPartStart(part: Part): number | undefined {
  const time = (part as { time?: { start?: number } }).time
  return typeof time?.start === "number" ? time.start : undefined
}

function getPartEnd(part: Part): number | undefined {
  const time = (part as { time?: { end?: number } }).time
  return typeof time?.end === "number" ? time.end : undefined
}

function ReasoningPartComponent({ part, durationMs }: { part: Part & { type: "reasoning" }; durationMs?: number }) {
  const label = durationMs !== undefined ? `Thought for ${Math.max(1, Math.floor(durationMs / 1000))}s` : "Thinking..."

  return (
    <CollapsiblePart
      trigger={<span className="leading-none">{label}</span>}
      triggerClassName="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
      content={part.text || ""}
      contentClassName="mt-1 text-xs text-gray-600 dark:text-gray-400 pl-3 border-l-2 border-purple-300 dark:border-purple-700"
    />
  )
}

function renderPart(
  part: Part,
  isUser: boolean,
  allParts: Part[],
  durationMs?: number,
  sessionID?: string,
  messageID?: string,
  skipPartIds?: Set<string>,
) {
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

    return renderTextPart(part, isUser, attachedParts)
  }

  // Reasoning parts (thinking blocks)
  if (part.type === "reasoning") {
    return <ReasoningPartComponent key={part.id} part={part} durationMs={durationMs} />
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

  return null
}

function getUserMessagePlainText(message: Message): string | null {
  if (message.info.role !== "user") return null
  const chunks: string[] = []
  for (const part of message.parts) {
    if (part.type !== "text") continue
    const synthetic = (part as { synthetic?: boolean }).synthetic
    if (synthetic) continue
    const text = (part as { text?: string }).text
    if (typeof text === "string" && text.length > 0) {
      chunks.push(text)
    }
  }
  const joined = chunks.join("\n")
  const trimmed = joined.trim()
  return trimmed.length > 0 ? trimmed : null
}

interface MessageRowProps {
  message: Message
  onFork: (messageId: string) => void
  onRevert: (messageId: string) => void
  revertBusy: boolean
  sessionID?: string
}

function MessageRow({ message, onFork, onRevert, revertBusy, sessionID }: MessageRowProps) {
  const [isHovered, setIsHovered] = useState(false)
  const isUser = message.info.role === "user"
  const skipPartIds = new Set<string>()

  // Calculate durations for reasoning parts using timestamps when available
  const partsWithDurations = message.parts.map((part) => {
    let durationMs: number | undefined

    if (part.type === "reasoning") {
      const start = getPartStart(part)
      const end = getPartEnd(part)

      if (typeof start === "number") {
        if (typeof end === "number" && end >= start) {
          durationMs = end - start
        }
      }
    }

    return { part, durationMs }
  })

  return (
    <div
      key={message.info.id}
      className={`group ${isUser ? "flex justify-end" : ""} relative`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Fork / Undo buttons (visible on hover) */}
      {isUser && isHovered && (
        <div className="absolute left-1/2 -translate-x-1/2 top-0 flex gap-2">
          <button
            onClick={() => onFork(message.info.id)}
            className="modern-icon-button"
            title="Fork session at this message"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 4v4a4 4 0 004 4h2a4 4 0 014 4v4M7 4h4M7 4H3M17 20h4M17 20l-3-3"
              />
            </svg>
          </button>
          <button
            onClick={() => onRevert(message.info.id)}
            className="modern-icon-button hover:text-red-600 dark:hover:text-red-400"
            title="Undo from this message (revert)"
            disabled={revertBusy}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H5v4m0-4l4 4m2-4h3a5 5 0 010 10H9"
              />
            </svg>
          </button>
        </div>
      )}

      {/* Render all parts */}
      <div className="space-y-1">
        {partsWithDurations.map(({ part, durationMs }) =>
          renderPart(part, isUser, message.parts, durationMs, sessionID, message.info.id, skipPartIds),
        )}

        {/* Show placeholder if no parts yet (streaming start) */}
        {message.parts.length === 0 && !isUser && (
          <div className="relative inline-flex items-center gap-1 pr-4 text-xs text-gray-500 dark:text-gray-400">
            <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 flex h-3 w-3 items-center justify-center text-gray-400 opacity-0">
              <svg
                viewBox="0 0 24 24"
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M9 5l7 7-7 7" />
              </svg>
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

interface MessageListProps {
  sessionID?: string | null
  onUndoToInput?: (value: string) => void
}

export function MessageList({ sessionID, onUndoToInput }: MessageListProps) {
  const { getMessagesBySession, messages } = useMessages()
  const { isIdle, isReasoning, currentSession, forkSession, revertToMessage, unrevertSession, redoNext } = useSession()
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const isUserAtBottomRef = useRef(true)
  const hasInitializedRef = useRef(false)

  const [forkConfirm, setForkConfirm] = useState<string | null>(null)
  const [isForking, setIsForking] = useState(false)
  const [revertAction, setRevertAction] = useState<{ type: "undo" | "redo" | "restore"; messageId?: string } | null>(
    null,
  )
  const [isRevertBusy, setIsRevertBusy] = useState(false)

  // Debug logging for isIdle state
  useEffect(() => {
    console.log("[MessageList] isIdle state changed:", isIdle)
  }, [isIdle])

  const handleForkStart = useCallback((messageId: string) => {
    setForkConfirm(messageId)
  }, [])

  const handleForkConfirm = useCallback(async () => {
    if (!forkConfirm || !currentSession) return

    setIsForking(true)
    const forkedSession = await forkSession(currentSession.id, forkConfirm)
    setIsForking(false)

    if (forkedSession) {
      setForkConfirm(null)
    }
  }, [forkConfirm, currentSession, forkSession])

  const handleRevert = useCallback(
    (messageId: string) => {
      if (!currentSession?.id) return
      if (isRevertBusy) return
      setRevertAction({ type: "undo", messageId })
    },
    [currentSession, isRevertBusy],
  )

  const handleRevertConfirm = useCallback(async () => {
    if (!currentSession?.id) return
    if (!revertAction) return
    setIsRevertBusy(true)
    if (revertAction.type === "undo" && revertAction.messageId) {
      if (onUndoToInput) {
        const sid = sessionID ?? currentSession.id
        if (sid) {
          const msgs = getMessagesBySession(sid)
          const msg = msgs.find((m) => m.info.id === revertAction.messageId)
          if (msg) {
            const plain = getUserMessagePlainText(msg)
            if (plain) onUndoToInput(plain)
          }
        }
      }
      await revertToMessage(currentSession.id, revertAction.messageId)
    }
    if (revertAction.type === "redo") {
      await redoNext(currentSession.id)
    }
    if (revertAction.type === "restore") {
      await unrevertSession(currentSession.id)
    }
    setIsRevertBusy(false)
    setRevertAction(null)
  }, [
    currentSession,
    revertAction,
    sessionID,
    getMessagesBySession,
    onUndoToInput,
    revertToMessage,
    redoNext,
    unrevertSession,
  ])

  const handleRevertCancel = useCallback(() => {
    if (isRevertBusy) return
    setRevertAction(null)
  }, [isRevertBusy])

  // Get messages for current session
  const sessionMessages = sessionID ? getMessagesBySession(sessionID) : []

  // Debug logging
  useEffect(() => {
    console.log("[MessageList] Debug info:", {
      sessionID,
      totalMessages: messages.length,
      sessionMessages: sessionMessages.length,
      messageSessionIDs: messages.map((m) => ({ id: m.info.id, sessionID: m.info.sessionID })),
    })
  }, [sessionID, messages, sessionMessages])

  // Sort messages by creation time
  const sortedMessages = [...sessionMessages].sort((a, b) => {
    return a.info.time.created - b.info.time.created
  })

  const scrollSignature = useMemo(() => {
    const messagesSignature = sortedMessages
      .map((message) => {
        const partsSignature = message.parts
          .map((part) => {
            const base = `${part.id}:${part.type}`
            const textValue = (part as { text?: string }).text
            const length = typeof textValue === "string" ? textValue.length : 0
            return `${base}:${length}`
          })
          .join(",")
        return `${message.info.id}:${message.parts.length}:${partsSignature}`
      })
      .join("|")
    // Include idle and reasoning states so indicator appearance/disappearance triggers scroll
    return `${messagesSignature}:idle=${isIdle}:think=${isReasoning}`
  }, [sortedMessages, isIdle, isReasoning])

  const updateScrollState = useCallback(() => {
    const container = messagesContainerRef.current?.parentElement as HTMLElement | null
    if (!container) return
    const distance = container.scrollHeight - container.clientHeight - container.scrollTop
    const threshold = 48
    const isNearBottom = distance <= threshold
    isUserAtBottomRef.current = isNearBottom
  }, [])

  useEffect(() => {
    const container = messagesContainerRef.current?.parentElement as HTMLElement | null
    if (!container) return
    const handleScroll = () => {
      updateScrollState()
    }
    container.addEventListener("scroll", handleScroll)
    updateScrollState()
    return () => {
      container.removeEventListener("scroll", handleScroll)
    }
  }, [sessionID, updateScrollState])

  useEffect(() => {
    const anchor = messagesEndRef.current
    if (!anchor) return
    const shouldScroll = isUserAtBottomRef.current || !hasInitializedRef.current
    if (!shouldScroll) return
    const behavior: ScrollBehavior = hasInitializedRef.current ? "smooth" : "auto"
    anchor.scrollIntoView({ behavior, block: "end" })
    hasInitializedRef.current = true
    isUserAtBottomRef.current = true
  }, [scrollSignature, sessionID])

  // Show empty state if no messages (for both virtual and real sessions)
  if (!sessionID || sortedMessages.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center text-gray-500 dark:text-gray-400">
          <p className="text-lg font-medium mb-2">No messages yet</p>
          <p className="text-sm">Send a message to start the conversation</p>
        </div>
      </div>
    )
  }

  // Inline revert handling: if session has a revert boundary, hide messages at/after it
  const revertBoundaryID = currentSession?.revert?.messageID

  // Build rows with optional inline reverted summary block
  const rows: React.ReactNode[] = []
  let insertedRevertSummary = false
  if (revertBoundaryID) {
    for (const message of sortedMessages) {
      if (!insertedRevertSummary && message.info.id === revertBoundaryID) {
        // Insert a compact inline summary and stop rendering further messages
        rows.push(
          <div
            key="revert-summary"
            className="text-xs px-2 py-1.5 rounded-md bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 border border-gray-200 dark:border-gray-700"
          >
            <div className="flex items-center justify-between">
              <span className="truncate mr-2">Messages and changes after this point are hidden (reverted).</span>
              <div className="flex gap-2">
                <button
                  className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => {
                    if (!currentSession?.id) return
                    if (isRevertBusy) return
                    setRevertAction({ type: "redo" })
                  }}
                  disabled={isRevertBusy}
                >
                  Redo
                </button>
                <button
                  className="px-2 py-1 rounded bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => {
                    if (!currentSession?.id) return
                    if (isRevertBusy) return
                    setRevertAction({ type: "restore" })
                  }}
                  disabled={isRevertBusy}
                >
                  Restore
                </button>
              </div>
            </div>
          </div>,
        )
        insertedRevertSummary = true
        break
      }
      rows.push(
        <MessageRow
          key={message.info.id}
          message={message}
          onFork={handleForkStart}
          onRevert={handleRevert}
          revertBusy={isRevertBusy}
          sessionID={sessionID || undefined}
        />,
      )
    }
  } else {
    for (const message of sortedMessages) {
      const isSummaryAssistant =
        message.info.role === "assistant" && (message.info as { summary?: boolean }).summary === true

      if (isSummaryAssistant) {
        rows.push(
          <div key={`${message.info.id}-summary-separator`} className="flex items-center my-4">
            <div className="flex-1 border-t border-dashed border-gray-300 dark:border-gray-700" />
            <span className="mx-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
              Conversation compacted here
            </span>
            <div className="flex-1 border-t border-dashed border-gray-300 dark:border-gray-700" />
          </div>,
        )
      }

      rows.push(
        <MessageRow
          key={message.info.id}
          message={message}
          onFork={handleForkStart}
          onRevert={handleRevert}
          revertBusy={isRevertBusy}
          sessionID={sessionID || undefined}
        />,
      )
    }
  }

  return (
    <>
      <div ref={messagesContainerRef} className="h-full">
        <div className="space-y-2">
          {/* Revert banner (pinned to top of scroll area) */}
          {currentSession?.revert?.messageID && (
            <div className="sticky top-0 z-10 flex items-center justify-between text-xs px-2 py-1.5 rounded-md bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200 border border-amber-200 dark:border-amber-800">
              <div className="truncate mr-2">Changes after a previous message were undone.</div>
              <div className="flex gap-2">
                <button
                  className="px-2 py-1 rounded bg-amber-200 hover:bg-amber-300 dark:bg-amber-800 dark:hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => {
                    if (!currentSession?.id) return
                    if (isRevertBusy) return
                    setRevertAction({ type: "redo" })
                  }}
                  disabled={isRevertBusy}
                >
                  Redo
                </button>
                <button
                  className="px-2 py-1 rounded bg-amber-200 hover:bg-amber-300 dark:bg-amber-800 dark:hover:bg-amber-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  onClick={() => {
                    if (!currentSession?.id) return
                    if (isRevertBusy) return
                    setRevertAction({ type: "restore" })
                  }}
                  disabled={isRevertBusy}
                >
                  Restore
                </button>
              </div>
            </div>
          )}

          {rows}
          {/* Typing indicator - hide while reasoning parts are streaming */}
          <TypingIndicator visible={!isIdle && !isReasoning} />
          {/* Scroll anchor */}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Fork confirmation modal */}
      <ConfirmModal
        isOpen={!!forkConfirm}
        onClose={() => setForkConfirm(null)}
        onConfirm={handleForkConfirm}
        title="Fork Session"
        message="Create a new session with messages up to this point? This will create a copy of the conversation history."
        confirmText="Fork"
        cancelText="Cancel"
        variant="info"
        isLoading={isForking}
      />

      {/* Revert / Redo / Restore confirmation modal */}
      <ConfirmModal
        isOpen={!!revertAction}
        onClose={handleRevertCancel}
        onConfirm={handleRevertConfirm}
        title={
          revertAction?.type === "undo"
            ? "Undo session changes"
            : revertAction?.type === "redo"
              ? "Redo session changes"
              : revertAction?.type === "restore"
                ? "Restore all changes"
                : ""
        }
        message={
          revertAction?.type === "undo"
            ? "Undo messages and file changes after this message?"
            : revertAction?.type === "redo"
              ? "Redo the next undone messages and file changes?"
              : revertAction?.type === "restore"
                ? "Restore all previously undone messages and file changes?"
                : ""
        }
        confirmText={
          revertAction?.type === "undo"
            ? "Undo"
            : revertAction?.type === "redo"
              ? "Redo"
              : revertAction?.type === "restore"
                ? "Restore"
                : "Confirm"
        }
        cancelText="Cancel"
        variant="warning"
        isLoading={isRevertBusy}
      />
    </>
  )
}
