import { useState, useMemo, useEffect, useRef } from "react"
import { DiffModal } from "../../DiffModal"
import { useMessages } from "../../../state/MessagesContext"
import { usePartOpen } from "../../MessageList/PartOpenContext"
import { ToolHeader } from "./ToolHeader"
import { PermissionBanner } from "./PermissionBanner"
import { BashTool } from "./BashTool"
import { ReadTool } from "./ReadTool"
import { WriteTool } from "./WriteTool"
import { EditTool } from "./EditTool"
import { TodoTool } from "./TodoTool"
import { GenericOutput } from "./GenericOutput"
import { PatchInfo } from "./PatchInfo"
import { ToolDetails } from "./ToolDetails"
import { ErrorDisplay } from "./ErrorDisplay"
import { TimingInfo } from "./TimingInfo"
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
  const isExpanded = open.open?.type === "tool" && open.open.id === part.id

  const { getPermissionForCall, respondPermission } = useMessages()
  const permission = useMemo(() => {
    return sessionID ? getPermissionForCall(sessionID, part.callID) : undefined
  }, [getPermissionForCall, sessionID, part.callID])

  const lastPermissionID = useRef<string | null>(null)
  useEffect(() => {
    if (permission && permission.id !== lastPermissionID.current) {
      lastPermissionID.current = permission.id
      open.openManual({ type: "tool", id: part.id })
    }
  }, [permission, open, part.id])

  const toolName = getToolDisplayName(part.tool, part.state.input, part.state.title, part.state.output)
  const filePath = (part.state.input?.filePath as string | undefined) || undefined

  const showOutput = part.state.status === "completed" && Boolean(part.state.output)
  const showWriteContent =
    part.tool === "write" && part.state.status === "completed" && Boolean(part.state.input?.content)
  const showDiff = part.tool === "edit" && part.state.status === "completed" && Boolean(part.state.metadata?.diff)
  const showError = part.state.status === "error" && Boolean(part.state.error)

  const onRespond = async (reply: "once" | "always" | "reject") => {
    if (!permission) return
    setIsResponding(reply)
    await respondPermission(permission.id, reply)
    setIsResponding(null)
    if (open.open?.type === "tool" && open.open.id === part.id) {
      open.openManual(null)
    }
  }

  const renderOutput = () => {
    if (!showOutput) return null

    // Special rendering for bash tool with metadata.output
    if (part.tool === "bash" && Boolean(part.state.metadata?.output)) {
      return <BashTool output={String(part.state.metadata?.output)} />
    }

    // Special rendering for read tool with metadata.preview
    if (part.tool === "read" && Boolean(part.state.metadata?.preview) && filePath) {
      return <ReadTool preview={String(part.state.metadata?.preview)} filePath={filePath} />
    }

    // Special rendering for todo tools
    if (part.tool === "todoread" || part.tool === "todowrite") {
      return <TodoTool output={part.state.output!} />
    }

    // Generic output for all other tools
    return <GenericOutput output={part.state.output!} />
  }

  return (
    <div
      className={`my-0.5 border rounded-lg ${getBorderColor(part.state.status, Boolean(permission))} overflow-hidden bg-[#fbfdff] dark:bg-gray-900`}
    >
      {/* Header */}
      <ToolHeader
        tool={part.tool}
        status={part.state.status}
        toolName={toolName}
        filePath={filePath}
        isExpanded={isExpanded}
        onToggle={() => {
          if (isExpanded) {
            open.openManual(null)
            return
          }
          open.openManual({ type: "tool", id: part.id })
        }}
      />

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-[#e4e9f2] dark:border-gray-800 bg-[#fbfdff] dark:bg-gray-950">
          {/* Permission banner */}
          {permission && <PermissionBanner permission={permission} isResponding={isResponding} onRespond={onRespond} />}

          {/* Output/Result */}
          {renderOutput()}

          {/* Content preview for write tool */}
          {showWriteContent && <WriteTool content={String(part.state.input?.content)} filePath={filePath!} />}

          {/* Diff view for edit tool */}
          {showDiff && <EditTool diff={String(part.state.metadata?.diff)} />}

          {/* Associated Patch (for write/edit tools) */}
          {associatedPatch && (part.tool === "write" || part.tool === "edit") && sessionID && messageID && (
            <PatchInfo
              patch={associatedPatch}
              sessionID={sessionID}
              messageID={messageID}
              onViewDiff={() => setShowDiffModal(true)}
            />
          )}

          {/* Error */}
          {showError && <ErrorDisplay error={part.state.error!} />}

          {/* Details toggle (Input + Metadata) */}
          <ToolDetails input={part.state.input} metadata={part.state.metadata} />

          {/* Timing */}
          {part.state.time && <TimingInfo time={part.state.time} />}
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
