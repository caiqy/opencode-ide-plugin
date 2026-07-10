import { useCallback } from "react"
import type { ReactNode } from "react"
import { useOpenFile } from "../../../hooks/useOpenFile"
import { useProject } from "../../../state/ProjectContext"
import { toDisplayPath } from "../../../utils/path"
import { getStatusIcon, getStatusClasses, getBlockedIcon, getBlockedClasses, getToolLabel } from "./utils"

interface ToolHeaderProps {
  tool: string
  status: "pending" | "running" | "completed" | "error"
  toolName: string
  filePath?: string
  patchFilePaths?: string[]
  isExpanded: boolean
  isExpandable?: boolean
  onToggle: () => void
  time?: { start: number; end?: number }
  rightActions?: ReactNode
  lineRange?: string
  blocked?: "permission" | "question" | null
  onBlockedClick?: () => void
}

function getFileName(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

export function ToolHeader({
  tool,
  status,
  toolName,
  filePath,
  patchFilePaths = [],
  isExpanded,
  isExpandable = true,
  onToggle,
  time,
  rightActions,
  lineRange,
  blocked = null,
  onBlockedClick,
}: ToolHeaderProps) {
  const openFile = useOpenFile()
  const { worktree } = useProject()
  const displayPath = filePath ? toDisplayPath(filePath, worktree) : ""
  const toolLabel = getToolLabel(tool)

  const normalizedPatchPaths = patchFilePaths.filter((path, index, list) => !!path && list.indexOf(path) === index)

  const resolveDisplayPath = useCallback(
    (path: string) => {
      const normalized = toDisplayPath(path, worktree)
      return normalized || path
    },
    [worktree],
  )

  const handleOpenPath = useCallback(
    (path: string, e: React.MouseEvent | React.KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!path) return
      openFile({ path, display: resolveDisplayPath(path) })
    },
    [openFile, resolveDisplayPath],
  )

  const handlePathKeyDown = useCallback(
    (path: string, e: React.KeyboardEvent<HTMLSpanElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        handleOpenPath(path, e)
      }
    },
    [handleOpenPath],
  )

  const showFileLink = filePath && (tool === "read" || tool === "write" || tool === "edit")
  const showPatchFileLinks = tool === "apply_patch" && normalizedPatchPaths.length > 0
  const fileName = filePath ? getFileName(filePath) : ""

  const durationText = time?.end && time.start ? `${((time.end - time.start) / 1000).toFixed(1)}s` : undefined

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isExpandable) return
      if (e.key !== "Enter" && e.key !== " ") return
      e.preventDefault()
      if (blocked && onBlockedClick) return onBlockedClick()
      onToggle()
    },
    [isExpandable, onToggle, blocked, onBlockedClick],
  )

  return (
    <div
      role={isExpandable ? "button" : undefined}
      tabIndex={isExpandable ? 0 : undefined}
      onKeyDown={onKeyDown}
      onClick={blocked && onBlockedClick ? onBlockedClick : isExpandable ? onToggle : undefined}
      title={tool}
      data-tip={tool}
      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${blocked ? getBlockedClasses(blocked) : getStatusClasses(status)} ${isExpandable ? "hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer" : ""} transition-colors`}
    >
      {blocked ? getBlockedIcon(blocked) : getStatusIcon(status)}
      {showFileLink || showPatchFileLinks ? (
        <span className="text-xs font-medium flex-1 min-w-0 truncate">
          {`${toolLabel}：`}
          {showFileLink && filePath ? (
            <>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => handleOpenPath(filePath, e)}
                onKeyDown={(e) => handlePathKeyDown(filePath, e)}
                className="underline underline-offset-[3px] decoration-solid cursor-pointer hover:opacity-80"
                title={displayPath || filePath}
                data-tip={displayPath || filePath}
              >
                {fileName}
              </span>
              {lineRange && <span className="text-gray-500 dark:text-gray-400 ml-1.5 font-normal">{lineRange}</span>}
            </>
          ) : null}
          {showPatchFileLinks
            ? normalizedPatchPaths.map((path, index) => (
                <span key={path}>
                  {index > 0 ? <span>, </span> : null}
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => handleOpenPath(path, e)}
                    onKeyDown={(e) => handlePathKeyDown(path, e)}
                    className="underline underline-offset-[3px] decoration-solid cursor-pointer hover:opacity-80"
                    title={resolveDisplayPath(path)}
                    data-tip={resolveDisplayPath(path)}
                  >
                    {getFileName(path)}
                  </span>
                </span>
              ))
            : null}
          {showPatchFileLinks && lineRange ? (
            <span className="text-gray-500 dark:text-gray-400 ml-1.5 font-normal">{lineRange}</span>
          ) : null}
        </span>
      ) : (
        <span className="text-xs font-medium flex-1 min-w-0 truncate">
          {toolName}
          {lineRange && <span className="text-gray-500 dark:text-gray-400 ml-1.5 font-normal">{lineRange}</span>}
        </span>
      )}
      {durationText && (
        <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0">{durationText}</span>
      )}

      {rightActions && (
        <div className="flex-shrink-0" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          {rightActions}
        </div>
      )}

      {isExpandable && (
        <svg
          viewBox="0 0 24 24"
          className={`w-3 h-3 flex-shrink-0 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          onClick={
            blocked
              ? (e) => {
                  e.stopPropagation()
                  onToggle()
                }
              : undefined
          }
        >
          <path d="M9 5l7 7-7 7" />
        </svg>
      )}
    </div>
  )
}
