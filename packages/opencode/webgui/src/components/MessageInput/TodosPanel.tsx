import type { Todo } from "../parts/ToolPart/utils"

interface TodosListProps {
  todos: Todo[]
}

export function TodosList({ todos }: TodosListProps) {
  return (
    <div className="space-y-1">
      {todos.map((todo, index) => (
        <div
          key={todo.id || index}
          className="flex items-center gap-2 px-2 py-1 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
        >
          <div className="flex h-4 w-4 shrink-0 items-center justify-center">{getStatusIcon(todo.status)}</div>
          <p
            className={`min-w-0 text-xs flex-1 truncate ${todo.status === "completed" ? "line-through text-gray-500" : "text-gray-700 dark:text-gray-300"}`}
          >
            {todo.content}
          </p>
          {todo.priority && (
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${getPriorityColors(todo.priority)}`}>
              {todo.priority}
            </span>
          )}
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
          className="block w-4 h-4 text-blue-600 dark:text-blue-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
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
        <span className="block h-3.5 w-3.5 rounded-full border-[1.5px] border-current text-gray-400 opacity-80 dark:text-gray-500" />
      )
  }
}

function getPriorityColors(priority: string) {
  const colors: Record<string, string> = {
    high: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
    medium: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300",
    low: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
  }
  return colors[priority] || colors.low
}
