import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { TodoTool } from "./TodoTool"

describe("TodoTool", () => {
  it("渲染任务列表时不显示输出标题", () => {
    const { container } = render(
      <TodoTool
        output={JSON.stringify([
          { content: "实现 Task 1", status: "completed", priority: "high" },
          { content: "审查 Task 1", status: "pending", priority: "high" },
        ])}
      />,
    )

    expect(screen.getByText("实现 Task 1")).toBeInTheDocument()
    expect(screen.queryByText("输出")).not.toBeInTheDocument()

    const pendingIcon = container.querySelector("span.rounded-full")
    expect(pendingIcon).toBeInTheDocument()
    expect(pendingIcon).toHaveClass("block", "h-3.5", "w-3.5", "border-current")
    expect(container.querySelectorAll("span.rounded-full")).toHaveLength(1)
  })
})
