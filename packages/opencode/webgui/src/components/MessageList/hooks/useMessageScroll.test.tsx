import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { fireEvent, render } from "@testing-library/react"
import { useMessageScroll } from "./useMessageScroll"

function TestHarness(props: { sessionID: string; sortedMessages: any[]; isIdle: boolean; isReasoning: boolean }) {
  const { messagesEndRef, messagesContainerRef } = useMessageScroll(
    props.sessionID,
    props.sortedMessages,
    props.isIdle,
    props.isReasoning,
  )

  return (
    <div data-testid="scroll-parent">
      <div ref={messagesContainerRef}>
        <div style={{ height: 200 }} />
        <div ref={messagesEndRef} data-testid="scroll-anchor" />
      </div>
    </div>
  )
}

function TestHarnessWithScrollButton(props: {
  sessionID: string
  sortedMessages: any[]
  isIdle: boolean
  isReasoning: boolean
}) {
  const { messagesEndRef, messagesContainerRef, showScrollToBottom } = useMessageScroll(
    props.sessionID,
    props.sortedMessages,
    props.isIdle,
    props.isReasoning,
  )

  return (
    <div data-testid="scroll-parent">
      <div ref={messagesContainerRef}>
        <div style={{ height: 200 }} />
        <div ref={messagesEndRef} data-testid="scroll-anchor" />
        <div data-testid="scroll-button-visible">{showScrollToBottom ? "1" : "0"}</div>
      </div>
    </div>
  )
}

function setScrollMetrics(element: HTMLElement, scrollHeight: number, clientHeight: number, scrollTop: number) {
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: scrollHeight,
  })
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: clientHeight,
  })
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    writable: true,
    value: scrollTop,
  })
}

function textMessage(text: string) {
  return [
    {
      info: { id: "m1" },
      parts: [{ id: "p-text", type: "text", text }],
    },
  ]
}

function toolMessage(status: "pending" | "running" | "completed" | "error") {
  return [
    {
      info: { id: "m1" },
      parts: [{ id: "p-tool", type: "tool", state: { status } }],
    },
  ]
}

describe("useMessageScroll", () => {
  const scrollIntoView = vi.fn()

  beforeEach(() => {
    scrollIntoView.mockReset()
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("在底部时持续自动滚动，用户离开底部后停止自动滚动", () => {
    const { rerender, getByTestId } = render(
      <TestHarness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={true} />,
    )

    const parent = getByTestId("scroll-parent")
    setScrollMetrics(parent, 1000, 500, 500)
    fireEvent.scroll(parent)

    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    // 用户向上滚动（wheel deltaY < 0）
    fireEvent.wheel(parent, { deltaY: -100 })
    // 滚离底部（distance = 100 > threshold）
    setScrollMetrics(parent, 1000, 500, 400)
    fireEvent.scroll(parent)

    rerender(<TestHarness sessionID="s1" sortedMessages={textMessage("ab")} isIdle={false} isReasoning={true} />)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    // 用户手动滚回底部（非程序触发）
    setScrollMetrics(parent, 1000, 500, 520)
    fireEvent.scroll(parent)

    rerender(<TestHarness sessionID="s1" sortedMessages={textMessage("abc")} isIdle={false} isReasoning={true} />)
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it("工具状态变化时，底部状态应继续触发自动滚动", () => {
    const { rerender, getByTestId } = render(
      <TestHarness sessionID="s1" sortedMessages={toolMessage("running")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    setScrollMetrics(parent, 1000, 500, 500)
    fireEvent.scroll(parent)

    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    // 仅状态变化（id/type/text 长度不变）也应触发新一轮自动滚动
    rerender(
      <TestHarness sessionID="s1" sortedMessages={toolMessage("completed")} isIdle={false} isReasoning={false} />,
    )
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it("smooth 动画超过旧窗口后到达底部，不应清空用户上滑意图", () => {
    vi.useFakeTimers()

    const { rerender, getByTestId } = render(
      <TestHarness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    // 初始在底部
    setScrollMetrics(parent, 1000, 500, 500)
    fireEvent.scroll(parent)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    // 新内容到达，触发 smooth 程序滚动
    rerender(<TestHarness sessionID="s1" sortedMessages={textMessage("ab")} isIdle={false} isReasoning={false} />)
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "smooth", block: "end" })

    // 模拟动画耗时超过旧的 500ms 窗口（但仍在当前 1000ms 安全窗口内）
    vi.advanceTimersByTime(700)

    // 用户在这期间 wheel 向上，表达离底意图
    fireEvent.wheel(parent, { deltaY: -100 })

    // 动画结束时触发到底部 scroll 事件
    setScrollMetrics(parent, 1000, 500, 500)
    fireEvent.scroll(parent)

    // 新内容到达 → 仍不应自动滚动（用户意图不可被动画清空）
    rerender(<TestHarness sessionID="s1" sortedMessages={textMessage("abc")} isIdle={false} isReasoning={false} />)
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it("scrollbar 拖拽或键盘滚动离开底部后停止自动滚动", () => {
    const { rerender, getByTestId } = render(
      <TestHarness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    // 初始在底部
    setScrollMetrics(parent, 1000, 500, 500)
    fireEvent.scroll(parent)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    // 用户通过 scrollbar/键盘滚离底部（无 wheel 事件，仅 scroll 事件）
    setScrollMetrics(parent, 1000, 500, 200)
    fireEvent.scroll(parent)

    // 新内容到达 → 不应自动滚动
    rerender(<TestHarness sessionID="s1" sortedMessages={textMessage("ab")} isIdle={false} isReasoning={false} />)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    // 用户手动滚回底部
    setScrollMetrics(parent, 1000, 500, 500)
    fireEvent.scroll(parent)

    // 新内容到达 → 应恢复自动滚动
    rerender(<TestHarness sessionID="s1" sortedMessages={textMessage("abc")} isIdle={false} isReasoning={false} />)
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it("微小 wheel delta 不应触发离底锁定", () => {
    const { rerender, getByTestId } = render(
      <TestHarness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    setScrollMetrics(parent, 1000, 500, 500)
    fireEvent.scroll(parent)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    // 小幅误触滚轮（阈值内）
    fireEvent.wheel(parent, { deltaY: -1 })

    // 新内容到达 → 仍应自动滚动
    rerender(<TestHarness sessionID="s1" sortedMessages={textMessage("ab")} isIdle={false} isReasoning={false} />)
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it("切换 session 后重置滚动状态", () => {
    const { rerender, getByTestId } = render(
      <TestHarness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    // 用户 wheel 向上
    fireEvent.wheel(parent, { deltaY: -100 })
    setScrollMetrics(parent, 1000, 500, 300)
    fireEvent.scroll(parent)

    // 切换 session → 应重置，新内容应自动滚动
    rerender(<TestHarness sessionID="s2" sortedMessages={textMessage("b")} isIdle={false} isReasoning={false} />)
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it("离开底部一点点也应显示滚动到底部按钮", () => {
    const { getByTestId } = render(
      <TestHarnessWithScrollButton
        sessionID="s1"
        sortedMessages={textMessage("a")}
        isIdle={false}
        isReasoning={false}
      />,
    )

    const parent = getByTestId("scroll-parent")

    // 在底部
    setScrollMetrics(parent, 1000, 500, 500)
    fireEvent.scroll(parent)
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")

    // 离开底部 20px（仍在旧的 near-bottom 48px 阈值内，但用户此时应看到按钮）
    setScrollMetrics(parent, 1000, 500, 480)
    fireEvent.scroll(parent)
    expect(getByTestId("scroll-button-visible").textContent).toBe("1")
  })
})
