import { useCallback, useEffect, useRef, useState } from "react"

import { isDefaultTitle } from "../../state/SessionContext"

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

  const saveEdit = useCallback(() => {
    setEditing(false)
    if (editValue !== title) {
      onRename(editValue)
    }
  }, [editValue, onRename, title])

  const cancelEdit = useCallback(() => {
    setEditValue(title)
    setEditing(false)
  }, [title])

  const handleDoubleClick = useCallback(() => {
    setEditValue(title)
    setEditing(true)
  }, [title])

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
    "group h-full min-w-[120px] max-w-[200px] flex-shrink-0",
    "flex items-center gap-1.5 px-2 border-b-2 select-none",
    "cursor-pointer",
    isActive
      ? "border-b-2 border-blue-500 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100"
      : "border-b-2 border-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800",
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
        <span
          className={`min-w-0 flex-1 truncate text-xs ${hasDefaultTitle ? "italic text-gray-400 dark:text-gray-500" : ""}`}
        >
          {displayTitle}
        </span>
      )}

      <button
        onClick={handleClose}
        className={`w-4 h-4 flex-shrink-0 transition-opacity ${isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        aria-label="关闭标签"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  )
}
