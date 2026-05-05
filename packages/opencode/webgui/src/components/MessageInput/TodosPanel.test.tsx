import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { TodosList } from "./TodosPanel"

describe("TodosList", () => {
  it("pending 任务使用稳定的圆环图标并居中渲染", () => {
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

    const pendingRing = iconWrap?.querySelector("span.rounded-full")
    expect(pendingRing).toBeInTheDocument()
    expect(pendingRing).toHaveClass("block", "h-3.5", "w-3.5", "border-current")
  })
})
