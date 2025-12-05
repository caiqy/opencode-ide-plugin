import { useState, useMemo } from "react"
import { useMessages } from "../../state/MessagesContext"
import { ModifiedFilesList } from "./ModifiedFilesPanel"
import { TodosList } from "./TodosPanel"

interface FooterPanelsProps {
  sessionID: string | null
}

export function FooterPanels({ sessionID }: FooterPanelsProps) {
  const [filesExpanded, setFilesExpanded] = useState(false)
  const [todosExpanded, setTodosExpanded] = useState(false)
  const { getMessagesBySession } = useMessages()

  const { modifiedFiles, todos } = useMemo(() => {
    if (!sessionID) return { modifiedFiles: [] as string[], todos: null }
    const messages = getMessagesBySession(sessionID)
    const files: string[] = []
    const seen = new Set<string>()
    let todoOutput: string | null = null

    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type !== "tool") continue
        const toolPart = part as { tool?: string; state?: { input?: { filePath?: string }; output?: string } }
        if ((toolPart.tool === "write" || toolPart.tool === "edit") && toolPart.state?.input?.filePath) {
          const path = toolPart.state.input.filePath
          if (!seen.has(path)) {
            seen.add(path)
            files.push(path)
          }
        }
        if (toolPart.tool === "todowrite" && toolPart.state?.output) {
          todoOutput = toolPart.state.output
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

    return { modifiedFiles: files, todos }
  }, [sessionID, getMessagesBySession])

  const hasFiles = modifiedFiles.length > 0
  const hasTodos = todos && todos.length > 0

  if (!hasFiles && !hasTodos) return null

  const completedTodos = todos?.filter((t: any) => t.status === "completed").length ?? 0

  return (
    <div className="px-2 py-1 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 flex flex-col gap-1">
      {/* Expanded content - TODOs above files */}
      {todosExpanded && hasTodos && <TodosList todos={todos} />}
      {filesExpanded && hasFiles && <ModifiedFilesList files={modifiedFiles} />}

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
            <span>{modifiedFiles.length} file{modifiedFiles.length !== 1 ? "s" : ""} changed</span>
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
