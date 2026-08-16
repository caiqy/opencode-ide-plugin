import type { Todo } from "./utils"

interface TodoToolProps {
  output: string
}

export function TodoTool({ output }: TodoToolProps) {
  try {
    const todos = JSON.parse(output)
    if (!Array.isArray(todos)) {
      return (
        <div className="px-3 py-1.5 border-b border-gray-100 dark:border-gray-800">
          <div className="text-xs bg-white dark:bg-gray-900 rounded p-1.5 overflow-x-auto max-h-60 overflow-y-auto">
            <pre className="font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{output}</pre>
          </div>
        </div>
      )
    }

    return (
      <div className="border-b border-gray-100 dark:border-gray-800">
        <div className="max-h-60 space-y-0.5 overflow-y-auto px-2 pb-1">
          {todos.map((todo: Todo, index: number) => (
            <div
              key={todo.id || index}
              className={`flex items-center gap-2 px-2 py-1 ${todo.status === "in_progress" ? "bg-blue-50 dark:bg-blue-950/40" : ""}`}
            >
              <div className="flex h-4 w-4 shrink-0 items-center justify-center">{getStatusIcon(todo.status)}</div>
              <p className="min-w-0 flex-1 truncate text-xs text-gray-700 dark:text-gray-300">{todo.content}</p>
            </div>
          ))}
        </div>
      </div>
    )
  } catch {
    return (
      <div className="px-3 py-1.5 border-b border-gray-100 dark:border-gray-800">
        <div className="text-xs bg-white dark:bg-gray-900 rounded p-1.5 overflow-x-auto max-h-60 overflow-y-auto">
          <pre className="font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{output}</pre>
        </div>
      </div>
    )
  }
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
    default: // pending
      return (
        <span className="block h-3.5 w-3.5 rounded-full border-[1.5px] border-current text-gray-400 opacity-80 dark:text-gray-500" />
      )
  }
}
