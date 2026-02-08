import { useCallback } from "react"
import { useOpenFile } from "../../../hooks/useOpenFile"
import { useProject } from "../../../state/ProjectContext"
import { toDisplayPath } from "../../../utils/path"
import { getStatusIcon, getStatusClasses } from "./utils"

interface ToolHeaderProps {
  tool: string
  status: "pending" | "running" | "completed" | "error"
  toolName: string
  filePath?: string
  isExpanded: boolean
  onToggle: () => void
}

export function ToolHeader({ tool, status, toolName, filePath, isExpanded, onToggle }: ToolHeaderProps) {
  const openFile = useOpenFile()
  const { worktree } = useProject()
  const displayPath = filePath ? toDisplayPath(filePath, worktree) : ""

  const handleOpenPath = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!filePath) return
      openFile({ path: filePath, display: displayPath || filePath })
    },
    [filePath, displayPath, openFile],
  )

  const handlePathKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        handleOpenPath(e)
      }
    },
    [handleOpenPath],
  )

  const showFileLink = filePath && (tool === "read" || tool === "write" || tool === "edit" || tool === "multiedit")

  return (
    <button
      onClick={onToggle}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${getStatusClasses(status)} hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors`}
    >
      {getStatusIcon(status)}
      {showFileLink ? (
        <span className="text-xs font-medium flex-1">
          {`${tool}: `}
          <span
            role="button"
            tabIndex={0}
            onClick={handleOpenPath}
            onKeyDown={handlePathKeyDown}
            className="underline decoration-dotted cursor-pointer hover:opacity-80"
            title={displayPath || filePath}
            data-tip={displayPath || filePath}
          >
            {displayPath || filePath}
          </span>
        </span>
      ) : (
        <span className="text-xs font-medium flex-1">{toolName}</span>
      )}
      <svg
        viewBox="0 0 24 24"
        className={`w-3 h-3 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 5l7 7-7 7" />
      </svg>
    </button>
  )
}
