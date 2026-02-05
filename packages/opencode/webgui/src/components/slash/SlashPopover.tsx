import { useLayoutEffect, useMemo, useRef } from "react"
import { useSlashSearch } from "../../hooks/useSlashSearch"
import { useMentionNavigation } from "../../hooks/useMentionNavigation"
import type { SlashItem } from "./utils"

interface SlashPopoverProps {
  query: string
  position: { top: number; left: number; placement: "top" | "bottom" }
  onSelect: (item: SlashItem) => void
  onClose: () => void
  onReposition?: () => void
}

export function SlashPopover({ query, position, onSelect, onClose, onReposition }: SlashPopoverProps) {
  const { results, isLoading, error } = useSlashSearch(query)
  const rootRef = useRef<HTMLDivElement>(null)

  const transform = useMemo(
    () => (position.placement === "top" ? "translateY(-100%)" : "translateY(0)"),
    [position.placement],
  )

  useLayoutEffect(() => {
    if (!onReposition) return
    const node = rootRef.current
    if (!node) return

    onReposition()
    const frame = requestAnimationFrame(() => onReposition())

    if (typeof ResizeObserver === "undefined") {
      return () => cancelAnimationFrame(frame)
    }

    const observer = new ResizeObserver(() => onReposition())
    observer.observe(node)

    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [onReposition, isLoading, results.length])

  const handleSelect = (index: number) => {
    const item = results[index]
    if (!item) return
    onSelect(item)
  }

  const { selectedIndex, setSelectedIndex, listRef } = useMentionNavigation({
    itemCount: results.length,
    onSelect: handleSelect,
    onClose,
    isOpen: true,
  })

  const empty = results.length === 0 && !isLoading
  const message = error ? error.message : query ? "No results found" : "Type to search..."

  if (empty) {
    return (
      <div
        ref={rootRef}
        className="absolute z-50 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded shadow-lg"
        style={{ top: position.top, left: position.left, transform, maxWidth: "calc(100vw - 16px)" }}
        data-slash-popover
      >
        <div className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400">{message}</div>
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      className="absolute z-50 bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 rounded shadow-lg"
      style={{ top: position.top, left: position.left, transform, maxWidth: "calc(100vw - 16px)" }}
      data-slash-popover
    >
      <div ref={listRef} className="max-h-64 overflow-y-auto" style={{ maxWidth: "calc(100vw - 16px)" }}>
        {isLoading && results.length === 0 ? (
          <div className="px-2 py-1 text-xs text-gray-500 dark:text-gray-400">Loading...</div>
        ) : (
          <div className="py-0.5">
            {results.map((item, index) => (
              <SlashItemRow
                key={item.id}
                item={item}
                isSelected={index === selectedIndex}
                index={index}
                onClick={() => onSelect(item)}
                onMouseEnter={() => setSelectedIndex(index)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface SlashItemRowProps {
  item: SlashItem
  isSelected: boolean
  index: number
  onClick: () => void
  onMouseEnter: () => void
}

function SlashItemRow({ item, isSelected, index, onClick, onMouseEnter }: SlashItemRowProps) {
  const suffix = item.kind === "command" && item.source && item.source !== "command" ? ":" + item.source : ""
  const display = item.kind === "skill" ? `/skill:${item.name}` : `/${item.name}${suffix}`
  const badge =
    item.kind === "skill" ? "Skill" : item.source === "mcp" ? "MCP" : item.source === "skill" ? "Skill" : "Command"

  return (
    <div
      data-index={index}
      className={`px-2 py-1 cursor-pointer flex items-center gap-1.5 ${
        isSelected ? "bg-blue-50 dark:bg-blue-950" : "hover:bg-gray-50 dark:hover:bg-gray-800"
      }`}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
    >
      <div
        className={`flex-shrink-0 ${
          isSelected ? "text-blue-600 dark:text-blue-400" : "text-gray-600 dark:text-gray-400"
        }`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d={item.kind === "skill" ? "M12 6v12m6-6H6" : "M8 7h8M8 12h8M8 17h8"}
          />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span
            className={`text-xs truncate ${
              isSelected ? "text-gray-900 dark:text-gray-100 font-medium" : "text-gray-900 dark:text-gray-100"
            }`}
          >
            {display}
          </span>
          <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">{badge}</span>
        </div>
        {item.description && (
          <div className="text-[10px] text-gray-500 dark:text-gray-400 truncate">{item.description}</div>
        )}
      </div>
    </div>
  )
}
