import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { TypingIndicator } from "./TypingIndicator"

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
}))

vi.mock("../state/SessionContext", () => ({
  useSession: () => mocks.useSession(),
}))

describe("TypingIndicator", () => {
  beforeEach(() => {
    mocks.useSession.mockReturnValue({
      currentStatus: { type: "idle", attempt: 0, message: "", next: Date.now() },
    })
  })

  it("显示 Generating 时应与底部保持更大间距", () => {
    render(<TypingIndicator visible={true} />)

    const text = screen.getByText("生成中")
    const button = text.closest("button")
    expect(button).toBeTruthy()
    const wrap = button?.parentElement

    expect(wrap).toHaveClass("mb-3")
  })

  it("retry 状态会显示中文重试提示", () => {
    mocks.useSession.mockReturnValue({
      currentStatus: { type: "retry", attempt: 2, message: "等待重试", next: Date.now() },
    })

    render(<TypingIndicator visible={false} />)

    expect(screen.getByText("等待重试")).toBeInTheDocument()
    expect(screen.getByText(/即将重试\s*·\s*第\s*2\s*次尝试/)).toBeInTheDocument()
  })
})
