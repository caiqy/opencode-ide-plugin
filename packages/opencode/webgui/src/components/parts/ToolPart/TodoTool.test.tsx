import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TodoTool } from "./TodoTool"

describe("TodoTool", () => {
  it("使用待办事项的紧凑列表且隐藏任务元数据", () => {
    const { container } = render(
      <TodoTool
        output={JSON.stringify([
          { id: "task-1", content: "实现 Task 1", status: "completed", priority: "high" },
          { id: "task-2", content: "审查 Task 1", status: "in_progress", priority: "medium" },
          { id: "task-3", content: "验证 Task 1", status: "pending", priority: "low" },
        ])}
      />,
    )

    expect(screen.getByText("实现 Task 1")).toBeInTheDocument()
    expect(screen.getByText("审查 Task 1")).toBeInTheDocument()
    expect(screen.queryByText("task-1")).not.toBeInTheDocument()
    expect(screen.queryByText("high")).not.toBeInTheDocument()
    expect(screen.queryByText("medium")).not.toBeInTheDocument()
    expect(screen.queryByText("low")).not.toBeInTheDocument()
    expect(screen.getByText("实现 Task 1")).not.toHaveClass("line-through")
    expect(container.querySelector(".border-gray-200")).not.toBeInTheDocument()
    expect(container.querySelector(".bg-blue-50")).toBeInTheDocument()

    expect(screen.getByTestId("todo-pending-icon")).toHaveClass("block", "h-4", "w-4", "text-gray-400")
    expect(screen.getByTestId("todo-pending-dot")).toHaveAttribute("fill", "currentColor")
    expect(screen.getByTestId("todo-in-progress-icon")).toHaveClass("text-blue-500", "dark:text-blue-400")
    expect(screen.getByTestId("todo-clock-hand")).toBeInTheDocument()
  })
})
