import { useState, useMemo } from "react"
import { useMessages } from "../../state/MessagesContext"
import { TodosList } from "./TodosPanel"

interface FooterPanelsProps {
  sessionID: string | null
}

export function FooterPanels({ sessionID }: FooterPanelsProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const { getMessagesBySession } = useMessages()

  const todosExpanded = sessionID ? (expanded[sessionID] ?? false) : false

  const todos = useMemo(() => {
    if (!sessionID) return null
    const messages = getMessagesBySession(sessionID)
    let todoOutput: string | null = null

    for (const msg of messages) {
      for (const part of msg.parts) {
        if (part.type !== "tool") continue
        const toolPart = part as { tool?: string; state?: { output?: string } }
        if (toolPart.tool === "todowrite" && toolPart.state?.output) {
          todoOutput = toolPart.state.output
        }
      }
    }

    if (!todoOutput) return null
    try {
      const parsed = JSON.parse(todoOutput)
      if (Array.isArray(parsed)) return parsed
    } catch {}
    return null
  }, [sessionID, getMessagesBySession])

  if (!todos?.length) return null

  const completedTodos = todos.filter((t: any) => t.status === "completed").length

  return (
    <div className="first:rounded-t-lg flex flex-col border-b border-gray-100 bg-white dark:border-gray-800 dark:bg-[rgb(25,25,25)]">
      <button
        onClick={() => {
          if (!sessionID) return
          setExpanded((prev) => ({ ...prev, [sessionID]: !todosExpanded }))
        }}
        aria-expanded={todosExpanded}
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-700 hover:text-gray-950 dark:text-gray-200 dark:hover:text-white"
      >
        <svg
          className={`w-3 h-3 transition-transform ${todosExpanded ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
        <span>
          待办事项 ({completedTodos}/{todos.length})
        </span>
      </button>

      {todosExpanded && <TodosList todos={todos} />}
    </div>
  )
}
