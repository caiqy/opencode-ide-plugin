import { useEffect, useRef, useState } from "react"
import { IconButton } from "../common"
import { MessageStats } from "./MessageStats"
import { writeClipboard } from "../../utils/clipboard"

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
  onRetry?: () => void
  revertBusy?: boolean
  retryDisabled?: boolean
  tokens?: TokenData
  cost?: number
  isUser?: boolean
  copyText?: string
  inline?: boolean
}

export function ActionButtons({
  onFork,
  onRevert,
  onRetry,
  revertBusy,
  retryDisabled,
  tokens,
  cost,
  isUser,
  copyText,
  inline,
}: ActionButtonsProps) {
  const [copied, setCopied] = useState(false)
  const [isVisible, setIsVisible] = useState(!!inline)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const hasTokens =
    tokens &&
    (tokens.input > 0 || tokens.output > 0 || tokens.reasoning > 0 || tokens.cache.read > 0 || tokens.cache.write > 0)

  const canCopy = typeof copyText === "string" && copyText.length > 0

  useEffect(() => {
    if (inline) {
      setIsVisible(true)
      return
    }

    const anyOther = canCopy || !!(isUser && onFork) || !!(isUser && onRevert) || !!(isUser && onRetry)
    const delay = anyOther ? 500 : 3000

    const timer = setTimeout(() => {
      setIsVisible(true)
    }, delay)

    return () => {
      clearTimeout(timer)
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [canCopy, inline, isUser, onFork, onRetry, onRevert])

  const handleCopy = () => {
    if (!canCopy) return

    void (async () => {
      const ok = await writeClipboard(copyText)
      if (!ok) {
        console.error("Failed to copy message")
        return
      }

      setCopied(true)
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => setCopied(false), 1500)
    })()
  }

  if (!isVisible) return null

  const buttons = (
    <>
      {canCopy && (
        <IconButton
          onClick={handleCopy}
          size="sm"
          className="shrink-0 p-0.5"
          aria-label={copied ? "已复制到剪贴板" : "复制到剪贴板"}
          title={copied ? "已复制！" : "复制到剪贴板"}
          data-tip={copied ? "已复制！" : "复制到剪贴板"}
          icon={
            copied ? (
              <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            )
          }
        />
      )}

      {isUser && onFork && (
        <IconButton
          onClick={onFork}
          size="sm"
          className="shrink-0 p-0.5"
          aria-label="从此消息分叉会话"
          title="从此消息分叉会话"
          data-tip="从此消息分叉会话"
          icon={
            <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
          size="sm"
          className="shrink-0 p-0.5 hover:text-red-600 dark:hover:text-red-400"
          disabled={revertBusy}
          aria-label="回退到此消息"
          title="回退到此消息"
          data-tip="回退到此消息"
          icon={
            <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
      {isUser && onRetry && (
        <IconButton
          onClick={onRetry}
          size="sm"
          className="shrink-0 p-0.5"
          disabled={retryDisabled}
          aria-label="重试消息"
          title={retryDisabled ? "对话进行中，无法重试" : "重试消息"}
          data-tip={retryDisabled ? "对话进行中，无法重试" : "重试消息"}
          icon={
            <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M20 11a8 8 0 10-2.34 5.66M20 11V5m0 6h-6"
              />
            </svg>
          }
        />
      )}
      {hasTokens && tokens && typeof cost === "number" && <MessageStats tokens={tokens} cost={cost} />}
    </>
  )

  if (inline) return <div className="flex shrink-0 items-center gap-0.5">{buttons}</div>

  return (
    <div className="absolute inset-x-0 top-0 bottom-0 pointer-events-none z-50">
      <div className="sticky top-1 h-0 w-full overflow-visible">
        <div className="absolute left-1/2 -translate-x-1/2 top-0 flex gap-0.5 bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md p-px pointer-events-auto">
          {buttons}
        </div>
      </div>
    </div>
  )
}
