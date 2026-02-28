import { useEffect } from "react"

interface ChatLoadGuardProps {
  loading: boolean
  error: boolean
  onRetry: () => void
  children: React.ReactNode
}

export function ChatLoadGuard({ loading, error, onRetry, children }: ChatLoadGuardProps) {
  const blocked = loading || error

  useEffect(() => {
    if (!blocked) return
    const active = document.activeElement
    if (!(active instanceof HTMLElement)) return
    active.blur()
  }, [blocked])

  const cls = blocked ? "flex-1 flex flex-col min-h-0 pointer-events-none" : "flex-1 flex flex-col min-h-0"

  return (
    <div className="relative flex-1 flex flex-col min-h-0" aria-busy={loading}>
      <div data-testid="chat-load-content" className={cls}>
        {children}
      </div>
      {blocked && (
        <div
          data-testid="chat-load-overlay"
          className="absolute inset-0 z-20 bg-black/35 backdrop-blur-[1px] flex items-center justify-center"
        >
          {error ? (
            <div className="rounded-md border border-red-300/50 bg-white/95 dark:bg-gray-900/95 px-4 py-3 text-center space-y-2">
              <p className="text-sm text-red-700 dark:text-red-300">会话加载失败</p>
              <button
                onClick={onRetry}
                className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200"
              >
                重试加载
              </button>
            </div>
          ) : (
            <div className="rounded-md border border-gray-300/60 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 px-4 py-3 text-sm text-gray-700 dark:text-gray-200">
              正在加载会话内容…
            </div>
          )}
        </div>
      )}
    </div>
  )
}
