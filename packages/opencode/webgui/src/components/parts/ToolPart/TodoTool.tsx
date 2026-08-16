import { getTodoStatusIcon, type Todo } from "./utils"

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
              <div className="flex h-4 w-4 shrink-0 items-center justify-center">{getTodoStatusIcon(todo.status)}</div>
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
