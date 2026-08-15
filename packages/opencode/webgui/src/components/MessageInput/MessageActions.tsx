import { useSessionUsage } from "../../hooks/useSessionUsage"
import { UsageDisplay } from "../CompactHeader/UsageDisplay"

interface MessageActionsProps {
  isIdle: boolean
  isButtonDisabled: boolean
  isCompactDisabled: boolean
  onSubmit: () => void
  onAbort: () => void
  onCompactClick: () => void
}

export function MessageActions({
  isIdle,
  isButtonDisabled,
  isCompactDisabled,
  onSubmit,
  onAbort,
  onCompactClick,
}: MessageActionsProps) {
  const usage = useSessionUsage()

  return (
    <div className="flex shrink-0 items-center gap-1">
      <UsageDisplay usage={usage} variant="ring" />
      <button
        type="button"
        onClick={onCompactClick}
        disabled={isCompactDisabled}
        className="flex h-6 w-6 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100 disabled:cursor-not-allowed disabled:opacity-30"
        aria-label="压缩上下文"
        title="精简会话历史"
        data-tip="精简会话历史"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 3l6 6M3 9h6V3M21 3l-6 6M21 9h-6V3M3 21l6-6M3 15h6v6M21 21l-6-6M21 15h-6v6"
          />
        </svg>
      </button>
      {isIdle ? (
        <button
          type="button"
          onClick={onSubmit}
          disabled={isButtonDisabled}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-30"
          aria-label="发送（回车）"
          title="发送（回车）"
          data-tip="发送（回车）"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0-7 7m7-7 7 7" />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          onClick={onAbort}
          className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-gray-700 hover:bg-gray-300"
          aria-label="停止生成"
          title="停止生成"
          data-tip="停止生成"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="1" ry="1" />
          </svg>
        </button>
      )}
    </div>
  )
}
