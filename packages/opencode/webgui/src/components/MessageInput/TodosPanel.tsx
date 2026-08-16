import type { Todo } from "../parts/ToolPart/utils"

interface TodosListProps {
  todos: Todo[]
}
export function TodosList({ todos }: TodosListProps) {
  return (
    <div className="space-y-0.5 px-2 pb-1">
      {todos.map((todo, index) => (
        <div
          key={todo.id || index}
          className={`flex items-center gap-2 px-2 py-1 ${todo.status === "in_progress" ? "bg-blue-50 dark:bg-blue-950/40" : ""}`}
        >
          <div className="flex h-4 w-4 shrink-0 items-center justify-center">{getStatusIcon(todo.status)}</div>
          <p className="min-w-0 flex-1 truncate text-xs text-gray-700 dark:text-gray-300">
            {todo.content}
          </p>
        </div>
      ))}
    </div>
  )
}

function getStatusIcon(status: string) {
  switch (status) {
    case "completed":
      return (
        <svg
          className="block w-4 h-4 text-green-600 dark:text-green-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      )
    case "in_progress":
      return (
        <svg
          data-testid="todo-in-progress-icon"
          className="block h-4 w-4 text-blue-500 dark:text-blue-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" strokeWidth={2} />
          <path data-testid="todo-clock-hand" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 7v5l3 2" />
        </svg>
      )
    case "cancelled":
      return (
        <svg
          className="block w-4 h-4 text-gray-400 dark:text-gray-600"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      )
    default:
      return (
        <svg
          data-testid="todo-pending-icon"
          className="block h-4 w-4 text-gray-400 dark:text-gray-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" strokeWidth={2} />
          <circle data-testid="todo-pending-dot" cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
        </svg>
      )
  }
}
