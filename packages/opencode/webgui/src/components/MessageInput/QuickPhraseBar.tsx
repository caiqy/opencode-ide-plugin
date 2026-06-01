import { useCallback, useMemo, useRef, useState } from "react"

interface QuickPhraseItem {
  id: string
  title: string
  body: string
}

interface QuickPhraseBarProps {
  items: QuickPhraseItem[]
  disabled: boolean
  onSend: (item: QuickPhraseItem) => void
  onFill: (item: QuickPhraseItem) => void
}

const RIGHT_DOUBLE_CLICK_MS = 400

export function QuickPhraseBar({ items, disabled, onSend, onFill }: QuickPhraseBarProps) {
  const [expanded, setExpanded] = useState(false)
  const row = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: number; x: number; left: number; moved: boolean } | null>(null)
  const lastRightClick = useRef<{ id: string; time: number } | null>(null)
  const list = useMemo(() => items.filter((item) => item.title.trim()), [items])
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
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
    <div className="px-2 py-1 border-b border-gray-100 dark:border-gray-800">
      <div className="flex items-start gap-2">
        <div
          ref={row}
          data-testid="quick-phrase-row"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={`flex gap-1 flex-1 ${expanded ? "flex-wrap" : "overflow-x-auto whitespace-nowrap scrollbar-hide cursor-grab"}`}
        >
          {list.map((item) => (
            <button
              key={item.id}
              disabled={disabled}
              title={`左键双击发送 / 右键双击回填：${item.body}`}
              onDoubleClick={() => {
                if (disabled) return
                onSend(item)
              }}
              onContextMenu={(e) => handleContextMenu(e, item)}
              className="inline-flex items-center justify-center shrink-0 h-6 px-2 rounded border border-blue-300 dark:border-blue-700 bg-blue-100 dark:bg-blue-900/30 text-xs text-blue-700 dark:text-blue-300 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {item.title}
            </button>
          ))}
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          disabled={disabled}
          className="inline-flex h-6 items-center shrink-0 text-xs text-gray-500 dark:text-gray-400 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {expanded ? "收起" : "展开"}
        </button>
      </div>
    </div>
  )
}
