import { IconButton } from "../common"
import { MessageStats } from "./MessageStats"

interface TokenData {
  input: number
  output: number
  reasoning: number
  cache: {
    read: number
    write: number
  }
}

interface ActionButtonsProps {
  onFork?: () => void
  onRevert?: () => void
  revertBusy?: boolean
  tokens?: TokenData
  cost?: number
  isUser?: boolean
}

export function ActionButtons({ onFork, onRevert, revertBusy, tokens, cost, isUser }: ActionButtonsProps) {
  const hasTokens =
    tokens && (tokens.input > 0 || tokens.output > 0 || tokens.reasoning > 0 || tokens.cache.read > 0 || tokens.cache.write > 0)

  return (
    <div className="absolute left-1/2 -translate-x-1/2 top-0 flex gap-2 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md p-px z-50">
      {isUser && onFork && (
        <IconButton
          onClick={onFork}
          size="md"
          aria-label="Fork session at this message"
          title="Fork session at this message"
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 4v4a4 4 0 004 4h2a4 4 0 014 4v4M7 4h4M7 4H3M17 20h4M17 20l-3-3"
              />
            </svg>
          }
        />
      )}
      {isUser && onRevert && (
        <IconButton
          onClick={onRevert}
          size="md"
          disabled={revertBusy}
          aria-label="Undo from this message (revert)"
          title="Undo from this message (revert)"
          className="hover:text-red-600 dark:hover:text-red-400"
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H5v4m0-4l4 4m2-4h3a5 5 0 010 10H9"
              />
            </svg>
          }
        />
      )}
      {hasTokens && tokens && typeof cost === "number" && <MessageStats tokens={tokens} cost={cost} />}
    </div>
  )
}
