import { useCallback, useEffect, useRef, useState } from "react"

import { isDefaultTitle } from "../../state/SessionContext"
import { TAB_WIDTH_CLASS } from "./utils"

interface TabProps {
  sessionId: string
  title: string
  isActive: boolean
  isBusy: boolean
  isReasoning: boolean
  onActivate: () => void
  onClose: () => void
  onRename: (title: string) => void
  onContextMenu: (x: number, y: number) => void
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onDragEnd: () => void
  isDragOver: "left" | "right" | null
  isRenaming?: boolean
  onRenameComplete?: () => void
}

export function Tab({
  sessionId,
  title,
  isActive,
  isBusy,
  isReasoning,
  onActivate,
  onClose,
  onRename,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragOver,
  isRenaming,
  onRenameComplete,
}: TabProps) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(title)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const displayTitle = title || "新建会话"
  const hasDefaultTitle = isDefaultTitle(title)

  useEffect(() => {
    if (!editing) return
    const timer = setTimeout(() => inputRef.current?.select(), 0)
    return () => clearTimeout(timer)
  }, [editing])

  useEffect(() => {
    if (editing) return
    setEditValue(title)
  }, [title, editing])

  const startEdit = useCallback(() => {
    setEditValue(title)
    setEditing(true)
  }, [title])

  useEffect(() => {
    if (!isRenaming) return
    startEdit()
  }, [isRenaming, startEdit])

  const saveEdit = useCallback(() => {
    const trimmed = editValue.trim()
    setEditing(false)
    onRenameComplete?.()
    if (trimmed && trimmed !== displayTitle) {
      onRename(trimmed)
    }
  }, [displayTitle, editValue, onRename, onRenameComplete])

  const cancelEdit = useCallback(() => {
    setEditValue(title)
    setEditing(false)
    onRenameComplete?.()
  }, [onRenameComplete, title])

  const handleDoubleClick = useCallback(() => {
    startEdit()
  }, [startEdit])

  const handleClick = useCallback(() => {
    if (editing) return
    onActivate()
  }, [editing, onActivate])

  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onClose()
    },
    [onClose],
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 1) return
      e.preventDefault()
      onClose()
    },
    [onClose],
  )

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      onContextMenu(e.clientX, e.clientY)
    },
    [onContextMenu],
  )

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = "move"
      e.dataTransfer.setData("text/plain", sessionId)
      onDragStart(e)
      setDragging(true)
    },
    [onDragStart, sessionId],
  )

  const handleDragEnd = useCallback(() => {
    setDragging(false)
    onDragEnd()
  }, [onDragEnd])

  const classes = [
    `group h-full ${TAB_WIDTH_CLASS}`,
    "flex items-center gap-1.5 px-2 border-b-2 rounded-t-md select-none",
    "cursor-pointer",
    isActive
      ? "border-x border-t border-gray-300 dark:border-gray-700 border-b-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 shadow-sm"
      : "border-x border-t border-gray-200/70 dark:border-gray-700/60 border-b-transparent bg-gray-50/70 dark:bg-gray-900/40 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800",
    dragging ? "opacity-50" : "",
    isDragOver === "left" ? "border-l-2 border-l-blue-500" : "",
    isDragOver === "right" ? "border-r-2 border-r-blue-500" : "",
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <div
      role="button"
      tabIndex={0}
      className={classes}
      title={displayTitle}
      draggable={!editing}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
      onDragStart={handleDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={handleDragEnd}
    >
      {(isBusy || isReasoning) && (
        <span
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 animate-pulse ${isReasoning ? "bg-purple-500" : "bg-yellow-500"}`}
        />
      )}

      {editing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={saveEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              saveEdit()
              return
            }
            if (e.key === "Escape") {
              cancelEdit()
            }
          }}
          className="min-w-0 flex-1 text-xs bg-transparent border border-blue-500 rounded outline-none"
        />
      ) : (
        <span className="relative min-w-0 flex-1">
          <span
            className={`block overflow-hidden whitespace-nowrap text-xs ${hasDefaultTitle ? "italic text-gray-400 dark:text-gray-500" : ""}`}
          >
            {displayTitle}
          </span>
          <span
            aria-hidden
            className={`pointer-events-none absolute right-0 top-0 h-full w-6 bg-gradient-to-l ${
              isActive
                ? "from-white dark:from-gray-900"
                : "from-gray-50/70 dark:from-gray-900/40 group-hover:from-gray-100 dark:group-hover:from-gray-800"
            } to-transparent`}
          />
        </span>
      )}

      <button
        onClick={handleClose}
        className={`relative z-20 w-4 h-4 flex-shrink-0 transition-opacity ${isActive ? "opacity-100" : "opacity-60 hover:opacity-100"}`}
        aria-label="关闭标签"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
