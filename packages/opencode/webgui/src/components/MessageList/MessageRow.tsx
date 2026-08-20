import { useState } from "react"
import type { Message } from "../../state/MessagesContext"
import { isAssistantMessage, type AssistantMessage } from "../../types/messages"
import { MessagePart } from "./MessagePart"
import { SessionErrorPart } from "./SessionErrorPart"
import { ActionButtons } from "./ActionButtons"
import { AssistantMeta } from "./AssistantMeta"
import { getPartStart, getPartEnd, mergeReasoningParts, sortParts } from "./utils"
import { cn } from "../../utils/classNames"
import { useProviderStore } from "../../hooks/useProviderStore"
import { getMessageCopyText } from "./messageCopy"

interface MessageRowProps {
  message: Message
  onFork?: (messageId: string) => void
  onRevert?: (messageId: string) => void
  revertBusy?: boolean
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
  revertBusy,
  sessionID,
  isLast,
  showMeta,
  turnDurationMs,
  sessionInterrupted,
}: MessageRowProps) {
  const [isHovered, setIsHovered] = useState(false)
  const isUser = message.info.role === "user"
  const isAssistant = isAssistantMessage(message.info)
  const skipPartIds = new Set<string>()
  const { resolveModelName } = useProviderStore()

  const copyText = getMessageCopyText(message) ?? ""

  const canCopy = copyText.length > 0

  const assistantInfo = isAssistant ? (message.info as AssistantMessage) : null
  const tokens = assistantInfo?.tokens
  const cost = assistantInfo?.cost

  const hasTokens =
    tokens &&
    (tokens.input > 0 || tokens.output > 0 || tokens.reasoning > 0 || tokens.cache.read > 0 || tokens.cache.write > 0)

  const error = (message.info as any)?.error as
    | { name?: string; data?: { message?: string }; message?: string }
    | undefined
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
      {/* Action buttons (visible on hover) */}
      {isHovered && (isUser || hasTokens || canCopy) && (
        <ActionButtons
          onFork={onFork ? () => onFork(message.info.id) : undefined}
          onRevert={onRevert ? () => onRevert(message.info.id) : undefined}
          revertBusy={revertBusy}
          tokens={tokens}
          cost={cost}
          isUser={isUser}
          copyText={copyText}
        />
      )}

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
        {showMeta && isAssistant && (assistantInfo?.time?.completed || error?.name === "MessageAbortedError") && (
          <AssistantMeta
            agent={assistantInfo?.agent ?? ""}
            modelName={resolveModelName(assistantInfo?.providerID ?? "", assistantInfo?.modelID ?? "")}
            variant={assistantInfo?.variant || undefined}
            durationMs={turnDurationMs}
            completedAt={assistantInfo?.time?.completed}
            interrupted={error?.name === "MessageAbortedError"}
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
