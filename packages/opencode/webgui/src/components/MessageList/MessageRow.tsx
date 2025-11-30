import { useState } from "react"
import type { Message } from "../../state/MessagesContext"
import { MessagePart } from "./MessagePart"
import { ActionButtons } from "./ActionButtons"
import { getPartStart, getPartEnd } from "./utils"
import { cn } from "../../utils/classNames"

interface MessageRowProps {
  message: Message
  onFork: (messageId: string) => void
  onRevert: (messageId: string) => void
  revertBusy: boolean
  sessionID?: string
}

export function MessageRow({ message, onFork, onRevert, revertBusy, sessionID }: MessageRowProps) {
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
      className={cn("group relative", isUser && "flex justify-end")}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Fork / Undo buttons (visible on hover) */}
      {isUser && isHovered && (
        <ActionButtons
          onFork={() => onFork(message.info.id)}
          onRevert={() => onRevert(message.info.id)}
          revertBusy={revertBusy}
        />
      )}

      {/* Render all parts */}
      <div className="space-y-1">
        {partsWithDurations.map(({ part, durationMs }) => (
          <MessagePart
            key={part.id}
            part={part}
            isUser={isUser}
            allParts={message.parts}
            durationMs={durationMs}
            sessionID={sessionID}
            messageID={message.info.id}
            skipPartIds={skipPartIds}
          />
        ))}

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
