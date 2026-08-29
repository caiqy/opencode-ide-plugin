import { useState } from "react"
import type { Message } from "../../state/MessagesContext"
import { isAssistantMessage, isUserMessage, type AssistantMessage } from "../../types/messages"
import { MessagePart } from "./MessagePart"
import { SessionErrorPart } from "./SessionErrorPart"
import { ActionButtons } from "./ActionButtons"
import { AssistantMeta } from "./AssistantMeta"
import { getPartStart, getPartEnd, mergeReasoningParts, sortParts } from "./utils"
import { cn } from "../../utils/classNames"
import { useProviderStore } from "../../hooks/useProviderStore"
import { getMessageCopyText } from "./messageCopy"
import { formatMessageDateTime } from "../../utils/formatting"
import { getMessageLastActivityAt } from "./turnMeta"

interface MessageRowProps {
  message: Message
  onFork?: (messageId: string) => void
  onRevert?: (messageId: string) => void
  onRetry?: (messageId: string) => void
  userActionMode?: "full" | "copy"
  revertBusy?: boolean
  retryDisabled?: boolean
  sessionID?: string
  isLast?: boolean
  showMeta?: boolean
  turnDurationMs?: number
  sessionInterrupted?: boolean
}

export function MessageRow({
  message,
  onFork,
  onRevert,
  onRetry,
  userActionMode = "full",
  revertBusy,
  retryDisabled,
  sessionID,
  isLast,
  showMeta,
  turnDurationMs,
  sessionInterrupted,
}: MessageRowProps) {
  const [isHovered, setIsHovered] = useState(false)
  const userMessage = isUserMessage(message.info) ? message.info : undefined
  const isUser = !!userMessage
  const isAssistant = isAssistantMessage(message.info)
  const skipPartIds = new Set<string>()
  const { resolveModelName } = useProviderStore()

  const copyText = getMessageCopyText(message) ?? ""

  const canCopy = copyText.length > 0

  const assistantInfo = isAssistant ? (message.info as AssistantMessage) : null
  const error = assistantInfo?.error as { name?: string; data?: { message?: string }; message?: string } | undefined
  const toolContinues = message.parts.some(
    (part) =>
      part.type === "tool" &&
      part.metadata?.providerExecuted !== true &&
      !(part.state.status === "error" && part.state.metadata?.interrupted === true),
  )
  const activeTool = message.parts.some(
    (part) => part.type === "tool" && (part.state.status === "pending" || part.state.status === "running"),
  )
  const continues = Boolean(
    assistantInfo &&
    !error &&
    assistantInfo.structured === undefined &&
    (assistantInfo.finish === "tool-calls" ||
      assistantInfo.finish === "unknown" ||
      (assistantInfo.finish !== undefined && toolContinues)),
  )
  const interrupted = Boolean(
    error?.name === "MessageAbortedError" ||
    (sessionInterrupted &&
      assistantInfo &&
      !error &&
      (continues || assistantInfo.time.completed === undefined || activeTool)),
  )
  const completedAt = assistantInfo?.time.completed ?? (interrupted ? getMessageLastActivityAt(message) : undefined)
  const errorMessage =
    typeof error?.data?.message === "string"
      ? error.data.message
      : typeof error?.message === "string"
        ? error.message
        : undefined

  const showMessageLevelError = Boolean(
    isLast && !isUser && error?.name && errorMessage && !message.parts.some((p) => p.type === "session-error"),
  )

  // Calculate durations for reasoning parts using timestamps when available
  const parts = mergeReasoningParts(message.parts)
  const partsWithDurations = parts.map((part) => {
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
      className={cn("group relative", isUser && "flex justify-end")}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Render all parts (sorted: reasoning → tool → text) */}
      <div className={cn("flex flex-col gap-3", isUser && "min-w-0")}>
        {isUser && <div className="text-right text-xs text-gray-500 dark:text-gray-400">你</div>}
        {sortParts(partsWithDurations).map(({ part, durationMs }) => (
          <MessagePart
            key={part.id}
            part={part}
            isUser={isUser}
            allParts={parts}
            durationMs={durationMs}
            sessionID={sessionID}
            messageID={message.info.id}
            skipPartIds={skipPartIds}
            sessionInterrupted={sessionInterrupted}
          />
        ))}

        {isUser && (
          <div
            data-testid="user-message-meta"
            className={cn(
              "flex flex-wrap items-center justify-end gap-1 text-xs text-gray-500 transition-opacity dark:text-gray-400",
              isHovered ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
              "focus-within:pointer-events-auto focus-within:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
            )}
          >
            <span data-testid="user-message-time">
              {userMessage ? formatMessageDateTime(userMessage.time.created) : ""}
            </span>
            {(canCopy || onFork || onRevert || onRetry) && (
              <ActionButtons
                onFork={userActionMode === "full" && onFork ? () => onFork(message.info.id) : undefined}
                onRevert={userActionMode === "full" && onRevert ? () => onRevert(message.info.id) : undefined}
                onRetry={userActionMode === "full" && onRetry ? () => onRetry(message.info.id) : undefined}
                revertBusy={revertBusy}
                retryDisabled={retryDisabled}
                isUser
                copyText={copyText}
                inline
              />
            )}
          </div>
        )}

        {/* Message-level errors (e.g. MessageAbortedError) */}
        {showMessageLevelError && (
          <SessionErrorPart
            part={{
              id: `message-error-${message.info.id}`,
              type: "session-error",
              sessionID: message.info.sessionID,
              messageID: message.info.id,
              message: errorMessage!,
            }}
          />
        )}

        {/* Assistant turn meta (model, duration, etc.) */}
        {showMeta &&
          isAssistant &&
          (!continues || interrupted) &&
          completedAt !== undefined && (
          <AssistantMeta
            agent={assistantInfo?.agent ?? ""}
            modelName={resolveModelName(assistantInfo?.providerID ?? "", assistantInfo?.modelID ?? "")}
            variant={assistantInfo?.variant || undefined}
            durationMs={turnDurationMs}
            completedAt={completedAt}
            interrupted={interrupted}
          />
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
