import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, fireEvent, render } from "@testing-library/react"
import { useRef } from "react"
import { useMessageScroll } from "./useMessageScroll"

function TestHarness(props: {
  sessionID: string
  sortedMessages: any[]
  isIdle: boolean
  isReasoning: boolean
  settling?: boolean
  tailKey?: string
}) {
  const tailRef = useRef<HTMLDivElement>(null)
  const { messagesEndRef, messagesContainerRef } = useMessageScroll(
    props.sessionID,
    props.sortedMessages,
    props.isIdle,
    props.isReasoning,
    props.settling ?? false,
    undefined,
    tailRef,
    props.tailKey,
  )

  return (
    <div data-testid="scroll-parent">
      <div ref={messagesContainerRef}>
        <div data-testid="history-box" style={{ height: 200 }} />
        <div ref={tailRef} data-testid="tail-box">
          <div ref={messagesEndRef} data-testid="scroll-anchor" />
        </div>
      </div>
    </div>
  )
}

function TestHarnessWithScrollButton(props: {
  sessionID: string
  sortedMessages: any[]
  isIdle: boolean
  isReasoning: boolean
  settling?: boolean
  tailKey?: string
}) {
  const tailRef = useRef<HTMLDivElement>(null)
  const { messagesEndRef, messagesContainerRef, showScrollToBottom } = useMessageScroll(
    props.sessionID,
    props.sortedMessages,
    props.isIdle,
    props.isReasoning,
    props.settling ?? false,
    undefined,
    tailRef,
    props.tailKey,
  )

  return (
    <div data-testid="scroll-parent">
      <div ref={messagesContainerRef}>
        <div data-testid="history-box" style={{ height: 200 }} />
        <div ref={tailRef} data-testid="tail-box">
          <div ref={messagesEndRef} data-testid="scroll-anchor" />
        </div>
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

function setRect(element: HTMLElement, box: { top?: number; bottom?: number; height?: number }) {
  element.getBoundingClientRect = vi.fn(() => ({
    x: 0,
    y: box.top ?? 0,
    top: box.top ?? 0,
    left: 0,
    right: 0,
    bottom: box.bottom ?? (box.top ?? 0) + (box.height ?? 0),
    width: 0,
    height: box.height ?? (box.bottom ?? 0) - (box.top ?? 0),
    toJSON: () => ({}),
  }))
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

function userMessage(text: string) {
  return [
    {
      info: { id: "u1", role: "user" },
      parts: [{ id: "u-text", type: "text", text }],
    },
  ]
}

describe("useMessageScroll", () => {
  const scrollIntoView = vi.fn()
  const originalResizeObserver = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver
  let resizeObservers: Array<{ callback: ResizeObserverCallback; nodes: Set<Element> }> = []

  const triggerResize = (node: Element) => {
    for (const item of resizeObservers) {
      if (!item.nodes.has(node)) continue
      act(() => {
        item.callback([{ target: node } as ResizeObserverEntry], {} as ResizeObserver)
      })
    }
  }

  beforeEach(() => {
    scrollIntoView.mockReset()
    resizeObservers = []
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    })
    ;(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
      item: { callback: ResizeObserverCallback; nodes: Set<Element> }
      constructor(callback: ResizeObserverCallback) {
        this.item = { callback, nodes: new Set<Element>() }
        resizeObservers.push(this.item)
      }
      disconnect() {}
      observe(node: Element) {
        this.item.nodes.add(node)
      }
      unobserve() {}
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    ;(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = originalResizeObserver
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

  it("smooth 自动滚动过程中不会让到底按钮闪回显示", () => {
    vi.useFakeTimers()
    const { rerender, getByTestId } = render(
      <TestHarnessWithScrollButton
        sessionID="s1"
        sortedMessages={textMessage("a")}
        isIdle={false}
        isReasoning={false}
      />,
    )

    const parent = getByTestId("scroll-parent")
    setScrollMetrics(parent, 1000, 500, 500)
    fireEvent.scroll(parent)
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")

    rerender(
      <TestHarnessWithScrollButton
        sessionID="s1"
        sortedMessages={textMessage("ab")}
        isIdle={false}
        isReasoning={false}
      />,
    )
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")

    setScrollMetrics(parent, 1000, 500, 460)
    fireEvent.scroll(parent)

    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
  })

  it("smooth 期间仅 scroll 离底后停止自动滚动", () => {
    vi.useFakeTimers()

    const { rerender, getByTestId } = render(
      <TestHarness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    setScrollMetrics(parent, 1000, 500, 500)
    fireEvent.scroll(parent)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    rerender(<TestHarness sessionID="s1" sortedMessages={textMessage("ab")} isIdle={false} isReasoning={false} />)
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "smooth", block: "end" })

    setScrollMetrics(parent, 1000, 500, 200)
    fireEvent.scroll(parent)

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

  it("JetBrains 传入 jcefScrollMultiplier 时应放大主消息区滚轮位移", () => {
    window.history.replaceState({}, "", "?jcefScrollMultiplier=4")

    const { getByTestId } = render(
      <TestHarness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    const scrollBy = vi.fn()
    Object.defineProperty(parent, "scrollBy", {
      configurable: true,
      value: scrollBy,
    })

    fireEvent.wheel(parent, { deltaY: 10, deltaMode: 0 })

    expect(scrollBy).toHaveBeenCalledWith({ top: 40, behavior: "auto" })

    window.history.replaceState({}, "", "/")
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

  it("用户发送新消息时即使 tail 长度不变也会强制回到底部", () => {
    const { rerender, getByTestId } = render(
      <TestHarness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    setScrollMetrics(parent, 1000, 500, 500)
    fireEvent.scroll(parent)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    fireEvent.wheel(parent, { deltaY: -100 })
    setScrollMetrics(parent, 1200, 500, 200)
    fireEvent.scroll(parent)

    rerender(<TestHarness sessionID="s1" sortedMessages={userMessage("hi")} isIdle={false} isReasoning={false} />)

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

  it("内容自动展开导致高度增长但 scrollTop 未上移时，仍保持自动跟随", () => {
    const { rerender, getByTestId } = render(
      <TestHarness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")

    // 初始在底部
    setScrollMetrics(parent, 1000, 500, 500)
    fireEvent.scroll(parent)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    // 非用户滚动：内容自动展开后高度增长，但 scrollTop 不变
    setScrollMetrics(parent, 1200, 500, 500)
    fireEvent.scroll(parent)

    // 新内容到达，仍应自动跟随到底部
    rerender(<TestHarness sessionID="s1" sortedMessages={textMessage("ab")} isIdle={false} isReasoning={false} />)
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it("history 区高度变化不触发自动滚动，但 tail 区变化会触发", () => {
    const { getByTestId } = render(
      <TestHarness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    const history = getByTestId("history-box")
    const tail = getByTestId("tail-box")

    // 初始在底部
    setScrollMetrics(parent, 1000, 500, 500)
    fireEvent.scroll(parent)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    triggerResize(history)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    triggerResize(tail)
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it("滚动容器高度变化时会重算贴底并保持到底部", () => {
    const { getByTestId } = render(
      <TestHarness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    setScrollMetrics(parent, 1000, 500, 500)
    fireEvent.scroll(parent)
    scrollIntoView.mockClear()

    setScrollMetrics(parent, 1000, 400, 500)
    triggerResize(parent)

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "auto", block: "end" })
  })

  it("贴底判定基于 tail anchor，而不是整个 scrollHeight", () => {
    const { getByTestId } = render(
      <TestHarnessWithScrollButton
        sessionID="s1"
        sortedMessages={textMessage("a")}
        isIdle={false}
        isReasoning={false}
      />,
    )

    const parent = getByTestId("scroll-parent")
    const anchor = getByTestId("scroll-anchor")
    setScrollMetrics(parent, 1400, 500, 400)
    setRect(parent, { top: 0, bottom: 100, height: 100 })
    setRect(anchor, { top: 100, bottom: 100, height: 0 })

    fireEvent.scroll(parent)

    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
  })

  it("用户已离开底部时，顶部 prepend 历史不会强制跳到底部", () => {
    const { rerender, getByTestId } = render(
      <TestHarness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    setScrollMetrics(parent, 1000, 500, 500)
    fireEvent.scroll(parent)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    fireEvent.wheel(parent, { deltaY: -100 })
    setScrollMetrics(parent, 1200, 500, 200)
    fireEvent.scroll(parent)

    rerender(
      <TestHarness
        sessionID="s1"
        sortedMessages={[
          { info: { id: "m0" }, parts: [{ id: "p0", type: "text", text: "older" }] },
          ...textMessage("a"),
        ]}
        isIdle={false}
        isReasoning={false}
      />,
    )

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it("稳定期内不会自动滚动，结束后只做一次 auto 校正", () => {
    const { rerender, getByTestId } = render(
      <TestHarness sessionID="s2" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} settling />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    setScrollMetrics(parent, 1000, 500, 500)
    fireEvent.scroll(parent)
    scrollIntoView.mockClear()

    setScrollMetrics(parent, 1300, 500, 500)
    triggerResize(tail)
    rerender(
      <TestHarness sessionID="s2" sortedMessages={textMessage("ab")} isIdle={false} isReasoning={false} settling />,
    )

    expect(scrollIntoView).not.toHaveBeenCalled()

    rerender(<TestHarness sessionID="s2" sortedMessages={textMessage("ab")} isIdle={false} isReasoning={false} />)

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ behavior: "auto", block: "end" })
  })

  it("没有 ResizeObserver 时仍保留基础 tail 贴底语义", () => {
    ;(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = undefined
    const { rerender, getByTestId } = render(
      <TestHarness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    setScrollMetrics(parent, 1000, 500, 500)
    fireEvent.scroll(parent)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    rerender(<TestHarness sessionID="s1" sortedMessages={textMessage("ab")} isIdle={false} isReasoning={false} />)
    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })

  it("没有 ResizeObserver 时，tail-only 变化也会保持基础贴底", () => {
    ;(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = undefined
    const { rerender, getByTestId } = render(
      <TestHarness
        sessionID="s1"
        sortedMessages={textMessage("a")}
        isIdle={false}
        isReasoning={false}
        tailKey="tail:m1"
      />,
    )

    const parent = getByTestId("scroll-parent")
    setScrollMetrics(parent, 1000, 500, 500)
    fireEvent.scroll(parent)
    expect(scrollIntoView).toHaveBeenCalledTimes(1)

    rerender(
      <TestHarness
        sessionID="s1"
        sortedMessages={textMessage("a")}
        isIdle={false}
        isReasoning={false}
        tailKey="tail:m1,question:q1"
      />,
    )

    expect(scrollIntoView).toHaveBeenCalledTimes(2)
  })
})
