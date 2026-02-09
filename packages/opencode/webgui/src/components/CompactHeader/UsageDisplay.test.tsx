import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { UsageDisplay } from "./UsageDisplay"

describe("CompactHeader/UsageDisplay", () => {
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
