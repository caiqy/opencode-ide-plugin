import { useEffect, useMemo } from "react"
import { IconButton } from "../common"
import { useMessages } from "../../state/MessagesContext"
import { useSubtaskDrawer } from "../../state/SubtaskDrawerContext"
import { SubtaskMessageList } from "./SubtaskMessageList"
import { getToolLabel } from "../parts/ToolPart/utils"
import type { WebguiPart } from "../../types/messages"

function isToolPart(part: WebguiPart): part is Extract<WebguiPart, { type: "tool" }> {
  return part.type === "tool"
}

export function SubtaskDrawer() {
  const { isOpen, sessionId, title, parent, closeSubtaskDrawer } = useSubtaskDrawer()
  const { loadSessionMessages, getMessagesBySession } = useMessages()

  const toolStats = useMemo(() => {
    if (!sessionId) {
      return { totalCalls: 0, currentToolLabel: "空闲" }
    }

    const toolParts = getMessagesBySession(sessionId)
      .flatMap((message) => message.parts)
      .filter(isToolPart)

    const currentTool = [...toolParts]
      .reverse()
      .find((part) => part.state?.status === "running" || part.state?.status === "pending")

    return {
      totalCalls: toolParts.length,
      currentToolLabel: currentTool ? getToolLabel(currentTool.tool) : "空闲",
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

  const currentToolLabel = toolStats.currentToolLabel === "空闲" && isParentCompleted ? "已完成" : toolStats.currentToolLabel

  const headerSummary = useMemo(() => {
    const toolName = getToolLabel("task")
    const base = `${toolName}${title ? `：${title}` : ""}`
    return `${base} [ ${toolStats.totalCalls} 工具调用 / ${currentToolLabel} ]`
  }, [toolStats.totalCalls, currentToolLabel, title])

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
    if (!isOpen) return
    if (!sessionId) return
    void loadSessionMessages(sessionId)
  }, [isOpen, sessionId, loadSessionMessages])

  if (!isOpen || !sessionId) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm"
      data-testid="subtask-drawer-backdrop"
      onClick={closeSubtaskDrawer}
    >
      <div
        role="dialog"
        aria-label="子任务"
        className="fixed right-0 top-0 h-full w-[min(520px,100%)] bg-white dark:bg-gray-950 border-l border-gray-200 dark:border-gray-800 shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
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
          <SubtaskMessageList sessionID={sessionId} />
        </div>
      </div>
    </div>
  )
}
