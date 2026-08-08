import { useEffect, useState, useMemo, useRef } from "react"
import type { TaskResultParsed } from "../../../types/messages"
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
import { TaskTool } from "./TaskTool"
import { QuestionTool } from "./QuestionTool"
import { ToolImageAttachments } from "./ToolImageAttachments"
import { getToolDisplayName, getBorderColor, getSubtaskStatusLabel, getToolLabel } from "./utils"
import { parseTaskResult } from "../../../lib/task-result"
import { isStreamableTool, usePartialToolInput } from "./usePartialToolInput"
import { countLines } from "../../../lib/partial-tool-input"
import type { QuestionInfo } from "@opencode-ai/sdk/v2/client"

interface ToolPartProps {
  part: {
    id: string
    type: "tool"
    callID: string
    tool: string
    state: {
      status: "pending" | "running" | "completed" | "error"
      input?: Record<string, unknown>
      raw?: string
      output?: string
      title?: string
      error?: string
      attachments?: Array<{
        id?: string
        type?: "file"
        mime?: string
        filename?: string
        url?: string
      }>
      metadata?: Record<string, unknown>
      time?: {
        start: number
        end?: number
      }
    }
    parsed?: {
      task_result?: TaskResultParsed
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
  interrupted?: boolean
}

export function ToolPart({ part, sessionID, messageID, associatedPatch, interrupted }: ToolPartProps) {
  const [showDiffModal, setShowDiffModal] = useState(false)
  const [isResponding, setIsResponding] = useState<"once" | "always" | "reject" | null>(null)
  const autoExpandedRef = useRef<string | null>(null)
  const interruptedClosedRef = useRef<string | null>(null)

  const open = usePartOpen()
  const isExpanded = open.isOpen(part.id)

  const { openSubtaskDrawer } = useSubtaskDrawer()

  const {
    getPermissionForCall,
    getMessagesBySession,
    ensureSession,
    respondPermission,
    permissions,
    getQuestionsBySession,
  } = useMessages()
  const partialInput = usePartialToolInput(part.tool, part.state.status, part.state.raw)
  const displayInput = (partialInput ?? part.state.input ?? {}) as Record<string, unknown>
  const wasInterrupted = Boolean(interrupted && (part.state.status === "pending" || part.state.status === "running"))
  const permission = useMemo(() => {
    return sessionID ? getPermissionForCall(sessionID, part.callID) : undefined
  }, [getPermissionForCall, sessionID, part.callID])
  const displayPermission = wasInterrupted ? undefined : permission

  const toolName = getToolDisplayName(part.tool, part.state.input, part.state.title, part.state.output)
  const filePath = typeof displayInput.filePath === "string" ? displayInput.filePath : undefined
  const writeContent = typeof displayInput.content === "string" ? displayInput.content : ""
  const editNewString = typeof displayInput.newString === "string" ? displayInput.newString : ""
  const patchFilePaths = useMemo(() => {
    if (part.tool !== "apply_patch") return [] as string[]
    const files = (
      part.state.metadata as
        | {
            files?: Array<{ filePath?: string; movePath?: string }>
          }
        | undefined
    )?.files
    const seen = new Set<string>()
    const next: string[] = []
    const add = (value?: string) => {
      if (!value) return
      if (seen.has(value)) return
      seen.add(value)
      next.push(value)
    }

    for (const item of files ?? []) {
      add(item.filePath)
      add(item.movePath)
    }

    const patchText = partialInput?.patchText ?? partialInput?.patch
    if (typeof patchText === "string") {
      patchText
        .split("\n")
        .map(
          (line) =>
            line.match(/^\*\*\*\s+(?:Add|Update|Delete) File:\s+(.+?)\s*$/)?.[1] ??
            line.match(/^\*\*\*\s+Move to:\s+(.+?)\s*$/)?.[1],
        )
        .filter((path): path is string => Boolean(path))
        .forEach(add)
    }

    return next
  }, [part.tool, part.state.metadata, partialInput])

  const lineRange = useMemo(() => {
    if (part.tool !== "read") return undefined

    const output = part.state.output || ""
    const isCompleted = part.state.status === "completed"

    if (isCompleted) {
      const type = output.match(/<type>\s*([^<]+?)\s*<\/type>/)?.[1]
      if (type === "directory") return undefined

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

  const streamingLineCount = useMemo(() => {
    if (!partialInput) return undefined
    if (part.tool === "write") return countLines(partialInput.content)
    if (part.tool === "edit") return countLines(partialInput.newString)
    if (part.tool === "apply_patch") return countLines(partialInput.patchText ?? partialInput.patch)
    return undefined
  }, [partialInput, part.tool])

  const showOutput = part.state.status === "completed" && Boolean(part.state.output)
  const showWriteContent =
    part.tool === "write" && (part.state.status === "completed" || partialInput !== null) && writeContent.length > 0
  const showDiff = part.tool === "edit" && part.state.status === "completed" && Boolean(part.state.metadata?.diff)
  const showEditPartial = part.tool === "edit" && partialInput !== null && editNewString.length > 0
  const showError = part.state.status === "error" && Boolean(part.state.error)

  const questionInput = useMemo(() => {
    if (part.tool !== "question") return [] as QuestionInfo[]
    const raw = part.state.input?.questions
    return Array.isArray(raw) ? (raw as QuestionInfo[]) : ([] as QuestionInfo[])
  }, [part.tool, part.state.input])

  const questionAnswers = useMemo(() => {
    if (part.tool !== "question") return [] as string[][]
    const raw = part.state.metadata?.answers
    return Array.isArray(raw) ? (raw as string[][]) : ([] as string[][])
  }, [part.tool, part.state.metadata])

  const questionDismissed = useMemo(() => {
    return part.tool === "question" && part.state.status === "error" && /dismissed/i.test(part.state.error ?? "")
  }, [part.tool, part.state.status, part.state.error])

  const questionMode = useMemo(() => {
    if (part.tool !== "question") return null
    if (!questionInput.length) return null
    if (part.state.status === "completed") return "completed" as const
    if (questionDismissed) return "ignored" as const
    if (wasInterrupted) return "interrupted" as const
    return null
  }, [part.tool, part.state.status, questionDismissed, questionInput.length, wasInterrupted])
  const answeredQuestionCount = useMemo(() => {
    return questionAnswers.filter((answer) => Array.isArray(answer) && answer.length > 0).length
  }, [questionAnswers])

  const questionHeading = useMemo(() => {
    if (!questionMode) return null
    if (questionMode === "ignored")
      return `${getToolLabel("question")}：已忽略 ${answeredQuestionCount}/${questionInput.length}`
    if (questionMode === "interrupted")
      return `${getToolLabel("question")}：已中断 ${answeredQuestionCount}/${questionInput.length}`
    return `${getToolLabel("question")}：已完成 ${answeredQuestionCount}/${questionInput.length}`
  }, [questionMode, answeredQuestionCount, questionInput.length])

  const questionToolContent = useMemo(() => {
    if (!questionMode) return null
    return <QuestionTool questions={questionInput} answers={questionAnswers} mode={questionMode} />
  }, [questionMode, questionInput, questionAnswers])

  // Header-only tools: no expand
  const isHeaderOnlyTool =
    part.tool === "read" ||
    part.tool === "glob" ||
    part.tool === "list" ||
    part.tool === "grep" ||
    part.tool === "webfetch"
  // edit/write/apply_patch: only show content, no generic output
  const isContentOnlyTool = part.tool === "edit" || part.tool === "write" || part.tool === "apply_patch"

  const onRespond = async (reply: "once" | "always" | "reject") => {
    if (!displayPermission) return
    setIsResponding(reply)
    await respondPermission(displayPermission.id, reply)
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

    if (part.tool === "task" || part.tool === "question") return null

    // Generic output for all other tools
    return <GenericOutput output={part.state.output!} />
  }

  const parsed =
    part.tool === "task" && part.state.status === "completed"
      ? (part.parsed?.task_result ?? parseTaskResult(typeof part.state.output === "string" ? part.state.output : ""))
      : null

  const task = parsed
    ? {
        empty: parsed.hasContent !== true,
        text: parsed.text,
      }
    : null

  // apply_patch: show patch content from current schema (patchText), fallback to legacy field (patch)
  const applyPatchContent =
    part.tool === "apply_patch"
      ? typeof displayInput.patchText === "string" && displayInput.patchText.length > 0
        ? displayInput.patchText
        : typeof displayInput.patch === "string" && displayInput.patch.length > 0
          ? displayInput.patch
          : ""
      : ""
  const showApplyPatchContent =
    part.tool === "apply_patch" &&
    (part.state.status === "completed" || partialInput !== null) &&
    Boolean(displayInput.patchText || displayInput.patch)

  const isQuestionStatic = Boolean(questionMode)
  const isExpandable = !isHeaderOnlyTool && !isQuestionStatic
  const shouldShowExpandedContent = isQuestionStatic || (isExpandable && isExpanded)
  const showPermission = Boolean(displayPermission)
  const expandedBorder = showPermission ? "" : "border-t border-gray-200 dark:border-gray-800"

  const subtaskSessionId = useMemo(() => {
    if (part.tool !== "task") return null
    const raw = part.state.metadata?.sessionId ?? part.state.metadata?.sessionID
    const value = typeof raw === "string" ? raw : raw ? String(raw) : ""
    return value.length > 0 ? value : null
  }, [part.tool, part.state.metadata])

  const blocked = (() => {
    if (!subtaskSessionId) return null
    if (permissions.some((p) => p.sessionID === subtaskSessionId)) return "permission" as const
    if (getQuestionsBySession(subtaskSessionId).length > 0) return "question" as const
    return null
  })()
  const displayBlocked = wasInterrupted ? null : blocked

  const subtaskTitle = useMemo(() => {
    if (part.tool !== "task") return null
    if (typeof part.state.title === "string" && part.state.title.length > 0) return part.state.title
    const desc = part.state.input?.description
    return typeof desc === "string" && desc.length > 0 ? desc : null
  }, [part.tool, part.state.title, part.state.input])

  const subagentType = useMemo(() => {
    if (part.tool !== "task") return null
    const raw = part.state.input?.subagent_type
    return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null
  }, [part.tool, part.state.input])

  useEffect(() => {
    if (!subtaskSessionId) return
    void ensureSession(subtaskSessionId)
  }, [subtaskSessionId, ensureSession])

  useEffect(() => {
    if (wasInterrupted) {
      autoExpandedRef.current = null
      if (interruptedClosedRef.current === part.id) return
      interruptedClosedRef.current = part.id
      open.setOpen(part.id, false)
      return
    }
    interruptedClosedRef.current = null

    // Only active pending tools auto-expand; interruption closes once and preserves later manual expansion.
    if (part.state.status !== "pending") {
      autoExpandedRef.current = null
      return
    }
    if (autoExpandedRef.current === part.id) return
    if (!isStreamableTool(part.tool)) return
    autoExpandedRef.current = part.id
    if (!open.isOpen(part.id)) open.setOpen(part.id, true)
  }, [part.state.status, part.tool, part.id, open, wasInterrupted])

  const progress = (() => {
    if (wasInterrupted) return null
    if (part.tool !== "task") return null
    if (!subtaskSessionId) return null

    const label = getToolLabel(part.tool)
    const agentTag = subagentType ? ` (${subagentType})` : ""
    const base = `${label}${agentTag}${subtaskTitle ? `：${subtaskTitle}` : ""}`

    if (displayBlocked === "permission") return `${base} [ ⚠ 等待授权 — 点击查看 ]`
    if (displayBlocked === "question") return `${base} [ ❓ 等待回答 — 点击查看 ]`

    const toolParts = getMessagesBySession(subtaskSessionId)
      .flatMap((message) => message.parts)
      .filter((messagePart) => messagePart.type === "tool")

    const currentTool = [...toolParts]
      .reverse()
      .find((toolPart) => toolPart.state?.status === "running" || toolPart.state?.status === "pending")

    const currentLabel = getSubtaskStatusLabel({
      currentToolLabel: currentTool ? getToolLabel(currentTool.tool) : null,
      isParentCompleted: part.state.status === "completed",
    })
    return `${base} [ ${toolParts.length} 工具调用 / ${currentLabel} ]`
  })()

  const heading = questionHeading ?? progress ?? toolName
  const displayStatus = wasInterrupted ? "error" : questionMode === "ignored" ? "completed" : part.state.status

  const drawerParent = useMemo(
    () => (sessionID ? { sessionId: sessionID, messageId: messageID, partId: part.id } : null),
    [sessionID, messageID, part.id],
  )

  const handleBlockedClick = useMemo(() => {
    if (!displayBlocked || !subtaskSessionId) return undefined
    return () =>
      openSubtaskDrawer({
        sessionId: subtaskSessionId,
        title: subtaskTitle,
        subagentType,
        parent: drawerParent,
      })
  }, [displayBlocked, subtaskSessionId, subtaskTitle, subagentType, drawerParent, openSubtaskDrawer])

  const rightActions = useMemo(() => {
    if (!subtaskSessionId) return undefined
    return (
      <IconButton
        size="sm"
        aria-label="查看子任务"
        title="查看子任务"
        onClick={() =>
          openSubtaskDrawer({
            sessionId: subtaskSessionId,
            title: subtaskTitle,
            subagentType,
            parent: drawerParent,
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
  }, [subtaskSessionId, subtaskTitle, subagentType, drawerParent, openSubtaskDrawer])

  return (
    <div
      className={`rounded-lg border ${getBorderColor(displayStatus, Boolean(displayPermission), displayBlocked)} overflow-hidden bg-gray-50 dark:bg-gray-900`}
    >
      {/* Header */}
      <ToolHeader
        tool={part.tool}
        status={displayStatus}
        toolName={heading}
        filePath={filePath}
        patchFilePaths={patchFilePaths}
        isExpanded={isExpanded}
        isExpandable={isExpandable}
        onToggle={() => open.toggle(part.id)}
        time={part.state.time}
        rightActions={rightActions}
        lineRange={streamingLineCount ? `(已接收 ${streamingLineCount} 行)` : lineRange}
        blocked={displayBlocked}
        onBlockedClick={handleBlockedClick}
        interrupted={wasInterrupted}
      />

      {/* Permission banner */}
      {displayPermission && (
        <div className="border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
          <PermissionBanner permission={displayPermission} isResponding={isResponding} onRespond={onRespond} />
        </div>
      )}

      {/* Expanded content */}
      {shouldShowExpandedContent && (
        <div className={`${expandedBorder} bg-gray-50 dark:bg-gray-950 break-words [overflow-wrap:anywhere]`}>
          {questionToolContent}
          {task ? <TaskTool text={task.text} empty={task.empty} /> : null}

          {/* Output/Result (bash, todo, generic — not read/edit/write/apply_patch) */}
          {renderOutput()}

          {/* Content preview for write tool */}
          {showWriteContent && <WriteTool content={writeContent} />}

          {/* Diff view for edit tool */}
          {showDiff && <EditTool diff={String(part.state.metadata?.diff)} />}

          {showEditPartial && <WriteTool content={editNewString} />}

          {/* apply_patch: show patch content as additions */}
          {showApplyPatchContent && <WriteTool content={applyPatchContent} />}

          {/* Expandable tools keep attachments inside the collapsible content. */}
          {part.state.status === "completed" && !isHeaderOnlyTool ? (
            <ToolImageAttachments attachments={part.state.attachments} />
          ) : null}

          {/* Error */}
          {showError && !questionMode ? <ErrorDisplay error={part.state.error!} /> : null}
        </div>
      )}

      {/* Header-only tools have no expand area, so attachments render directly below the header. */}
      {isHeaderOnlyTool && part.state.status === "completed" ? (
        <ToolImageAttachments attachments={part.state.attachments} />
      ) : null}

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
