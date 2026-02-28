import { useMemo, useState } from "react"

interface QuickPhraseBarProps {
  items: Array<{ id: string; title: string; body: string }>
  disabled: boolean
  onActivate: (item: { id: string; title: string; body: string }) => void
}

export function QuickPhraseBar({ items, disabled, onActivate }: QuickPhraseBarProps) {
  const [expanded, setExpanded] = useState(false)
  const list = useMemo(() => items.filter((item) => item.title.trim()), [items])
  if (list.length === 0) return null

  return (
    <div className="px-2 pt-1 border-b border-gray-100 dark:border-gray-800">
      <div className="flex items-start gap-2">
        <div
          data-testid="quick-phrase-row"
          className={`flex gap-1 flex-1 ${expanded ? "flex-wrap" : "overflow-x-auto whitespace-nowrap"}`}
        >
          {list.map((item) => (
            <button
              key={item.id}
              disabled={disabled}
              onDoubleClick={() => onActivate(item)}
              className="inline-flex shrink-0 h-6 px-2 rounded border border-gray-300 dark:border-gray-700 text-xs text-gray-700 dark:text-gray-200 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {item.title}
            </button>
          ))}
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          disabled={disabled}
          className="text-xs text-gray-500 dark:text-gray-400 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {expanded ? "收起" : "展开"}
        </button>
      </div>
    </div>
  )
}
