import { useEffect, useRef } from "react"

interface TabContextMenuProps {
  x: number
  y: number
  sessionId: string
  isShared: boolean
  onClose: () => void
  onCloseTab: () => void
  onCloseOtherTabs: () => void
  onRename: () => void
  onDelete: () => void
  onToggleShare: () => void
  onOpenShareLink: () => void
}

export function TabContextMenu({
  x,
  y,
  sessionId,
  isShared,
  onClose,
  onCloseTab,
  onCloseOtherTabs,
  onRename,
  onDelete,
  onToggleShare,
  onOpenShareLink,
}: TabContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      onClose()
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      onClose()
    }

    document.addEventListener("mousedown", handleMouseDown)
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("mousedown", handleMouseDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [onClose])

  const handle = (action: () => void) => () => {
    action()
    onClose()
  }

  return (
    <div
      ref={ref}
      data-session-id={sessionId}
      className="fixed z-[100] min-w-[180px] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1"
      style={{ left: x, top: y }}
    >
      <button
        className="w-full px-3 py-1.5 text-xs text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
        onClick={handle(onCloseTab)}
      >
        关闭标签
      </button>
      <button
        className="w-full px-3 py-1.5 text-xs text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
        onClick={handle(onCloseOtherTabs)}
      >
        关闭其他标签
      </button>
      <div className="my-1 h-px bg-gray-200 dark:bg-gray-700" />

      <button
        className="w-full px-3 py-1.5 text-xs text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
        onClick={handle(onRename)}
      >
        重命名
      </button>
      <button
        className="w-full px-3 py-1.5 text-xs text-left text-red-600 dark:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
        onClick={handle(onDelete)}
      >
        删除会话
      </button>

      <div className="my-1 h-px bg-gray-200 dark:bg-gray-700" />

      <button
        className="w-full px-3 py-1.5 text-xs text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
        onClick={handle(onToggleShare)}
      >
        {isShared ? "取消分享" : "分享会话"}
      </button>
      {isShared && (
        <button
          className="w-full px-3 py-1.5 text-xs text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
          onClick={handle(onOpenShareLink)}
        >
          打开分享链接
        </button>
      )}
    </div>
  )
}
