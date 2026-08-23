import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { IconButton } from "../common"
import { useMessages } from "../../state/MessagesContext"
import { useSubtaskDrawer } from "../../state/SubtaskDrawerContext"
import { SubtaskMessageList } from "./SubtaskMessageList"
import { getSubtaskStatusLabel, getToolLabel } from "../parts/ToolPart/utils"
import type { WebguiPart } from "../../types/messages"

const MAIN_CONTENT_MAX_WIDTH = 860

function isToolPart(part: WebguiPart): part is Extract<WebguiPart, { type: "tool" }> {
  return part.type === "tool"
}

export function SubtaskDrawer() {
  const { isOpen, sessionId, title, subagentType, parent, closeSubtaskDrawer } = useSubtaskDrawer()
  const { ensureSession, getMessagesBySession, isSessionLoadError } = useMessages()
  const [ready, setReady] = useState<{ key: string | null; done: boolean }>({ key: null, done: false })

  const toolStats = useMemo(() => {
    if (!sessionId) {
      return { totalCalls: 0, currentToolLabel: null }
    }

    const toolParts = getMessagesBySession(sessionId)
      .flatMap((message) => message.parts)
      .filter(isToolPart)

    const currentTool = [...toolParts]
      .reverse()
      .find((part) => part.state?.status === "running" || part.state?.status === "pending")

    return {
      totalCalls: toolParts.length,
      currentToolLabel: currentTool ? getToolLabel(currentTool.tool) : null,
    }
  }, [sessionId, getMessagesBySession])

  const isParentCompleted = useMemo(() => {
    if (!parent?.sessionId) return false

    const parentMessages = getMessagesBySession(parent.sessionId)
    if (parent.messageId) {
      const target = parentMessages.find((message) => message.info.id === parent.messageId)
      const part = target?.parts.find((item) => item.id === parent.partId)
      if (part?.type === "tool" && part.tool === "task") {
        return part.state?.status === "completed"
      }
    }

    if (parent.partId) {
      for (const message of parentMessages) {
        const part = message.parts.find((item) => item.id === parent.partId)
        if (part?.type === "tool" && part.tool === "task") {
          return part.state?.status === "completed"
        }
      }
    }

    return false
  }, [parent, getMessagesBySession])

  const currentToolLabel = getSubtaskStatusLabel({
    currentToolLabel: toolStats.currentToolLabel,
    isParentCompleted,
  })

  const key = isOpen && sessionId ? sessionId : null
  const cold = !sessionId || getMessagesBySession(sessionId).length === 0
  const done = ready.key === key ? ready.done : false
  const err = !!key && isSessionLoadError(key)
  const load = !!key && cold && !done && !err

  const retry = useCallback(() => {
    if (!key) return
    void ensureSession(key).then((value) => {
      if (value === null) return
      setReady({ key, done: true })
    })
  }, [ensureSession, key])

  const headerSummary = useMemo(() => {
    const toolName = getToolLabel("task")
    const agentTag = subagentType ? ` (${subagentType})` : ""
    const base = `${toolName}${agentTag}${title ? `：${title}` : ""}`
    if (load) return `${base} [ 正在加载子任务… ]`
    if (err) return `${base} [ 子任务加载失败 ]`
    return `${base} [ 已加载 ${toolStats.totalCalls} 个工具调用 / ${currentToolLabel} ]`
  }, [err, load, toolStats.totalCalls, currentToolLabel, title, subagentType])

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      closeSubtaskDrawer()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [isOpen, closeSubtaskDrawer])

  useEffect(() => {
    if (!key) {
      setReady({ key: null, done: false })
      return
    }
    if (!cold) {
      void ensureSession(key)
      return
    }
    let live = true
    void ensureSession(key)
      .then((value) => {
        if (!live) return
        if (value === null) return
        setReady({ key, done: true })
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [cold, ensureSession, key])

  if (!isOpen || !sessionId) return null

  const DEFAULT_WIDTH = Math.min(Math.floor(window.innerWidth * 0.9), MAIN_CONTENT_MAX_WIDTH)
  const MIN_WIDTH = 360

  return (
    <ResizableDrawer
      defaultWidth={DEFAULT_WIDTH}
      minWidth={MIN_WIDTH}
      maxWidth={MAIN_CONTENT_MAX_WIDTH}
      onBackdropClick={closeSubtaskDrawer}
    >
      <div className="h-10 px-3 border-b border-gray-200 dark:border-gray-800 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{headerSummary}</div>
        </div>
        <IconButton
          size="sm"
          aria-label="关闭子任务"
          title="关闭"
          onClick={closeSubtaskDrawer}
          icon={
            <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          }
        />
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {load ? (
          <div
            data-testid="subtask-drawer-loading"
            className="h-full min-h-24 flex items-center justify-center text-sm text-gray-500 dark:text-gray-400"
          >
            正在加载子任务…
          </div>
        ) : err ? (
          <div className="h-full min-h-24 flex flex-col items-center justify-center gap-3 text-sm text-gray-500 dark:text-gray-400">
            <div>子任务加载失败</div>
            <button
              className="text-xs px-2 py-1 rounded border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-200"
              onClick={retry}
            >
              重试加载
            </button>
          </div>
        ) : (
          <SubtaskMessageList sessionID={sessionId} />
        )}
      </div>
    </ResizableDrawer>
  )
}

function ResizableDrawer({
  defaultWidth,
  minWidth,
  maxWidth,
  onBackdropClick,
  children,
}: {
  defaultWidth: number
  minWidth: number
  maxWidth: number
  onBackdropClick: () => void
  children: React.ReactNode
}) {
  const [width, setWidth] = useState(defaultWidth)
  const drag = useRef<{ x: number; w: number } | null>(null)

  const clamp = useCallback(
    (next: number) => Math.min(window.innerWidth * 0.9, maxWidth, Math.max(minWidth, next)),
    [maxWidth, minWidth],
  )

  const onMove = useCallback(
    (e: PointerEvent) => {
      if (!drag.current) return
      setWidth(clamp(drag.current.w + (drag.current.x - e.clientX)))
    },
    [clamp],
  )

  const onEnd = useCallback(() => {
    drag.current = null
    document.removeEventListener("pointermove", onMove)
    document.removeEventListener("pointerup", onEnd)
    document.removeEventListener("pointercancel", onEnd)
    document.body.style.userSelect = ""
  }, [onMove])

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return
      e.stopPropagation()
      drag.current = { x: e.clientX, w: width }
      document.body.style.userSelect = "none"
      document.addEventListener("pointermove", onMove)
      document.addEventListener("pointerup", onEnd)
      document.addEventListener("pointercancel", onEnd)
    },
    [width, onMove, onEnd],
  )

  useEffect(() => {
    return () => {
      drag.current = null
      document.removeEventListener("pointermove", onMove)
      document.removeEventListener("pointerup", onEnd)
      document.removeEventListener("pointercancel", onEnd)
      document.body.style.userSelect = ""
    }
  }, [onMove, onEnd])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm"
      data-testid="subtask-drawer-backdrop"
      onClick={onBackdropClick}
    >
      <div
        role="dialog"
        aria-label="子任务"
        className="fixed right-0 top-0 h-full bg-white dark:bg-gray-950 border-l border-gray-200 dark:border-gray-800 shadow-2xl flex flex-col"
        style={{ width: `${width}px`, maxWidth: `min(90vw, ${maxWidth}px)` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Resize handle */}
        <div
          data-testid="subtask-drawer-resize-handle"
          className="absolute left-0 top-0 h-full w-2 cursor-col-resize z-10 group"
          onPointerDown={onResizeStart}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="absolute left-0 top-0 h-full w-px bg-transparent group-hover:bg-gray-400 dark:group-hover:bg-gray-600 transition-colors" />
        </div>
        {children}
      </div>
    </div>
  )
}
