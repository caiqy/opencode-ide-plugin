import { getTodoStatusIcon, type Todo } from "../parts/ToolPart/utils"

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
          <div className="flex h-4 w-4 shrink-0 items-center justify-center">{getTodoStatusIcon(todo.status)}</div>
          <p className="min-w-0 flex-1 truncate text-xs text-gray-700 dark:text-gray-300">
            {todo.content}
          </p>
        </div>
      ))}
    </div>
  )
}
