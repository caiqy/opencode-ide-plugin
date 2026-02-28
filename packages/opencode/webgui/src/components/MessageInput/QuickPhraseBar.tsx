import { useMemo, useState } from "react"

interface QuickPhraseBarProps {
  items: Array<{ id: string; title: string; body: string }>
  mode?: string
  disabled: boolean
  onActivate: (item: { id: string; title: string; body: string }) => void
}

const modeLabels: Record<string, string> = {
  double_send: "直接发送",
  confirm_send: "确认后发送",
  fill_input: "回填输入框",
}

export function QuickPhraseBar({ items, mode = "fill_input", disabled, onActivate }: QuickPhraseBarProps) {
  const [expanded, setExpanded] = useState(false)
  const list = useMemo(() => items.filter((item) => item.title.trim()), [items])
  if (list.length === 0) return null

  return (
    <div className="px-2 py-1 border-b border-gray-100 dark:border-gray-800">
      <div className="flex items-start gap-2">
        <div
          data-testid="quick-phrase-row"
          className={`flex gap-1 flex-1 ${expanded ? "flex-wrap" : "overflow-x-auto whitespace-nowrap"}`}
        >
          {list.map((item) => (
            <button
              key={item.id}
              disabled={disabled}
              title={`双击(${modeLabels[mode] || "未知模式"})：${item.body}`}
              onDoubleClick={() => onActivate(item)}
              className="inline-flex items-center justify-center shrink-0 h-6 px-2 rounded border border-blue-300 dark:border-blue-700 bg-blue-100 dark:bg-blue-900/30 text-xs text-blue-700 dark:text-blue-300 disabled:opacity-40 disabled:cursor-not-allowed"
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
