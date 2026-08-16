import { useCallback, useMemo, useRef, useState } from "react"

interface QuickPhraseItem {
  id: string
  title: string
  body: string
}

interface QuickPhraseBarProps {
  items: QuickPhraseItem[]
  disabled: boolean
  sendDisabled?: boolean
  onSend: (item: QuickPhraseItem) => void
  onFill: (item: QuickPhraseItem) => void
}

const RIGHT_DOUBLE_CLICK_MS = 400

export function QuickPhraseBar({ items, disabled, sendDisabled = false, onSend, onFill }: QuickPhraseBarProps) {
  const [expanded, setExpanded] = useState(false)
  const row = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; left: number; moved: boolean } | null>(null)
  const lastRightClick = useRef<{ id: string; time: number } | null>(null)
  const lastLeftClick = useRef<{ id: string; time: number } | null>(null)
  const suppressLeftClick = useRef(false)
  const list = useMemo(() => items.filter((item) => item.title.trim()), [items])
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      suppressLeftClick.current = false
      if (expanded) return
      if (e.button !== 0) return
      const el = row.current
      if (!el) return
      drag.current = {
        id: e.pointerId,
        x: e.clientX,
        left: el.scrollLeft,
        moved: false,
      }
    },
    [expanded],
  )
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const cur = drag.current
    const el = row.current
    if (!cur || !el || cur.id !== e.pointerId) return
    const delta = e.clientX - cur.x
    if (!cur.moved && Math.abs(delta) < 2) return
    if (!cur.moved) {
      cur.moved = true
      suppressLeftClick.current = true
      lastLeftClick.current = null
      el.setPointerCapture(e.pointerId)
    }
    el.scrollLeft = cur.left - delta
    e.preventDefault()
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const cur = drag.current
    const el = row.current
    if (!cur || !el || cur.id !== e.pointerId) return
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    drag.current = null
  }, [])
  const handleLeftClick = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, item: QuickPhraseItem) => {
      if (disabled || sendDisabled || e.detail === 0) return
      if (suppressLeftClick.current) {
        suppressLeftClick.current = false
        return
      }
      const now = Date.now()
      const prev = lastLeftClick.current
      if (prev && prev.id === item.id && now - prev.time <= RIGHT_DOUBLE_CLICK_MS) {
        lastLeftClick.current = null
        onSend(item)
        return
      }
      lastLeftClick.current = { id: item.id, time: now }
    },
    [disabled, onSend, sendDisabled],
  )
  const handleContextMenu = useCallback(
    (e: React.MouseEvent<HTMLButtonElement>, item: QuickPhraseItem) => {
      e.preventDefault()
      if (disabled) return
      const now = Date.now()
      const prev = lastRightClick.current
      if (prev && prev.id === item.id && now - prev.time <= RIGHT_DOUBLE_CLICK_MS) {
        lastRightClick.current = null
        onFill(item)
        return
      }
      lastRightClick.current = { id: item.id, time: now }
    },
    [disabled, onFill],
  )
  if (list.length === 0) return null

  return (
    <div className="first:rounded-t-lg bg-white px-3 py-1.5 dark:bg-[rgb(30,30,30)]">
      <div className="flex items-center gap-1.5">
        <div
          ref={row}
          data-testid="quick-phrase-row"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={`flex flex-1 gap-1.5 ${expanded ? "flex-wrap" : "cursor-grab overflow-x-auto whitespace-nowrap scrollbar-hide"}`}
        >
          {list.map((item) => (
            <button
              key={item.id}
              disabled={disabled}
              title={`左键双击发送 / 右键双击回填：${item.body}`}
              onClick={(e) => handleLeftClick(e, item)}
              onContextMenu={(e) => handleContextMenu(e, item)}
              className="inline-flex h-6 shrink-0 items-center justify-center rounded border border-gray-200 bg-gray-100 px-2 text-xs text-gray-700 hover:border-gray-300 hover:bg-gray-200 dark:border-gray-700 dark:bg-[rgb(26,26,26)] dark:text-gray-200 dark:hover:border-gray-600 dark:hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {item.title}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          disabled={disabled}
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={expanded ? "收起快捷短语" : "展开快捷短语"}
          title={expanded ? "收起快捷短语" : "展开快捷短语"}
          data-tip={expanded ? "收起快捷短语" : "展开快捷短语"}
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={expanded ? "m18 15-6-6-6 6" : "m6 9 6 6 6-6"} />
          </svg>
        </button>
      </div>
    </div>
  )
}
