import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { ChatLoadGuard } from "./ChatLoadGuard"

describe("ChatLoadGuard", () => {
  it("loading 时显示蒙层并阻断内容区点击", () => {
    const onRetry = vi.fn()
    render(
      <ChatLoadGuard loading={true} error={false} onRetry={onRetry}>
        <button>content</button>
      </ChatLoadGuard>,
    )

    expect(screen.getByTestId("chat-load-overlay")).toBeInTheDocument()
    expect(screen.getByText("正在加载会话内容…")).toBeInTheDocument()
    expect(screen.getByTestId("chat-load-content")).toHaveClass("pointer-events-none")
  })

  it("error 时显示重试按钮并可触发", () => {
    const onRetry = vi.fn()
    render(
      <ChatLoadGuard loading={false} error={true} onRetry={onRetry}>
        <div>content</div>
      </ChatLoadGuard>,
    )

    fireEvent.click(screen.getByRole("button", { name: "重试加载" }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
