import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
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

  afterEach(() => {
    vi.useRealTimers()
  })

  it("使用轮次开始时间，组件重新挂载后继续累计", () => {
    vi.useFakeTimers()
    vi.setSystemTime(70_000)

    const view = render(<TypingIndicator visible={true} startedAt={4_000} />)
    expect(screen.getByText("1 分 06 秒")).toBeInTheDocument()

    view.unmount()
    vi.setSystemTime(3_670_000)
    render(<TypingIndicator visible={true} startedAt={4_000} />)

    expect(screen.getByText("1 小时 01 分 06 秒")).toBeInTheDocument()
  })

  it("生成中与完成态使用相同的四舍五入进位", () => {
    vi.useFakeTimers()
    vi.setSystemTime(63_500)

    const view = render(<TypingIndicator visible={true} startedAt={4_000} />)
    expect(screen.getByText("1 分 00 秒")).toBeInTheDocument()

    view.unmount()
    vi.setSystemTime(3_603_500)
    render(<TypingIndicator visible={true} startedAt={4_000} />)

    expect(screen.getByText("1 小时 00 分 00 秒")).toBeInTheDocument()
  })

  it("不再使用根节点外边距，由父层 gap 控制与其他消息项的间距", () => {
    render(<TypingIndicator visible={true} />)

    const text = screen.getByText("生成中")
    const button = text.closest("button")
    expect(button).toBeTruthy()
    const wrap = button?.parentElement

    expect(wrap).not.toHaveClass("mt-1")
    expect(wrap).not.toHaveClass("mb-3")
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
