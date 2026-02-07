import { describe, it, expect, vi, beforeEach } from "vitest"
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

  it("在底部时持续自动滚动，用户离开底部后停止自动滚动", () => {
    const { rerender, getByTestId } = render(
      <TestHarness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={true} />,
    )

    const parent = getByTestId("scroll-parent")
    setScrollMetrics(parent, 1000, 500, 500)
    fireEvent.scroll(parent)

    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    // 用户滚离底部（distance = 100 > threshold）
    setScrollMetrics(parent, 1000, 500, 400)
    fireEvent.scroll(parent)

    rerender(<TestHarness sessionID="s1" sortedMessages={textMessage("ab")} isIdle={false} isReasoning={true} />)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    // 回到底部后恢复自动滚动
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
})
