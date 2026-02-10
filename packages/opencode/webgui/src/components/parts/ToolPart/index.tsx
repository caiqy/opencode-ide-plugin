import { useState, useMemo } from "react"
import { DiffModal } from "../../DiffModal"
import { useMessages } from "../../../state/MessagesContext"
import { usePartOpen } from "../../MessageList/PartOpenContext"
import { ToolHeader } from "./ToolHeader"
import { PermissionBanner } from "./PermissionBanner"
import { BashTool } from "./BashTool"
import { WriteTool } from "./WriteTool"
import { EditTool } from "./EditTool"
import { TodoTool } from "./TodoTool"
import { GenericOutput } from "./GenericOutput"
import { ErrorDisplay } from "./ErrorDisplay"
import { getToolDisplayName, getBorderColor } from "./utils"

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

  const { getPermissionForCall, respondPermission } = useMessages()
  const permission = useMemo(() => {
    return sessionID ? getPermissionForCall(sessionID, part.callID) : undefined
  }, [getPermissionForCall, sessionID, part.callID])

  const toolName = getToolDisplayName(part.tool, part.state.input, part.state.title, part.state.output)
  const filePath = (part.state.input?.filePath as string | undefined) || undefined

  const showOutput = part.state.status === "completed" && Boolean(part.state.output)
  const showWriteContent =
    part.tool === "write" && part.state.status === "completed" && Boolean(part.state.input?.content)
  const showDiff =
    (part.tool === "edit" || part.tool === "multiedit") &&
    part.state.status === "completed" &&
    Boolean(part.state.metadata?.diff)
  const showError = part.state.status === "error" && Boolean(part.state.error)

  // read tool: no expand, header only
  const isReadTool = part.tool === "read"
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
    if (!showOutput) return null

    // read/edit/write/apply_patch: skip generic output rendering
    if (isReadTool || isContentOnlyTool) return null

    // Special rendering for bash tool with metadata.output
    if (part.tool === "bash" && Boolean(part.state.metadata?.output)) {
      return <BashTool output={String(part.state.metadata?.output)} />
    }

    // Special rendering for todo tools
    if (part.tool === "todoread" || part.tool === "todowrite") {
      return <TodoTool output={part.state.output!} />
    }

    // Generic output for all other tools
    return <GenericOutput output={part.state.output!} />
  }

  // apply_patch: extract content from input or output for display
  const showApplyPatchContent =
    part.tool === "apply_patch" && part.state.status === "completed" && Boolean(part.state.input?.patch)

  const isExpandable = !isReadTool
  const shouldShowExpandedContent = isExpandable && isExpanded

  return (
    <div
      className={`my-0.5 border ${getBorderColor(part.state.status, Boolean(permission))} overflow-hidden bg-gray-50 dark:bg-gray-900`}
    >
      {/* Header */}
      <ToolHeader
        tool={part.tool}
        status={part.state.status}
        toolName={toolName}
        filePath={filePath}
        isExpanded={isExpanded}
        isExpandable={isExpandable}
        onToggle={() => open.toggle(part.id)}
        time={part.state.time}
      />

      {/* Expanded content */}
      {shouldShowExpandedContent && (
        <div className="border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
          {/* Permission banner */}
          {permission && <PermissionBanner permission={permission} isResponding={isResponding} onRespond={onRespond} />}

          {/* Output/Result (bash, todo, generic — not read/edit/write/apply_patch) */}
          {renderOutput()}

          {/* Content preview for write tool */}
          {showWriteContent && <WriteTool content={String(part.state.input?.content)} filePath={filePath!} />}

          {/* Diff view for edit tool */}
          {showDiff && <EditTool diff={String(part.state.metadata?.diff)} />}

          {/* apply_patch: show patch content as additions */}
          {showApplyPatchContent && <WriteTool content={String(part.state.input?.patch)} filePath={filePath || ""} />}

          {/* Error */}
          {showError && <ErrorDisplay error={part.state.error!} />}
        </div>
      )}

      {/* read tool: only show error when present (no expand needed) */}
      {isReadTool && showError && (
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
