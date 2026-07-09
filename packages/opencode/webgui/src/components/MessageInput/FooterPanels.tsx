import { useState, useMemo, useCallback } from "react"
import { useMessages } from "../../state/MessagesContext"
import { useSession } from "../../state/SessionContext"
import { TodosList } from "./TodosPanel"
import { FileChangesPanel } from "../FileChangesPanel"
import { useMergedFileDiffs } from "../../hooks/useMergedFileDiffs"

interface FooterPanelsProps {
  sessionID: string | null
}

export function FooterPanels({ sessionID }: FooterPanelsProps) {
  const [expanded, setExpanded] = useState<Record<string, { todos: boolean; files: boolean }>>({})
  const { getMessagesBySession } = useMessages()
  const { sessionDiff, sessionDiffStatus } = useSession()

  const state = sessionID ? (expanded[sessionID] ?? { todos: false, files: false }) : { todos: false, files: false }
  const todosExpanded = state.todos
  const filesExpanded = state.files

  const toggleFiles = useCallback(() => {
    if (!sessionID) return
    setExpanded((prev) => {
      const current = prev[sessionID] ?? { todos: false, files: false }
      const nextFiles = !current.files
      return {
        ...prev,
        [sessionID]: {
          ...current,
          files: nextFiles,
          todos: nextFiles ? false : current.todos,
        },
      }
    })
  }, [sessionID])

  const toggleTodos = useCallback(() => {
    if (!sessionID) return
    setExpanded((prev) => {
      const current = prev[sessionID] ?? { todos: false, files: false }
      const nextTodos = !current.todos
      return {
        ...prev,
        [sessionID]: {
          ...current,
          todos: nextTodos,
          files: nextTodos ? false : current.files,
        },
      }
    })
  }, [sessionID])

  const { todos, modifiedFiles } = useMemo(() => {
    if (!sessionID) return { todos: null, modifiedFiles: [] as string[] }
    const messages = getMessagesBySession(sessionID)
    let todoOutput: string | null = null
    const files: string[] = []
    const seen = new Set<string>()

    const addFile = (value: string | undefined) => {
      if (!value) return
      if (seen.has(value)) return
      seen.add(value)
      files.push(value)
    }

    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type !== "tool") continue
        const toolPart = part as {
          tool?: string
          state?: {
            input?: { filePath?: string }
            output?: string
            metadata?: { files?: Array<{ filePath?: string; movePath?: string }> }
          }
        }
        if (toolPart.tool === "todowrite" && toolPart.state?.output) {
          todoOutput = toolPart.state.output
        }

        if (toolPart.tool === "write" || toolPart.tool === "edit") {
          addFile(toolPart.state?.input?.filePath)
        }

        if (toolPart.tool === "apply_patch") {
          const patched = toolPart.state?.metadata?.files
          if (Array.isArray(patched)) {
            for (const entry of patched) {
              addFile(entry.filePath)
              addFile(entry.movePath)
            }
          }
        }
      }
    }

    let todos = null
    if (todoOutput) {
      try {
        const parsed = JSON.parse(todoOutput)
        if (Array.isArray(parsed)) todos = parsed
      } catch {}
    }

    return { todos, modifiedFiles: files }
  }, [sessionID, getMessagesBySession])

  const diffs = sessionID ? sessionDiff[sessionID] : undefined
  const diffStatus = sessionID ? sessionDiffStatus[sessionID] : undefined
  const mergedDiffs = useMergedFileDiffs(diffs, modifiedFiles)
  const hasTodos = todos && todos.length > 0
  const hasFiles = mergedDiffs.length > 0

  if (!hasTodos && !hasFiles) return null

  const completedTodos = todos?.filter((t: any) => t.status === "completed").length ?? 0
  const fileCount = mergedDiffs.length

  return (
    <div className="px-2 py-1 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 flex flex-col gap-1">
      {/* Expanded content - Files */}
      {filesExpanded && hasFiles && (
        <FileChangesPanel diffs={diffs} fallbackFiles={modifiedFiles} status={diffStatus} />
      )}

      {/* Expanded content - TODOs */}
      {todosExpanded && hasTodos && <TodosList todos={todos} />}

      {/* Labels row */}
      <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-200">
        {hasFiles && (
          <button
            onClick={toggleFiles}
            className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-gray-200"
          >
            <svg
              className={`w-3 h-3 transition-transform ${filesExpanded ? "-rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span>{fileCount} 个文件变更</span>
          </button>
        )}
        {hasTodos && (
          <button
            onClick={toggleTodos}
            className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-gray-200"
          >
            <svg
              className={`w-3 h-3 transition-transform ${todosExpanded ? "-rotate-90" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span>
              {completedTodos}/{todos.length} 任务列表
            </span>
          </button>
        )}
      </div>
    </div>
  )
}
