import { useId, useState } from "react"
import type { InputDelivery, InputQueueSnapshot } from "../../lib/api/inputQueue"

export function PendingInputBar(props: {
  snapshot: InputQueueSnapshot | null
  error: string | null
  pending: string[]
  disabled: boolean
  busy: boolean
  onUpdate: (id: string, delivery: InputDelivery) => void
  onRemove: (id: string) => void
  onNext: () => void
  onRefresh: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const listID = useId()
  const items = props.snapshot?.items ?? []
  if (!items.length && !props.error) return null

  const isPaused = Boolean(props.snapshot?.paused)
  const isNextDisabled = props.disabled || props.busy || props.pending.includes("next")

  return (
    <section
      aria-label="待发送消息"
      className={`first:rounded-t-lg border-b border-gray-200/80 bg-gray-50/70 px-3 py-2 text-xs backdrop-blur-xs dark:border-white/[0.08] dark:bg-[rgb(24,24,27)] ${items.length ? "border-t border-t-gray-100 dark:border-t-gray-800" : ""}`}
    >
      {items.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-gray-600 dark:text-gray-300">
            <div className="flex items-center gap-1.5" aria-live="polite">
              <span className="flex h-5 w-5 items-center justify-center rounded-md bg-blue-500/10 text-blue-600 dark:bg-blue-400/10 dark:text-blue-400">
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h10M4 18h7" />
                </svg>
              </span>
              <span className="font-semibold text-gray-800 dark:text-gray-200">待发送</span>
              <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-gray-200/80 px-1 text-[10px] font-bold text-gray-700 dark:bg-white/10 dark:text-gray-300">
                {items.length}
              </span>
            </div>

            {isPaused ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                已暂停
              </span>
            ) : props.busy ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:text-blue-400">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                等待发送
              </span>
            ) : null}

            <div className="ms-auto flex items-center gap-1.5">
              {isPaused && (
                <button
                  type="button"
                  disabled={isNextDisabled}
                  onClick={props.onNext}
                  className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                    isNextDisabled
                      ? "cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-white/5 dark:text-gray-500 opacity-50"
                      : "bg-blue-600 text-white shadow-2xs hover:bg-blue-500 active:scale-98"
                  }`}
                >
                  <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M5 3l14 9-14 9V3z" />
                  </svg>
                  <span>发送下一条</span>
                </button>
              )}

              {items.length > 1 && (
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={listID}
                  aria-label={expanded ? "收起待发送消息" : "展开待发送消息"}
                  title={expanded ? "收起待发送消息" : "展开待发送消息"}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700 focus-visible:outline-blue-500 dark:text-gray-400 dark:hover:bg-white/5 dark:hover:text-gray-200 transition-colors"
                  onClick={() => setExpanded((value) => !value)}
                >
                  <svg
                    className={`h-3.5 w-3.5 transition-transform duration-150 ${expanded ? "rotate-180" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              )}
            </div>
          </div>

          <ul id={listID} className="mt-1 max-h-48 overflow-y-auto">
            {(expanded ? items : items.slice(0, 1)).map((item) => (
              <li
                key={item.id}
                className="group flex min-h-8 items-center gap-2 border-b border-gray-200/70 ps-1 py-0.5 last:border-b-0 hover:bg-gray-100/70 dark:border-white/[0.08] dark:hover:bg-white/[0.04]"
              >
                {item.delivery === "steer" ? (
                  <span className="inline-flex w-12 shrink-0 items-center gap-1 text-[11px] font-medium text-blue-700 dark:text-blue-400">
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    补充
                  </span>
                ) : (
                  <span className="inline-flex w-12 shrink-0 items-center gap-1 text-[11px] font-medium text-gray-600 dark:text-gray-400">
                    <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    排队
                  </span>
                )}

                <span
                  dir="auto"
                  title={item.text}
                  className="min-w-0 flex-1 truncate text-xs text-gray-800 dark:text-gray-200"
                >
                  {item.text}
                </span>

                <div className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    disabled={props.disabled || props.pending.includes(item.id)}
                    aria-label={item.delivery === "steer" ? "转排队" : "转补充"}
                    title={item.delivery === "steer" ? "转排队" : "转补充"}
                    onClick={() => props.onUpdate(item.id, item.delivery === "steer" ? "queue" : "steer")}
                    className="inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded px-1.5 text-xs text-gray-500 hover:bg-gray-200/70 hover:text-gray-800 focus-visible:outline-blue-500 disabled:opacity-40 dark:text-gray-400 dark:hover:bg-white/10 dark:hover:text-gray-200"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                    <span className="hidden sm:inline">{item.delivery === "steer" ? "转排队" : "转补充"}</span>
                  </button>

                  <button
                    type="button"
                    disabled={props.disabled || props.pending.includes(item.id)}
                    aria-label="删除待发送消息"
                    title="删除待发送消息"
                    onClick={() => props.onRemove(item.id)}
                    className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-600 focus-visible:outline-blue-500 disabled:opacity-40 dark:text-gray-500 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {props.error && (
        <div
          role="alert"
          className="mt-2 flex items-center gap-2 rounded-md border border-red-200/80 bg-red-50/70 px-2.5 py-1.5 text-xs text-red-600 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-400"
        >
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <span className="min-w-0 flex-1 truncate">{props.error}</span>
          <button
            type="button"
            className="shrink-0 rounded px-1.5 py-0.5 font-medium underline hover:text-red-700 dark:hover:text-red-300"
            onClick={props.onRefresh}
          >
            重试
          </button>
        </div>
      )}
    </section>
  )
}
