import { useState, useMemo } from "react"
import { useMessages } from "../../state/MessagesContext"
import { useSession } from "../../state/SessionContext"
import { TodosList } from "./TodosPanel"
import { FileChangesPanel } from "../FileChangesPanel"

interface FooterPanelsProps {
  sessionID: string | null
}

export function FooterPanels({ sessionID }: FooterPanelsProps) {
  const [todosExpanded, setTodosExpanded] = useState(false)
  const [filesExpanded, setFilesExpanded] = useState(false)
  const { getMessagesBySession } = useMessages()
  const { sessionDiff } = useSession()

  const { todos, modifiedFiles } = useMemo(() => {
    if (!sessionID) return { todos: null, modifiedFiles: [] as string[] }
    const messages = getMessagesBySession(sessionID)
    let todoOutput: string | null = null
    const files: string[] = []
    const seen = new Set<string>()

    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type !== "tool") continue
        const toolPart = part as { tool?: string; state?: { input?: { filePath?: string }; output?: string } }
        if (toolPart.tool === "todowrite" && toolPart.state?.output) {
          todoOutput = toolPart.state.output
        }
        if ((toolPart.tool === "write" || toolPart.tool === "edit") && toolPart.state?.input?.filePath) {
          const path = toolPart.state.input.filePath
          if (!seen.has(path)) {
            seen.add(path)
            files.push(path)
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
  const hasTodos = todos && todos.length > 0
  const hasFiles = (diffs && diffs.length > 0) || modifiedFiles.length > 0

  if (!hasTodos && !hasFiles) return null

  const completedTodos = todos?.filter((t: any) => t.status === "completed").length ?? 0
  const fileCount = diffs?.length ?? modifiedFiles.length

  return (
    <div className="px-2 py-1 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 flex flex-col gap-1">
      {/* Expanded content - Files */}
      {filesExpanded && hasFiles && (
        <FileChangesPanel diffs={diffs} fallbackFiles={modifiedFiles} />
      )}

      {/* Expanded content - TODOs */}
      {todosExpanded && hasTodos && <TodosList todos={todos} />}

      {/* Labels row */}
      <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-400">
        {hasFiles && (
          <button
            onClick={() => setFilesExpanded(!filesExpanded)}
            className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-gray-200"
          >
            <svg className={`w-3 h-3 transition-transform ${filesExpanded ? "-rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span>{fileCount} file{fileCount !== 1 ? "s" : ""} changed</span>
          </button>
        )}
        {hasTodos && (
          <button
            onClick={() => setTodosExpanded(!todosExpanded)}
            className="flex items-center gap-1 hover:text-gray-900 dark:hover:text-gray-200"
          >
            <svg className={`w-3 h-3 transition-transform ${todosExpanded ? "-rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span>{completedTodos}/{todos.length} TODOs</span>
          </button>
        )}
      </div>
    </div>
  )
}
