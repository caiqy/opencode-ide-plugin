import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { TodosList } from "./TodosPanel"

describe("TodosList", () => {
  it("待办任务使用圆环内实心点图标并居中渲染", () => {
    const { container } = render(
      <TodosList
        todos={[
          {
            id: "t1",
            content: "待处理任务",
            status: "pending",
            priority: "high",
          },
        ]}
      />,
    )

    expect(screen.getByText("待处理任务")).toBeInTheDocument()

    const iconWrap = container.querySelector(".flex.h-4.w-4.shrink-0.items-center.justify-center")
    expect(iconWrap).toBeInTheDocument()

    const pendingIcon = screen.getByTestId("todo-pending-icon")
    expect(pendingIcon).toBeInTheDocument()
    expect(pendingIcon).toHaveClass("block", "h-4", "w-4", "text-gray-400")
    expect(screen.getByTestId("todo-pending-dot")).toHaveAttribute("fill", "currentColor")
  })

  it("完成任务保留文字并隐藏优先级标签", () => {
    render(
      <TodosList
        todos={[
          {
            id: "t1",
            content: "已完成任务",
            status: "completed",
            priority: "high",
          },
        ]}
      />,
    )

    expect(screen.getByText("已完成任务")).not.toHaveClass("line-through")
    expect(screen.getByText("已完成任务")).toHaveClass("text-gray-700", "dark:text-gray-300")
    expect(screen.queryByText("high")).not.toBeInTheDocument()
    expect(screen.getByText("已完成任务").previousElementSibling?.querySelector("svg")).toHaveClass(
      "text-green-600",
      "dark:text-green-400",
    )
  })

  it("进行中的任务使用蓝色时钟图标和低调蓝色强调行", () => {
    render(
      <TodosList
        todos={[
          {
            id: "t1",
            content: "进行中任务",
            status: "in_progress",
            priority: "medium",
          },
        ]}
      />,
    )

    expect(screen.getByText("进行中任务").closest("div.flex")).toHaveClass("bg-blue-50", "dark:bg-blue-950/40")
    expect(screen.getByTestId("todo-in-progress-icon")).toHaveClass("block", "h-4", "w-4", "text-blue-500")
    expect(screen.getByTestId("todo-clock-hand")).toBeInTheDocument()
  })
})
