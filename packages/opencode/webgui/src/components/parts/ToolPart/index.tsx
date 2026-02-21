import { useState, useMemo } from "react"
import { DiffModal } from "../../DiffModal"
import { IconButton } from "../../common"
import { useMessages } from "../../../state/MessagesContext"
import { useSubtaskDrawer } from "../../../state/SubtaskDrawerContext"
import { usePartOpen } from "../../MessageList/PartOpenContext"
import { ToolHeader } from "./ToolHeader"
import { PermissionBanner } from "./PermissionBanner"
import { BashTool } from "./BashTool"
import { WriteTool } from "./WriteTool"
import { EditTool } from "./EditTool"
import { TodoTool } from "./TodoTool"
import { GenericOutput } from "./GenericOutput"
import { ErrorDisplay } from "./ErrorDisplay"
import { getToolDisplayName, getBorderColor, getToolLabel } from "./utils"

interface ToolPartProps {
  part: {
    id: string
    type: "tool"
    callID: string
    tool: string
    state: {
      status: "pending" | "running" | "completed" | "error"
      input?: Record<string, unknown>
      output?: string
      title?: string
      error?: string
      metadata?: Record<string, unknown>
      time?: {
        start: number
        end?: number
      }
    }
  }
  sessionID?: string
  messageID?: string
  associatedPatch?: {
    id: string
    type: "patch"
    hash: string
    files: string[]
  }
}

export function ToolPart({ part, sessionID, messageID, associatedPatch }: ToolPartProps) {
  const [showDiffModal, setShowDiffModal] = useState(false)
  const [isResponding, setIsResponding] = useState<"once" | "always" | "reject" | null>(null)

  const open = usePartOpen()
  const isExpanded = open.isOpen(part.id)

  const { openSubtaskDrawer } = useSubtaskDrawer()

  const { getPermissionForCall, getMessagesBySession, respondPermission } = useMessages()
  const permission = useMemo(() => {
    return sessionID ? getPermissionForCall(sessionID, part.callID) : undefined
  }, [getPermissionForCall, sessionID, part.callID])

  const toolName = getToolDisplayName(part.tool, part.state.input, part.state.title, part.state.output)
  const filePath = (part.state.input?.filePath as string | undefined) || undefined
  const patchFilePaths = useMemo(() => {
    if (part.tool !== "apply_patch") return [] as string[]
    const files = (
      part.state.metadata as
        | {
            files?: Array<{ filePath?: string; movePath?: string }>
          }
        | undefined
    )?.files
    if (!Array.isArray(files)) return [] as string[]

    const seen = new Set<string>()
    const next: string[] = []
    const add = (value?: string) => {
      if (!value) return
      if (seen.has(value)) return
      seen.add(value)
      next.push(value)
    }

    for (const item of files) {
      add(item.filePath)
      add(item.movePath)
    }

    return next
  }, [part.tool, part.state.metadata])

  const lineRange = useMemo(() => {
    if (part.tool !== "read") return undefined

    const output = part.state.output || ""
    const isCompleted = part.state.status === "completed"

    if (isCompleted) {
      if (output.includes("<type>directory</type>")) return undefined

      const contentMatch = output.match(/<content>\n?([\s\S]*?)\n?<\/content>/)
      if (contentMatch) {
        const lines = contentMatch[1].trim().split("\n")
        let firstLineMatch = null
        for (let i = 0; i < lines.length; i++) {
          const match = lines[i]?.match(/^(\d+):/)
          if (match) {
            firstLineMatch = match
            break
          }
        }
        let lastLineMatch = null
        for (let i = lines.length - 1; i >= 0; i--) {
          const match = lines[i]?.match(/^(\d+):/)
          if (match) {
            lastLineMatch = match
            break
          }
        }

        if (firstLineMatch && lastLineMatch) {
          return `(${firstLineMatch[1]}-${lastLineMatch[1]} 行)`
        }
      }
      return undefined
    }

    const offset = Number(part.state.input?.offset) || 1
    const limit = Number(part.state.input?.limit) || 2000
    return `(${offset}-${offset + limit - 1} 行)`
  }, [part.tool, part.state.input, part.state.output, part.state.status])

  const showOutput = part.state.status === "completed" && Boolean(part.state.output)
  const showWriteContent =
    part.tool === "write" && part.state.status === "completed" && Boolean(part.state.input?.content)
  const showDiff =
    (part.tool === "edit" || part.tool === "multiedit") &&
    part.state.status === "completed" &&
    Boolean(part.state.metadata?.diff)
  const showError = part.state.status === "error" && Boolean(part.state.error)

  // Header-only tools: no expand
  const isHeaderOnlyTool =
    part.tool === "read" ||
    part.tool === "glob" ||
    part.tool === "list" ||
    part.tool === "grep" ||
    part.tool === "webfetch"
  // edit/write/apply_patch: only show content, no generic output
  const isContentOnlyTool =
    part.tool === "edit" || part.tool === "multiedit" || part.tool === "write" || part.tool === "apply_patch"

  const onRespond = async (reply: "once" | "always" | "reject") => {
    if (!permission) return
    setIsResponding(reply)
    await respondPermission(permission.id, reply)
    setIsResponding(null)
  }

  const renderOutput = () => {
    // read/edit/write/apply_patch: skip generic output rendering
    if (isHeaderOnlyTool || isContentOnlyTool) return null

    // Bash tool: show output in real-time (running or completed)
    if (part.tool === "bash") {
      const bashOutput = String(part.state.metadata?.output || part.state.output || "")
      const command = part.state.input?.command as string | undefined
      if (bashOutput || command || part.state.status === "running") {
        return <BashTool command={command} output={bashOutput} />
      }
      return null
    }

    if (!showOutput) return null

    // Special rendering for todo tools
    if (part.tool === "todoread" || part.tool === "todowrite") {
      return <TodoTool output={part.state.output!} />
    }

    // Generic output for all other tools
    return <GenericOutput output={part.state.output!} />
  }

  // apply_patch: show patch content from current schema (patchText), fallback to legacy field (patch)
  const applyPatchContent =
    part.tool === "apply_patch"
      ? typeof part.state.input?.patchText === "string" && part.state.input.patchText.length > 0
        ? part.state.input.patchText
        : typeof part.state.input?.patch === "string" && part.state.input.patch.length > 0
          ? part.state.input.patch
          : ""
      : ""
  const showApplyPatchContent = part.tool === "apply_patch" && Boolean(applyPatchContent)

  const isExpandable = !isHeaderOnlyTool
  const shouldShowExpandedContent = isExpandable && isExpanded

  const subtaskSessionId = useMemo(() => {
    if (part.tool !== "task") return null
    const raw = (part.state.metadata as any)?.sessionId ?? (part.state.metadata as any)?.sessionID
    const value = typeof raw === "string" ? raw : raw ? String(raw) : ""
    return value.length > 0 ? value : null
  }, [part.tool, part.state.metadata])

  const subtaskTitle = useMemo(() => {
    if (part.tool !== "task") return null
    if (typeof part.state.title === "string" && part.state.title.length > 0) return part.state.title
    const desc = (part.state.input as any)?.description
    return typeof desc === "string" && desc.length > 0 ? desc : null
  }, [part.tool, part.state.title, part.state.input])

  const taskProgressName = useMemo(() => {
    if (part.tool !== "task") return null
    if (!subtaskSessionId) return null

    const toolParts = getMessagesBySession(subtaskSessionId)
      .flatMap((message) => message.parts)
      .filter((messagePart) => messagePart.type === "tool")

    const currentTool = [...toolParts]
      .reverse()
      .find((toolPart) => toolPart.state?.status === "running" || toolPart.state?.status === "pending")

    const currentLabel = currentTool
      ? getToolLabel(currentTool.tool)
      : part.state.status === "completed"
        ? "已完成"
        : "空闲"
    const toolName = getToolLabel(part.tool)
    const base = `${toolName}${subtaskTitle ? `：${subtaskTitle}` : ""}`
    return `${base} [ ${toolParts.length} 工具调用 / ${currentLabel} ]`
  }, [part.tool, part.state.status, subtaskSessionId, subtaskTitle, getMessagesBySession])

  const headerToolName = taskProgressName ?? toolName

  const rightActions = useMemo(() => {
    if (!subtaskSessionId) return undefined
    const parent = sessionID ? { sessionId: sessionID, messageId: messageID, partId: part.id } : null
    return (
      <IconButton
        size="sm"
        aria-label="查看子任务"
        title="查看子任务"
        onClick={() =>
          openSubtaskDrawer({
            sessionId: subtaskSessionId,
            title: subtaskTitle,
            parent,
          })
        }
        icon={
          <svg className="w-full h-full" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 7h8m-8 4h6m-6 4h8M6 21h12a2 2 0 002-2V5a2 2 0 00-2-2H6a2 2 0 00-2 2v14a2 2 0 002 2z"
            />
          </svg>
        }
      />
    )
  }, [subtaskSessionId, subtaskTitle, sessionID, messageID, part.id, openSubtaskDrawer])

  return (
    <div
      className={`my-0.5 border ${getBorderColor(part.state.status, Boolean(permission))} overflow-hidden bg-gray-50 dark:bg-gray-900`}
    >
      {/* Header */}
      <ToolHeader
        tool={part.tool}
        status={part.state.status}
        toolName={headerToolName}
        filePath={filePath}
        patchFilePaths={patchFilePaths}
        isExpanded={isExpanded}
        isExpandable={isExpandable}
        onToggle={() => open.toggle(part.id)}
        time={part.state.time}
        rightActions={rightActions}
        lineRange={lineRange}
      />

      {/* Expanded content */}
      {shouldShowExpandedContent && (
        <div className="border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950 break-words [overflow-wrap:anywhere]">
          {/* Permission banner */}
          {permission && <PermissionBanner permission={permission} isResponding={isResponding} onRespond={onRespond} />}

          {/* Output/Result (bash, todo, generic — not read/edit/write/apply_patch) */}
          {renderOutput()}

          {/* Content preview for write tool */}
          {showWriteContent && <WriteTool content={String(part.state.input?.content)} filePath={filePath!} />}

          {/* Diff view for edit tool */}
          {showDiff && <EditTool diff={String(part.state.metadata?.diff)} />}

          {/* apply_patch: show patch content as additions */}
          {showApplyPatchContent && <WriteTool content={applyPatchContent} filePath={filePath || ""} />}

          {/* Error */}
          {showError && <ErrorDisplay error={part.state.error!} />}
        </div>
      )}

      {/* read tool: only show error when present (no expand needed) */}
      {isHeaderOnlyTool && showError && (
        <div className="border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
          <ErrorDisplay error={part.state.error!} />
        </div>
      )}

      {/* Diff Modal */}
      {showDiffModal && associatedPatch && sessionID && messageID && (
        <DiffModal
          isOpen={showDiffModal}
          onClose={() => setShowDiffModal(false)}
          sessionID={sessionID}
          messageID={messageID}
          patchHash={associatedPatch.hash}
        />
      )}
    </div>
  )
}
