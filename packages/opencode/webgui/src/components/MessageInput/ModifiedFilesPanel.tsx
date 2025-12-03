import { useState, useMemo, useCallback, type KeyboardEvent } from "react"
import { useMessages } from "../../state/MessagesContext"
import { useOpenFile } from "../../hooks/useOpenFile"

interface ModifiedFilesPanelProps {
  sessionID: string | null
}

export function ModifiedFilesPanel({ sessionID }: ModifiedFilesPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const { getMessagesBySession } = useMessages()
  const openFile = useOpenFile()

  const modifiedFiles = useMemo(() => {
    if (!sessionID) return []
    const messages = getMessagesBySession(sessionID)
    const files: string[] = []
    const seen = new Set<string>()

    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type !== "tool") continue
        const toolPart = part as { tool?: string; state?: { input?: { filePath?: string } } }
        if (toolPart.tool !== "write" && toolPart.tool !== "edit") continue
        const path = toolPart.state?.input?.filePath
        if (path && !seen.has(path)) {
          seen.add(path)
          files.push(path)
        }
      }
    }
    return files
  }, [sessionID, getMessagesBySession])

  const handleFileClick = useCallback(
    (path: string) => {
      openFile({ path })
    },
    [openFile],
  )

  const handleKeyDown = useCallback(
    (path: string) => (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        handleFileClick(path)
      }
    },
    [handleFileClick],
  )

  if (modifiedFiles.length === 0) return null

  return (
    <div className="px-2 py-1 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50">
      <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-gray-200"
        >
          <svg
            className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span>{modifiedFiles.length} file{modifiedFiles.length !== 1 ? "s" : ""} changed</span>
        </button>
      </div>
      {expanded && (
        <div className="mt-1 flex flex-wrap gap-1">
          {modifiedFiles.map((path) => (
            <span
              key={path}
              role="button"
              tabIndex={0}
              onClick={() => handleFileClick(path)}
              onKeyDown={handleKeyDown(path)}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-mono bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-900/60"
              title={path}
            >
              {path.split("/").pop()}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
