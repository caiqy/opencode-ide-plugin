import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MessageActions } from "./MessageActions"

vi.mock("../../hooks/useSessionUsage", () => {
  return {
    useSessionUsage: () => ({
      tokens: 0,
      cost: 0,
      contextUsed: 0,
      contextLimit: 0,
      percentage: 0,
      breakdown: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    }),
  }
})

vi.mock("../CompactHeader/UsageDisplay", () => {
  return {
    UsageDisplay: () => null,
  }
})

describe("MessageActions", () => {
  it("在空闲状态展示中文提示：发送/精简会话历史", () => {
    render(
      <MessageActions
        isIdle={true}
        isButtonDisabled={false}
        isCompactDisabled={false}
        onSubmit={vi.fn()}
        onAbort={vi.fn()}
        onCompactClick={vi.fn()}
      />,
    )

    const compact = screen.getByTitle("精简会话历史")
    expect(compact).toHaveAttribute("data-tip", "精简会话历史")

    const send = screen.getByTitle("发送（回车）")
    expect(send).toHaveAttribute("data-tip", "发送（回车）")
  })

  it("在生成中展示中文提示：停止生成", () => {
    render(
      <MessageActions
        isIdle={false}
        isButtonDisabled={false}
        isCompactDisabled={false}
        onSubmit={vi.fn()}
        onAbort={vi.fn()}
        onCompactClick={vi.fn()}
      />,
    )

    const stop = screen.getByTitle("停止生成")
    expect(stop).toHaveAttribute("data-tip", "停止生成")
  })

  it("生成中精简按钮应禁用", () => {
    render(
      <MessageActions
        isIdle={false}
        isButtonDisabled={false}
        isCompactDisabled={true}
        onSubmit={vi.fn()}
        onAbort={vi.fn()}
        onCompactClick={vi.fn()}
      />,
    )

    expect(screen.getByTitle("精简会话历史")).toBeDisabled()
    expect(screen.getByTitle("停止生成")).toBeInTheDocument()
  })
})
