import { describe, expect, it, vi } from "vitest"
import { act, render, screen } from "@testing-library/react"
import { ActionButtons } from "./ActionButtons"

describe("ActionButtons", () => {
  it("复制/分叉/回退按钮的提示文案为中文", async () => {
    vi.useFakeTimers()

    render(
      <ActionButtons
        isUser={true}
        copyText="hello"
        onFork={vi.fn()}
        onRevert={vi.fn()}
        onRetry={vi.fn()}
        revertBusy={false}
      />,
    )

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600)
    })

    expect(screen.getByRole("button", { name: "复制到剪贴板" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "从此消息分叉会话" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "回退到此消息" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "重试消息" })).toBeInTheDocument()

    vi.useRealTimers()
  })

  it("对话进行中时禁用重试按钮", () => {
    render(<ActionButtons isUser inline onRetry={vi.fn()} retryDisabled />)

    const retry = screen.getByRole("button", { name: "重试消息" })
    expect(retry).toBeDisabled()
    expect(retry).toHaveAttribute("title", "对话进行中，无法重试")
  })
})
