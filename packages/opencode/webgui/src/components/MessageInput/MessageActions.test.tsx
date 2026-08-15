import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { MessageActions } from "./MessageActions"

let usageDisplayProps: { variant?: string } | undefined

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
    UsageDisplay: (props: { variant?: string }) => {
      usageDisplayProps = props
      return null
    },
  }
})

describe("MessageActions", () => {
  it("使用无数字的上下文进度环与 Shrink 按钮", () => {
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

    expect(usageDisplayProps).toMatchObject({ variant: "ring" })
    const compact = screen.getByRole("button", { name: "压缩上下文" })
    expect(compact).toBeInTheDocument()
    expect(compact.querySelector("path")).toHaveAttribute(
      "d",
      "M3 3l6 6M3 9h6V3M21 3l-6 6M21 9h-6V3M3 21l6-6M3 15h6v6M21 21l-6-6M21 15h-6v6",
    )
  })

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

  it("操作组以 4px 间距排列", () => {
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

    expect(screen.getByTitle("发送（回车）").parentElement).toHaveClass("gap-1")
  })

  it("空闲发送按钮使用向上箭头", () => {
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

    expect(screen.getByTitle("发送（回车）").querySelector("path")).toHaveAttribute("d", "M12 19V5m0 0-7 7m7-7 7 7")
  })

  it("空闲发送按钮使用中性浅色配色", () => {
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

    expect(screen.getByTitle("发送（回车）")).toHaveClass("bg-gray-200", "text-gray-700", "hover:bg-gray-300")
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
