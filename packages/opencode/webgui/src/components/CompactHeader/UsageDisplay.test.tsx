import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { UsageDisplay } from "./UsageDisplay"

describe("CompactHeader/UsageDisplay", () => {
  it("进度环公开详情面板的展开状态", async () => {
    const user = userEvent.setup()

    render(
      <UsageDisplay
        variant="ring"
        usage={{
          contextUsed: 1000,
          contextLimit: 8000,
          tokens: 12345,
          cost: 0.12,
          percentage: 12,
          breakdown: { input: 100, cacheWrite: 0, cacheRead: 0, output: 200, reasoning: 300 },
        }}
      />,
    )

    const button = screen.getByRole("button", { name: "上下文已用 12%" })
    const svg = button.querySelector("svg")
    const circles = svg?.querySelectorAll("circle")

    expect(svg).toHaveAttribute("viewBox", "0 0 16 16")
    expect(circles).toHaveLength(2)
    expect(circles?.[0]).toHaveAttribute("stroke-width", "2")
    expect(circles?.[0]).toHaveClass("stroke-gray-300", "dark:stroke-[rgba(255,255,255,.32)]")
    expect(circles?.[1]).toHaveClass("stroke-gray-900", "dark:stroke-white")
    expect(button).toHaveAttribute("aria-expanded", "false")

    await user.click(button)

    expect(button).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByTestId("usage-details")).toHaveAttribute("id", button.getAttribute("aria-controls"))
  })

  it("在 50% 到 80% 将进度环从黄色渐变至红色", () => {
    const usage = {
      contextUsed: 1000,
      contextLimit: 8000,
      tokens: 12345,
      cost: 0.12,
      breakdown: { input: 100, cacheWrite: 0, cacheRead: 0, output: 200, reasoning: 300 },
    }
    const { rerender } = render(<UsageDisplay variant="ring" usage={{ ...usage, percentage: 50 }} />)

    const stroke = () => screen.getByRole("button").querySelectorAll("circle")[1]

    expect(stroke()).toHaveAttribute("stroke", "#fef3c7")

    rerender(<UsageDisplay variant="ring" usage={{ ...usage, percentage: 60 }} />)
    expect(stroke()).toHaveAttribute("stroke", "#facc15")

    rerender(<UsageDisplay variant="ring" usage={{ ...usage, percentage: 70 }} />)
    expect(stroke()).toHaveAttribute("stroke", "#f5882d")

    rerender(<UsageDisplay variant="ring" usage={{ ...usage, percentage: 80 }} />)
    expect(stroke()).toHaveAttribute("stroke", "#ef4444")

    rerender(<UsageDisplay variant="ring" usage={{ ...usage, percentage: 90 }} />)
    expect(stroke()).toHaveAttribute("stroke", "#ef4444")
  })

  it("用量详情面板的文案为中文", async () => {
    const user = userEvent.setup()

    render(
      <UsageDisplay
        usage={{
          contextUsed: 1000,
          contextLimit: 8000,
          tokens: 12345,
          cost: 0.12,
          percentage: 12,
          breakdown: {
            input: 100,
            cacheWrite: 0,
            cacheRead: 0,
            output: 200,
            reasoning: 300,
          },
        }}
      />,
    )

    const button = screen.getByTitle("查看用量详情")
    await user.click(button)

    expect(screen.getByText("上下文已用")).toBeInTheDocument()
    expect(screen.getByText("令牌总数")).toBeInTheDocument()
    expect(screen.getByText("总费用")).toBeInTheDocument()
    expect(screen.getByText("输入令牌")).toBeInTheDocument()
    expect(screen.getByText("缓存写入")).toBeInTheDocument()
    expect(screen.getByText("缓存读取")).toBeInTheDocument()
    expect(screen.getByText("输出令牌")).toBeInTheDocument()
    expect(screen.getByText("推理令牌")).toBeInTheDocument()
  })
})
