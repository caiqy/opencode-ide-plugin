import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, fireEvent, render } from "@testing-library/react"
import { useRef } from "react"
import type { Message } from "../../../state/MessagesContext"
import { useMessageScroll } from "./useMessageScroll"

function Harness(props: {
  sessionID: string
  sortedMessages: Message[]
  isIdle: boolean
  isReasoning: boolean
  settling?: boolean
  tailKey?: string
  sendRequestKey?: number
  controls?: boolean
  showContainer?: boolean
}) {
  const tailRef = useRef<HTMLDivElement>(null)
  const hook = useMessageScroll(
    props.sessionID,
    props.sortedMessages,
    props.isIdle,
    props.isReasoning,
    props.settling ?? false,
    undefined,
    tailRef,
    props.tailKey,
    props.sendRequestKey,
  )
  const controls = hook as typeof hook & {
    runProgrammaticScroll: (source: string, fn: (parent: HTMLElement) => void) => void
  }

  return (
    <div data-testid="scroll-parent">
      {props.showContainer === false ? null : (
        <div ref={hook.messagesContainerRef} data-testid="message-scroll-container">
          <div data-testid="history-box" style={{ height: 200 }} />
          <div ref={tailRef} data-testid="tail-box">
            <div ref={hook.messagesEndRef} data-testid="scroll-anchor" />
          </div>
          {props.controls ? <button data-testid="scroll-button" onClick={hook.scrollToBottom} /> : null}
          {props.controls ? <div data-testid="scroll-button-visible">{hook.showScrollToBottom ? "1" : "0"}</div> : null}
          {props.controls ? <div data-testid="scroll-mode">{hook.mode}</div> : null}
          {props.controls ? <div data-testid="scroll-at-bottom">{hook.isAtBottom ? "1" : "0"}</div> : null}
          {props.controls ? (
            <button
              data-testid="history-programmatic-scroll"
              onClick={() => {
                controls.runProgrammaticScroll("history-restore", (parent) => {
                  parent.scrollTop -= 100
                })
              }}
            />
          ) : null}
          {props.controls ? (
            <button
              data-testid="history-programmatic-scroll-sync"
              onClick={() => {
                controls.runProgrammaticScroll("history-restore", (parent) => {
                  parent.scrollTop -= 100
                  parent.dispatchEvent(new Event("scroll"))
                })
              }}
            />
          ) : null}
          {props.controls ? (
            <button
              data-testid="history-programmatic-trim"
              onClick={() => {
                controls.runProgrammaticScroll("history-trim", (parent) => {
                  parent.scrollTop += 100
                })
              }}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}

function makeScrollTracker(el: HTMLElement) {
  let count = 0
  let top = 0
  let height = 1000
  let client = 500
  let setting = false
  const clamp = (value: number) => Math.max(0, Math.min(value, Math.max(0, height - client)))

  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    get: () => height,
  })
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    get: () => client,
  })
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = clamp(value)
      if (!setting) count++
    },
  })

  const scrollTo = vi.fn((opts?: ScrollToOptions) => {
    if (opts?.top !== undefined) top = clamp(opts.top)
    count++
  })

  const scrollBy = vi.fn((opts?: ScrollToOptions) => {
    if (opts?.top !== undefined) top = clamp(top + opts.top)
    count++
  })

  Object.defineProperty(el, "scrollTo", {
    configurable: true,
    value: scrollTo,
  })

  Object.defineProperty(el, "scrollBy", {
    configurable: true,
    value: scrollBy,
  })

  return {
    getCount: () => count,
    getTop: () => top,
    reset: () => {
      count = 0
    },
    scrollTo,
    scrollBy,
    setMetrics: (nextHeight: number, nextClient: number, nextTop: number) => {
      setting = true
      height = nextHeight
      client = nextClient
      top = nextTop
      setting = false
    },
    growHeight: (nextHeight: number) => {
      setting = true
      height = nextHeight
      setting = false
    },
  }
}

function textMessage(text: string): Message[] {
  return [
    {
      info: { id: "m1" },
      parts: [{ id: "p-text", type: "text", text }],
    } as Message,
  ]
}

function toolMessage(status: "pending" | "running" | "completed" | "error"): Message[] {
  return [
    {
      info: { id: "m1" },
      parts: [{ id: "p-tool", type: "tool", state: { status } }],
    } as Message,
  ]
}

function userMessage(text: string): Message[] {
  return [
    {
      info: { id: "u1", role: "user" },
      parts: [{ id: "u-text", type: "text", text }],
    } as Message,
  ]
}

describe("useMessageScroll", () => {
  const originalResizeObserver = (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver
  let observers: Array<{ callback: ResizeObserverCallback; nodes: Set<Element>; active: boolean }> = []

  const triggerResize = (node: Element) => {
    for (const item of observers) {
      if (!item.active) continue
      if (!item.nodes.has(node)) continue
      act(() => {
        item.callback([{ target: node } as ResizeObserverEntry], {} as ResizeObserver)
      })
    }
  }

  beforeEach(() => {
    observers = []
    ;(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
      item: { callback: ResizeObserverCallback; nodes: Set<Element>; active: boolean }

      constructor(callback: ResizeObserverCallback) {
        this.item = { callback, nodes: new Set<Element>(), active: true }
        observers.push(this.item)
      }

      disconnect() {
        this.item.active = false
        this.item.nodes.clear()
      }

      observe(node: Element) {
        this.item.nodes.add(node)
      }

      unobserve() {}
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    window.history.replaceState({}, "", "/")
    ;(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = originalResizeObserver
  })

  it("在底部时持续自动滚动，用户离开底部后停止自动滚动", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={true} />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 500)
    triggerResize(tail)
    expect(tracker.getCount()).toBeGreaterThan(0)

    tracker.reset()
    fireEvent.wheel(parent, { deltaY: -100 })
    tracker.setMetrics(1000, 500, 400)
    fireEvent.scroll(parent)
    triggerResize(tail)
    expect(tracker.getCount()).toBe(0)

    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)
    triggerResize(tail)
    expect(tracker.getCount()).toBeGreaterThan(0)
  })

  it("滚动容器延迟挂载后仍会绑定滚动与自动跟随监听", () => {
    const { rerender, getByTestId } = render(
      <Harness
        sessionID="s1"
        sortedMessages={textMessage("a")}
        isIdle={false}
        isReasoning={false}
        controls
        showContainer={false}
      />,
    )

    const parent = getByTestId("scroll-parent")
    const tracker = makeScrollTracker(parent)

    rerender(
      <Harness
        sessionID="s1"
        sortedMessages={textMessage("a")}
        isIdle={false}
        isReasoning={false}
        controls
        showContainer
      />,
    )

    const tail = getByTestId("tail-box")
    tracker.reset()
    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)
    triggerResize(tail)
    expect(tracker.getCount()).toBeGreaterThan(0)

    tracker.reset()
    fireEvent.wheel(parent, { deltaY: -100 })
    tracker.setMetrics(1000, 500, 200)
    fireEvent.scroll(parent)
    triggerResize(tail)
    expect(tracker.getCount()).toBe(0)
    expect(getByTestId("scroll-button-visible").textContent).toBe("1")
  })

  it("工具状态变化时，底部状态应继续触发自动滚动", () => {
    const { rerender, getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={toolMessage("running")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)
    tracker.reset()

    rerender(<Harness sessionID="s1" sortedMessages={toolMessage("completed")} isIdle={false} isReasoning={false} />)
    expect(tracker.getCount()).toBeGreaterThan(0)
  })

  it("工具展开后的布局抖动导致 scrollTop 瞬间变小时仍保持自动跟随", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={toolMessage("running")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1200, 500, 700)
    fireEvent.scroll(parent)
    triggerResize(tail)
    expect(tracker.getTop()).toBe(700)
    tracker.reset()

    tracker.setMetrics(1200, 500, 650)
    fireEvent.scroll(parent)
    triggerResize(tail)

    expect(tracker.getTop()).toBe(700)
    expect(getByTestId("scroll-mode").textContent).toBe("following")
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
  })

  it("following 时 history 区深层内容增长也会继续贴到底部", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const shell = getByTestId("message-scroll-container")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)
    tracker.reset()

    tracker.growHeight(1060)
    triggerResize(shell)

    expect(tracker.getTop()).toBe(560)
    expect(getByTestId("scroll-mode").textContent).toBe("following")
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
  })

  it("手动快速回底过程中不会让到底按钮闪回显示", () => {
    vi.useFakeTimers()

    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 400)
    fireEvent.scroll(parent)
    expect(getByTestId("scroll-button-visible").textContent).toBe("1")

    fireEvent.click(getByTestId("scroll-button"))

    expect(tracker.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "auto" })
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")

    tracker.setMetrics(1000, 500, 460)
    fireEvent.scroll(parent)
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
  })

  it("button-seek 不再创建额外的固定延迟收尾 timer", () => {
    vi.useFakeTimers()

    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 400)
    fireEvent.scroll(parent)
    fireEvent.click(getByTestId("scroll-button"))

    expect(vi.getTimerCount()).toBe(1)
  })

  it("button-seek 后若整体布局继续增长 24px，会通过 shell resize 立即校准到底部", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const shell = getByTestId("message-scroll-container")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 0)
    fireEvent.scroll(parent)
    fireEvent.click(getByTestId("scroll-button"))
    tracker.setMetrics(1024, 500, 500)
    triggerResize(shell)

    expect(tracker.getTop()).toBe(524)
    tracker.setMetrics(1024, 500, 524)
    fireEvent.scroll(parent)
    expect(getByTestId("scroll-mode").textContent).toBe("following")
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
  })

  it("button-seek 首次到达底部后仍会响应随后 24px shell 布局增长", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const shell = getByTestId("message-scroll-container")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 0)
    fireEvent.scroll(parent)
    fireEvent.click(getByTestId("scroll-button"))
    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)
    tracker.setMetrics(1024, 500, 500)
    triggerResize(shell)

    expect(tracker.getTop()).toBe(524)
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
  })

  it("button-seek 到底后即使中间有一次布局收缩 scroll，也会响应后续 shell 增长", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const shell = getByTestId("message-scroll-container")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 0)
    fireEvent.scroll(parent)
    fireEvent.click(getByTestId("scroll-button"))
    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)
    tracker.setMetrics(976, 500, 476)
    fireEvent.scroll(parent)
    tracker.setMetrics(1000, 500, 476)
    triggerResize(shell)

    expect(tracker.getTop()).toBe(500)
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
  })

  it("手动快速回底期间用户再次上滑后会停止后续自动跟随", () => {
    vi.useFakeTimers()

    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 400)
    fireEvent.scroll(parent)
    fireEvent.click(getByTestId("scroll-button"))
    tracker.reset()

    fireEvent.wheel(parent, { deltaY: -100 })
    tracker.setMetrics(1000, 500, 200)
    fireEvent.scroll(parent)
    triggerResize(tail)

    expect(tracker.getCount()).toBe(0)
  })

  it("seeking 期间用户用滚动条或键盘离底后不会被 button-seek 反弹到底部", () => {
    vi.useFakeTimers()

    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 400)
    fireEvent.scroll(parent)
    fireEvent.click(getByTestId("scroll-button"))
    tracker.reset()

    fireEvent.wheel(parent, { deltaY: -100 })
    tracker.setMetrics(1000, 500, 200)
    fireEvent.scroll(parent)
    tracker.growHeight(1400)
    triggerResize(tail)

    expect(tracker.getCount()).toBe(0)
    expect(getByTestId("scroll-button-visible").textContent).toBe("1")
  })

  it("button-seek 在 tail 持续增长时会继续追到底部并最终恢复 following", () => {
    vi.useFakeTimers()

    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 200)
    fireEvent.scroll(parent)
    expect(getByTestId("scroll-mode").textContent).toBe("detached")
    expect(getByTestId("scroll-button-visible").textContent).toBe("1")

    fireEvent.click(getByTestId("scroll-button"))
    expect(getByTestId("scroll-mode").textContent).toBe("seeking")
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
    expect(tracker.scrollTo).toHaveBeenLastCalledWith({ top: 1000, behavior: "auto" })

    tracker.growHeight(1400)
    triggerResize(tail)

    expect(tracker.scrollTo).toHaveBeenLastCalledWith({ top: 1400, behavior: "auto" })
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")

    tracker.setMetrics(1400, 500, 900)
    fireEvent.scroll(parent)

    expect(getByTestId("scroll-at-bottom").textContent).toBe("1")
    expect(getByTestId("scroll-mode").textContent).toBe("following")

    tracker.reset()
    tracker.growHeight(1600)
    triggerResize(tail)

    expect(tracker.getCount()).toBeGreaterThan(0)
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
  })

  it("button-seek 后多次整体布局增长会通过 shell resize 立即追到底部", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const shell = getByTestId("message-scroll-container")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 200)
    fireEvent.scroll(parent)
    fireEvent.click(getByTestId("scroll-button"))
    expect(getByTestId("scroll-mode").textContent).toBe("seeking")

    tracker.growHeight(1060)
    triggerResize(shell)
    expect(tracker.scrollTo).toHaveBeenLastCalledWith({ top: 1060, behavior: "auto" })

    tracker.setMetrics(1060, 500, 560)
    fireEvent.scroll(parent)
    tracker.scrollTo.mockClear()

    tracker.growHeight(1120)
    triggerResize(shell)
    expect(tracker.getTop()).toBe(620)
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
  })

  it("button-seek 遇到尺寸变化触发 scroll 时不会丢失 seeking 语义", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 200)
    fireEvent.scroll(parent)
    fireEvent.click(getByTestId("scroll-button"))
    expect(getByTestId("scroll-mode").textContent).toBe("seeking")

    tracker.reset()
    tracker.setMetrics(1400, 500, 300)
    fireEvent.scroll(parent)

    expect(getByTestId("scroll-mode").textContent).toBe("seeking")
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
    expect(tracker.scrollTo).toHaveBeenLastCalledWith({ top: 1400, behavior: "auto" })
  })

  it("button-seek 期间键盘上滚伴随尺寸变化时不会被重新吸到底部", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 200)
    fireEvent.scroll(parent)
    fireEvent.click(getByTestId("scroll-button"))
    tracker.reset()
    tracker.scrollTo.mockClear()

    fireEvent.keyDown(window, { key: "PageUp" })
    tracker.setMetrics(1400, 500, 300)
    fireEvent.scroll(parent)
    triggerResize(tail)

    expect(getByTestId("scroll-mode").textContent).toBe("detached")
    expect(getByTestId("scroll-button-visible").textContent).toBe("1")
    expect(tracker.scrollTo).not.toHaveBeenCalled()
  })

  it("button-seek 期间滚动条拖拽意图伴随尺寸变化时不会被重新吸到底部", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      top: 0,
      left: 0,
      right: 500,
      bottom: 500,
      toJSON: () => ({}),
    })

    tracker.setMetrics(1000, 500, 200)
    fireEvent.scroll(parent)
    fireEvent.click(getByTestId("scroll-button"))
    tracker.reset()
    tracker.scrollTo.mockClear()

    fireEvent.pointerDown(parent, { clientX: 492, clientY: 120 })
    tracker.setMetrics(1400, 500, 300)
    fireEvent.scroll(parent)
    triggerResize(tail)

    expect(getByTestId("scroll-mode").textContent).toBe("detached")
    expect(getByTestId("scroll-button-visible").textContent).toBe("1")
    expect(tracker.scrollTo).not.toHaveBeenCalled()
  })

  it("history restore 后用户立即通过普通 scroll 离底不会反弹到底部", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)
    fireEvent.click(getByTestId("history-programmatic-scroll"))
    tracker.reset()

    tracker.setMetrics(1000, 500, 200)
    fireEvent.scroll(parent)
    triggerResize(tail)

    expect(tracker.getCount()).toBe(0)
    expect(getByTestId("scroll-button-visible").textContent).toBe("1")
  })

  it("history restore 遇到尺寸变化时也不会被新的 auto-follow 抢回底部", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)
    fireEvent.click(getByTestId("history-programmatic-scroll"))
    tracker.reset()

    tracker.setMetrics(1200, 500, 200)
    fireEvent.scroll(parent)

    expect(tracker.getCount()).toBe(0)
    expect(getByTestId("scroll-button-visible").textContent).toBe("1")
  })

  it("稳定优先模式下 following 即使上次快照已离底，非用户尺寸变化仍拉到底部", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)
    fireEvent.click(getByTestId("history-programmatic-scroll-sync"))
    expect(getByTestId("scroll-mode").textContent).toBe("following")
    expect(getByTestId("scroll-at-bottom").textContent).toBe("0")
    tracker.reset()

    tracker.growHeight(1200)
    triggerResize(tail)

    expect(tracker.getTop()).toBe(700)
    expect(getByTestId("scroll-mode").textContent).toBe("following")
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
  })

  it("runProgrammaticScroll 回调内同步触发 scroll 也不会误判 detached", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)

    fireEvent.click(getByTestId("history-programmatic-scroll-sync"))
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
    expect(getByTestId("scroll-mode").textContent).toBe("following")

    tracker.reset()
    tracker.setMetrics(1000, 500, 200)
    fireEvent.scroll(parent)
    triggerResize(tail)

    expect(tracker.getCount()).toBe(0)
    expect(getByTestId("scroll-button-visible").textContent).toBe("1")
    expect(getByTestId("scroll-mode").textContent).toBe("detached")
  })

  it("history trim 后用户立即通过普通 scroll 离底不会反弹到底部", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 400)
    fireEvent.scroll(parent)
    fireEvent.click(getByTestId("history-programmatic-trim"))
    tracker.reset()

    tracker.setMetrics(1000, 500, 150)
    fireEvent.scroll(parent)
    triggerResize(tail)

    expect(tracker.getCount()).toBe(0)
    expect(getByTestId("scroll-button-visible").textContent).toBe("1")
  })

  it("history trim 遇到尺寸变化时也不会被新的 auto-follow 抢回底部", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 400)
    fireEvent.scroll(parent)
    fireEvent.click(getByTestId("history-programmatic-trim"))
    tracker.reset()

    tracker.setMetrics(1200, 500, 150)
    fireEvent.scroll(parent)

    expect(tracker.getCount()).toBe(0)
    expect(getByTestId("scroll-button-visible").textContent).toBe("1")
  })

  it("jcef-wheel 后用户立即通过普通 scroll 离底不会反弹到底部", () => {
    window.history.replaceState({}, "", "?jcefScrollMultiplier=4")

    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 476)
    fireEvent.scroll(parent)
    fireEvent.wheel(parent, { deltaY: 10, deltaMode: 0 })
    tracker.reset()

    tracker.setMetrics(1000, 500, 200)
    fireEvent.scroll(parent)
    triggerResize(tail)

    expect(tracker.scrollBy).toHaveBeenCalledWith({ top: 40, behavior: "auto" })
    expect(tracker.getCount()).toBe(0)
    expect(getByTestId("scroll-button-visible").textContent).toBe("1")
  })

  it("jcef-wheel 遇到尺寸变化时也不会被新的 auto-follow 抢回底部", () => {
    window.history.replaceState({}, "", "?jcefScrollMultiplier=4")

    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 476)
    fireEvent.scroll(parent)
    fireEvent.wheel(parent, { deltaY: 10, deltaMode: 0 })
    tracker.reset()

    tracker.setMetrics(1200, 500, 200)
    fireEvent.scroll(parent)

    expect(tracker.scrollBy).toHaveBeenCalledWith({ top: 40, behavior: "auto" })
    expect(tracker.getCount()).toBe(0)
    expect(getByTestId("scroll-button-visible").textContent).toBe("1")
  })

  it("scrollbar 拖拽或键盘滚动离开底部后停止自动滚动", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 500)
    triggerResize(tail)
    tracker.reset()

    fireEvent.wheel(parent, { deltaY: -100 })
    tracker.setMetrics(1000, 500, 200)
    fireEvent.scroll(parent)
    triggerResize(tail)
    expect(tracker.getCount()).toBe(0)

    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)
    triggerResize(tail)
    expect(tracker.getCount()).toBeGreaterThan(0)
  })

  it("键盘上滚意图伴随内容尺寸变化时不会被自动跟随抢回底部", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)
    tracker.reset()

    fireEvent.keyDown(window, { key: "PageUp" })
    tracker.setMetrics(1200, 500, 450)
    fireEvent.scroll(parent)
    triggerResize(tail)

    expect(tracker.getCount()).toBe(0)
    expect(getByTestId("scroll-mode").textContent).toBe("detached")
    expect(getByTestId("scroll-button-visible").textContent).toBe("1")
  })

  it("滚动条拖拽意图伴随内容尺寸变化时不会被自动跟随抢回底部", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      width: 500,
      height: 500,
      top: 0,
      left: 0,
      right: 500,
      bottom: 500,
      toJSON: () => ({}),
    })
    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)
    tracker.reset()

    fireEvent.pointerDown(parent, { clientX: 492, clientY: 120 })
    tracker.setMetrics(1200, 500, 450)
    fireEvent.scroll(parent)
    triggerResize(tail)

    expect(tracker.getCount()).toBe(0)
    expect(getByTestId("scroll-mode").textContent).toBe("detached")
    expect(getByTestId("scroll-button-visible").textContent).toBe("1")
  })

  it("微小 wheel delta 不应触发离底锁定", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)
    tracker.reset()

    fireEvent.wheel(parent, { deltaY: -1 })
    triggerResize(tail)
    expect(tracker.getCount()).toBeGreaterThan(0)
  })

  it("JetBrains 传入 jcefScrollMultiplier 时应放大主消息区滚轮位移", () => {
    window.history.replaceState({}, "", "?jcefScrollMultiplier=4")

    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    const scrollBy = vi.fn()

    Object.defineProperty(parent, "scrollBy", {
      configurable: true,
      value: scrollBy,
    })

    fireEvent.wheel(parent, { deltaY: 10, deltaMode: 0 })
    expect(scrollBy).toHaveBeenCalledWith({ top: 40, behavior: "auto" })
  })

  it("切换 session 后会立即跳到底部", () => {
    const { rerender, getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    const tracker = makeScrollTracker(parent)

    fireEvent.wheel(parent, { deltaY: -100 })
    tracker.setMetrics(1000, 500, 300)
    fireEvent.scroll(parent)
    tracker.reset()

    rerender(<Harness sessionID="s2" sortedMessages={textMessage("b")} isIdle={false} isReasoning={false} settling />)
    expect(tracker.getTop()).toBe(500)
  })

  it("切换 session 时容器稍后挂载也会在稳定期内跳到底部", () => {
    const { rerender, getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    const tracker = makeScrollTracker(parent)

    fireEvent.wheel(parent, { deltaY: -100 })
    tracker.setMetrics(1000, 500, 300)
    fireEvent.scroll(parent)
    tracker.reset()

    rerender(
      <Harness
        sessionID="s2"
        sortedMessages={textMessage("b")}
        isIdle={false}
        isReasoning={false}
        settling
        showContainer={false}
      />,
    )
    rerender(<Harness sessionID="s2" sortedMessages={textMessage("b")} isIdle={false} isReasoning={false} settling />)

    expect(tracker.getTop()).toBe(500)
  })

  it("用户发送新消息时即使 tail 长度不变也会强制回到底部", () => {
    const { rerender, getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    const tracker = makeScrollTracker(parent)

    fireEvent.wheel(parent, { deltaY: -100 })
    tracker.setMetrics(1200, 500, 200)
    fireEvent.scroll(parent)
    tracker.reset()

    rerender(<Harness sessionID="s1" sortedMessages={userMessage("hi")} isIdle={false} isReasoning={false} />)
    expect(tracker.getCount()).toBeGreaterThan(0)
  })

  it("外部发送意图变化时使用立即发送语义滚到底部", () => {
    const { rerender, getByTestId } = render(
      <Harness
        sessionID="s1"
        sortedMessages={textMessage("a")}
        isIdle={false}
        isReasoning={false}
        sendRequestKey={0}
      />,
    )

    const parent = getByTestId("scroll-parent")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1200, 500, 300)
    fireEvent.scroll(parent)
    tracker.reset()

    rerender(
      <Harness
        sessionID="s1"
        sortedMessages={textMessage("a")}
        isIdle={false}
        isReasoning={false}
        sendRequestKey={1}
      />,
    )

    expect(tracker.getTop()).toBe(700)
    expect(tracker.scrollTo).not.toHaveBeenCalled()
  })

  it("发送后思考态布局抖动导致 scrollTop 瞬间变小时仍保持自动跟随", () => {
    const { rerender, getByTestId } = render(
      <Harness
        sessionID="s1"
        sortedMessages={textMessage("a")}
        isIdle={false}
        isReasoning={false}
        sendRequestKey={0}
        controls
      />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1200, 500, 300)
    fireEvent.scroll(parent)
    rerender(
      <Harness
        sessionID="s1"
        sortedMessages={textMessage("a")}
        isIdle={false}
        isReasoning={false}
        sendRequestKey={1}
        controls
      />,
    )
    expect(tracker.getTop()).toBe(700)
    tracker.reset()

    tracker.setMetrics(1200, 500, 650)
    fireEvent.scroll(parent)
    triggerResize(tail)

    expect(tracker.getTop()).toBe(700)
    expect(getByTestId("scroll-mode").textContent).toBe("following")
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
  })

  it("离开底部一点点也应显示滚动到底部按钮", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")

    tracker.setMetrics(1000, 500, 470)
    fireEvent.scroll(parent)
    expect(getByTestId("scroll-button-visible").textContent).toBe("1")
  })

  it("内容自动展开导致高度增长但 scrollTop 未上移时，仍保持自动跟随", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 500)
    triggerResize(tail)
    tracker.reset()

    tracker.setMetrics(1200, 500, 500)
    fireEvent.scroll(parent)
    triggerResize(tail)
    expect(tracker.getCount()).toBeGreaterThan(0)
  })

  it("贴底时内容自动展开即使 scrollTop 被布局抖动顶小，仍保持自动跟随", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)
    tracker.reset()

    tracker.setMetrics(1200, 500, 450)
    fireEvent.scroll(parent)
    triggerResize(tail)

    expect(tracker.getCount()).toBeGreaterThan(0)
    expect(tracker.getTop()).toBe(700)
    expect(getByTestId("scroll-mode").textContent).toBe("following")
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
  })

  it("贴底时上方已展开工具或思考块自动折叠导致高度收缩，仍保持自动跟随", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(6168, 874, 5294)
    fireEvent.scroll(parent)
    tracker.reset()

    tracker.setMetrics(5497, 874, 3896)
    fireEvent.scroll(parent)

    expect(tracker.getTop()).toBe(4623)
    expect(getByTestId("scroll-mode").textContent).toBe("following")
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
  })

  it("AI 一次返回大块内容时，following 不会被误判为 detached，按钮不闪现", () => {
    const { rerender, getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")

    tracker.reset()
    tracker.growHeight(1800)
    rerender(
      <Harness
        sessionID="s1"
        sortedMessages={textMessage("a".repeat(4000))}
        isIdle={false}
        isReasoning={false}
        controls
      />,
    )
    triggerResize(tail)

    expect(tracker.getCount()).toBeGreaterThan(0)
    expect(tracker.getTop()).toBe(1300)
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
  })

  it("AI 输出过程中用户离底后，后续输出不会反弹到底部", () => {
    const { rerender, getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("streaming")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1200, 500, 700)
    fireEvent.scroll(parent)
    tracker.reset()

    tracker.setMetrics(1200, 500, 300)
    fireEvent.scroll(parent)
    expect(getByTestId("scroll-button-visible").textContent).toBe("1")

    tracker.growHeight(1800)
    rerender(
      <Harness
        sessionID="s1"
        sortedMessages={textMessage("streaming".repeat(500))}
        isIdle={false}
        isReasoning={false}
        controls
      />,
    )
    triggerResize(tail)

    expect(tracker.getCount()).toBe(0)
    expect(getByTestId("scroll-button-visible").textContent).toBe("1")
  })

  it("此前视口已不在底部时，后续内容增长不应继续保留 following 并拉回底部", () => {
    vi.useFakeTimers()

    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("streaming")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)

    fireEvent.click(getByTestId("history-programmatic-scroll"))
    expect(getByTestId("scroll-mode").textContent).toBe("following")
    expect(getByTestId("scroll-at-bottom").textContent).toBe("0")

    act(() => {
      vi.advanceTimersByTime(900)
    })
    tracker.reset()

    tracker.growHeight(1300)
    fireEvent.scroll(parent)
    triggerResize(tail)

    expect(tracker.getCount()).toBe(0)
    expect(getByTestId("scroll-mode").textContent).toBe("detached")
    expect(getByTestId("scroll-button-visible").textContent).toBe("1")
  })

  it("稳定优先模式下，此前非用户程序滚动造成的离底会在 ResizeObserver 内容增长时拉回底部", () => {
    vi.useFakeTimers()

    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("streaming")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)
    fireEvent.click(getByTestId("history-programmatic-scroll"))
    expect(getByTestId("scroll-mode").textContent).toBe("following")
    expect(getByTestId("scroll-at-bottom").textContent).toBe("0")

    act(() => {
      vi.advanceTimersByTime(900)
    })
    tracker.reset()

    tracker.growHeight(1300)
    triggerResize(tail)

    expect(tracker.getTop()).toBe(800)
    expect(getByTestId("scroll-mode").textContent).toBe("following")
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
  })

  it("稳定优先模式下，此前非用户程序滚动造成的离底会在 fallback 内容增长时拉回底部", () => {
    vi.useFakeTimers()
    ;(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = undefined

    const { rerender, getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("streaming")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)
    fireEvent.click(getByTestId("history-programmatic-scroll"))
    expect(getByTestId("scroll-mode").textContent).toBe("following")
    expect(getByTestId("scroll-at-bottom").textContent).toBe("0")

    act(() => {
      vi.advanceTimersByTime(900)
    })
    tracker.reset()

    tracker.growHeight(1300)
    rerender(
      <Harness
        sessionID="s1"
        sortedMessages={textMessage("streaming".repeat(50))}
        isIdle={false}
        isReasoning={false}
        controls
      />,
    )

    expect(tracker.getTop()).toBe(800)
    expect(getByTestId("scroll-mode").textContent).toBe("following")
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
  })

  it("history 区高度变化不触发自动滚动，但 tail 区变化会触发", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    const history = getByTestId("history-box")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 500)
    triggerResize(tail)
    tracker.reset()

    triggerResize(history)
    expect(tracker.getCount()).toBe(0)

    triggerResize(tail)
    expect(tracker.getCount()).toBeGreaterThan(0)
  })

  it("滚动容器高度变化时会重算贴底并保持到底部", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 500)
    triggerResize(tail)
    tracker.reset()

    tracker.setMetrics(1000, 400, 500)
    triggerResize(parent)
    expect(tracker.getCount()).toBeGreaterThan(0)
  })

  it("贴底判定基于 scrollHeight-clientHeight-scrollTop，dist<=24 认为在底部", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 476)
    fireEvent.scroll(parent)
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")

    tracker.setMetrics(1000, 500, 475)
    fireEvent.scroll(parent)
    expect(getByTestId("scroll-button-visible").textContent).toBe("1")
  })

  it("接近底部时会校准到物理最底部，避免残留 1-5px 距离", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 496)
    fireEvent.scroll(parent)

    expect(tracker.getTop()).toBe(500)
    expect(getByTestId("scroll-mode").textContent).toBe("following")
    expect(getByTestId("scroll-at-bottom").textContent).toBe("1")
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
  })

  it("接近底部但超过回弹校准范围时不会强制吸回，避免吞掉用户小幅上滑", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 480)
    fireEvent.scroll(parent)

    expect(tracker.getTop()).toBe(480)
    expect(getByTestId("scroll-mode").textContent).toBe("following")
    expect(getByTestId("scroll-at-bottom").textContent).toBe("1")
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
  })

  it("用户已离开底部时，顶部 prepend 历史不会强制跳到底部", () => {
    const { rerender, getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    const tracker = makeScrollTracker(parent)

    fireEvent.wheel(parent, { deltaY: -100 })
    tracker.setMetrics(1200, 500, 200)
    fireEvent.scroll(parent)
    tracker.reset()

    rerender(
      <Harness
        sessionID="s1"
        sortedMessages={[
          { info: { id: "m0" }, parts: [{ id: "p0", type: "text", text: "older" }] } as Message,
          ...textMessage("a"),
        ]}
        isIdle={false}
        isReasoning={false}
      />,
    )

    expect(tracker.getCount()).toBe(0)
  })

  it("稳定期内不会自动滚动，结束后只做一次 auto 校正", () => {
    const { rerender, getByTestId } = render(
      <Harness sessionID="s2" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} settling />,
    )

    const parent = getByTestId("scroll-parent")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1300, 500, 500)
    triggerResize(tail)
    rerender(<Harness sessionID="s2" sortedMessages={textMessage("ab")} isIdle={false} isReasoning={false} settling />)
    expect(tracker.getCount()).toBe(0)

    rerender(<Harness sessionID="s2" sortedMessages={textMessage("ab")} isIdle={false} isReasoning={false} />)
    expect(tracker.getCount()).toBe(1)
  })

  it("稳定期内发生 shell 尺寸变化时，稳定结束后会补一次贴底", () => {
    const { rerender, getByTestId } = render(
      <Harness sessionID="s2" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} settling controls />,
    )

    const parent = getByTestId("scroll-parent")
    const shell = getByTestId("message-scroll-container")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1300, 500, 800)
    fireEvent.scroll(parent)
    tracker.reset()

    tracker.growHeight(1380)
    triggerResize(shell)
    expect(tracker.getCount()).toBe(0)

    rerender(<Harness sessionID="s2" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />)

    expect(tracker.getTop()).toBe(880)
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
  })

  it("没有 ResizeObserver 时仍保留基础 tail 贴底语义", () => {
    ;(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = undefined

    const { rerender, getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)
    tracker.reset()

    rerender(<Harness sessionID="s1" sortedMessages={textMessage("ab")} isIdle={false} isReasoning={false} />)
    expect(tracker.getCount()).toBeGreaterThan(0)
  })

  it("没有 ResizeObserver 时，tail-only 变化也会保持基础贴底", () => {
    ;(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = undefined

    const { rerender, getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} tailKey="tail:m1" />,
    )

    const parent = getByTestId("scroll-parent")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)
    tracker.reset()

    rerender(
      <Harness
        sessionID="s1"
        sortedMessages={textMessage("a")}
        isIdle={false}
        isReasoning={false}
        tailKey="tail:m1,question:q1"
      />,
    )

    expect(tracker.getCount()).toBeGreaterThan(0)
  })

  it("history restore 的程序滚动本身不会立即让 following 误入 detached", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} controls />,
    )

    const parent = getByTestId("scroll-parent")
    const tracker = makeScrollTracker(parent)

    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)
    fireEvent.click(getByTestId("history-programmatic-scroll"))
    fireEvent.scroll(parent)

    expect(getByTestId("scroll-mode").textContent).toBe("following")
    expect(getByTestId("scroll-at-bottom").textContent).toBe("0")
    expect(getByTestId("scroll-button-visible").textContent).toBe("0")
  })

  it("嵌套可滚动区域内的 wheel 上滑不标记主消息区 userScrolled", () => {
    const { getByTestId } = render(
      <Harness sessionID="s1" sortedMessages={textMessage("a")} isIdle={false} isReasoning={false} />,
    )

    const parent = getByTestId("scroll-parent")
    const box = getByTestId("message-scroll-container")
    const tail = getByTestId("tail-box")
    const tracker = makeScrollTracker(parent)
    const nested = document.createElement("div")

    Object.defineProperty(nested, "scrollHeight", { configurable: true, value: 400 })
    Object.defineProperty(nested, "clientHeight", { configurable: true, value: 100 })
    nested.style.overflowY = "auto"
    box.appendChild(nested)

    tracker.setMetrics(1000, 500, 500)
    fireEvent.scroll(parent)
    tracker.reset()

    fireEvent.wheel(nested, { deltaY: -50 })
    triggerResize(tail)
    expect(tracker.getCount()).toBeGreaterThan(0)
  })
})
