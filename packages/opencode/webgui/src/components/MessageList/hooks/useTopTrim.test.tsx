import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useRef } from "react"
import { useTopTrim } from "./useTopTrim"

let resize: Array<{ cb: ResizeObserverCallback; nodes: Set<Element> }> = []

function triggerResize(node: Element) {
  act(() => {
    for (const item of resize) {
      if (!item.nodes.has(node)) continue
      item.cb([{ target: node } as ResizeObserverEntry], {} as ResizeObserver)
    }
  })
}

function Harness(props: {
  sessionID?: string | null
  ids: string[]
  all?: string[]
  tailIds?: string[]
  box?: Record<string, { top: number; height: number }>
  paused?: boolean
  loading?: boolean
  preserveScrollAnchor?: boolean
  runProgrammaticScroll?: (cause: "history-restore" | "history-trim", fn: (parent: HTMLElement) => void) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const top = useTopTrim({
    sessionID: props.sessionID,
    items: props.ids.map((id) => ({ id })),
    ids: props.all,
    paused: props.paused ?? false,
    ref,
    loading: props.loading,
    preserveScrollAnchor: props.preserveScrollAnchor,
    runProgrammaticScroll: props.runProgrammaticScroll,
  } as any)
  const api = top as typeof top & { preparePrepend?: () => void; cancelPrepend?: () => void }

  return (
    <div data-testid="scroll-parent">
      <div ref={ref}>
        <button data-testid="prepare-prepend" onClick={() => api.preparePrepend?.()} />
        <button data-testid="cancel-prepend" onClick={() => api.cancelPrepend?.()} />
        <div ref={top.topRef} />
        <div data-testid="top-space" style={{ height: `${top.top}px` }} />
        {top.visible.map((item: { id: string }) => (
          <div
            key={item.id}
            ref={(node) => {
              if (node && props.box?.[item.id]) setBox(node, props.box[item.id])
              top.row(item.id)(node)
            }}
            data-testid="row"
          >
            {item.id}
          </div>
        ))}
        {props.tailIds?.map((id) => (
          <div
            key={id}
            ref={(node) => {
              if (node && props.box?.[id]) setBox(node, props.box[id])
              top.row(id)(node)
            }}
            data-testid="tail-row"
          >
            {id}
          </div>
        ))}
        <div data-testid="bottom">bottom</div>
      </div>
    </div>
  )
}

function setBox(node: HTMLElement, box: { top?: number; height?: number }) {
  node.style.height = `${box.height ?? 100}px`
  Object.defineProperty(node, "offsetHeight", {
    configurable: true,
    value: box.height ?? 100,
  })
  node.getBoundingClientRect = vi.fn(() => ({
    x: 0,
    y: box.top ?? 0,
    top: box.top ?? 0,
    left: 0,
    right: 0,
    bottom: (box.top ?? 0) + (box.height ?? 100),
    width: 0,
    height: box.height ?? 100,
    toJSON: () => ({}),
  }))
}

function setScroll(node: HTMLElement, box: { top: number; height: number; client: number }) {
  Object.defineProperty(node, "scrollTop", {
    configurable: true,
    writable: true,
    value: box.top,
  })
  Object.defineProperty(node, "scrollHeight", {
    configurable: true,
    value: box.height,
  })
  Object.defineProperty(node, "clientHeight", {
    configurable: true,
    value: box.client,
  })
}

describe("useTopTrim", () => {
  beforeEach(() => {
    resize = []
    ;(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
      item: { cb: ResizeObserverCallback; nodes: Set<Element> }
      constructor(cb: ResizeObserverCallback) {
        this.item = { cb, nodes: new Set<Element>() }
        resize.push(this.item)
      }
      disconnect() {}
      observe(node: Element) {
        this.item.nodes.add(node)
      }
      unobserve() {}
    }
  })

  it("prepend 历史后按锚点补偿而不是按总高度差补偿", async () => {
    const view = render(
      <Harness
        sessionID="s1"
        ids={["m3", "m4"]}
        box={{
          m3: { top: 50, height: 100 },
          m4: { top: 150, height: 100 },
        }}
      />,
    )
    const parent = view.getByTestId("scroll-parent")
    setScroll(parent, { top: 20, height: 200, client: 100 })

    fireEvent.click(view.getByTestId("prepare-prepend"))

    setScroll(parent, { top: 20, height: 450, client: 100 })
    view.rerender(
      <Harness
        sessionID="s1"
        ids={["m1", "m2", "m3", "m4"]}
        box={{
          m1: { top: 50, height: 100 },
          m2: { top: 150, height: 100 },
          m3: { top: 250, height: 100 },
          m4: { top: 350, height: 100 },
        }}
      />,
    )

    await waitFor(() => {
      expect(parent.scrollTop).toBe(220)
    })
  })

  it("prepend restore 通过 history-restore programmatic scroll 包裹", async () => {
    let parent: HTMLElement | null = null
    const runProgrammaticScroll = vi.fn(
      (_cause: "history-restore" | "history-trim", fn: (node: HTMLElement) => void) => {
        if (!parent) throw new Error("missing scroll parent")
        fn(parent)
      },
    )
    const view = render(
      <Harness
        sessionID="s1"
        ids={["m3", "m4"]}
        runProgrammaticScroll={runProgrammaticScroll}
        box={{
          m3: { top: 50, height: 100 },
          m4: { top: 150, height: 100 },
        }}
      />,
    )
    parent = view.getByTestId("scroll-parent")
    setScroll(parent, { top: 20, height: 200, client: 100 })

    fireEvent.click(view.getByTestId("prepare-prepend"))

    setScroll(parent, { top: 20, height: 450, client: 100 })
    view.rerender(
      <Harness
        sessionID="s1"
        ids={["m1", "m2", "m3", "m4"]}
        runProgrammaticScroll={runProgrammaticScroll}
        box={{
          m1: { top: 50, height: 100 },
          m2: { top: 150, height: 100 },
          m3: { top: 250, height: 100 },
          m4: { top: 350, height: 100 },
        }}
      />,
    )

    await waitFor(() => {
      expect(parent?.scrollTop).toBe(220)
      expect(runProgrammaticScroll).toHaveBeenCalledWith("history-restore", expect.any(Function))
    })
  })

  it("prepend 恢复在同一帧完成，不等待异步定时器", () => {
    const view = render(
      <Harness
        sessionID="s1"
        ids={["m3", "m4"]}
        box={{
          m3: { top: 50, height: 100 },
          m4: { top: 150, height: 100 },
        }}
      />,
    )
    const parent = view.getByTestId("scroll-parent")
    setScroll(parent, { top: 20, height: 200, client: 100 })

    fireEvent.click(view.getByTestId("prepare-prepend"))

    setScroll(parent, { top: 20, height: 450, client: 100 })
    view.rerender(
      <Harness
        sessionID="s1"
        ids={["m1", "m2", "m3", "m4"]}
        box={{
          m1: { top: 50, height: 100 },
          m2: { top: 150, height: 100 },
          m3: { top: 250, height: 100 },
          m4: { top: 350, height: 100 },
        }}
      />,
    )

    expect(parent.scrollTop).toBe(220)
  })

  it("scroll 不会隐式准备 prepend：不调用 preparePrepend 时 prepend 不恢复锚点", async () => {
    const view = render(
      <Harness
        sessionID="s1"
        ids={["m3", "m4"]}
        box={{
          m3: { top: 50, height: 100 },
          m4: { top: 150, height: 100 },
        }}
      />,
    )
    const parent = view.getByTestId("scroll-parent")
    setScroll(parent, { top: 20, height: 200, client: 100 })

    fireEvent.scroll(parent)

    setScroll(parent, { top: 20, height: 450, client: 100 })
    view.rerender(
      <Harness
        sessionID="s1"
        ids={["m1", "m2", "m3", "m4"]}
        box={{
          m1: { top: 50, height: 100 },
          m2: { top: 150, height: 100 },
          m3: { top: 250, height: 100 },
          m4: { top: 350, height: 100 },
        }}
      />,
    )

    await waitFor(() => {
      expect(parent.scrollTop).toBe(20)
    })
  })

  it("离顶部较远时 trim 顶部 DOM 并留下占位高度", async () => {
    const view = render(<Harness sessionID="s1" ids={["m1", "m2", "m3", "m4", "m5", "m6"]} />)
    const parent = view.getByTestId("scroll-parent")
    setScroll(parent, { top: 520, height: 600, client: 200 })
    for (const row of view.getAllByTestId("row")) {
      setBox(row, { height: 100 })
    }

    fireEvent.scroll(parent)

    await waitFor(() => {
      expect(view.getAllByTestId("row").map((node) => node.textContent)).toEqual(["m4", "m5", "m6"])
      expect(Number.parseFloat(view.getByTestId("top-space").style.height)).toBeGreaterThan(200)
    })
  })

  it("靠近顶部时重新挂回顶部消息", async () => {
    const view = render(<Harness sessionID="s1" ids={["m1", "m2", "m3", "m4", "m5", "m6"]} />)
    const parent = view.getByTestId("scroll-parent")
    setScroll(parent, { top: 520, height: 600, client: 200 })
    for (const row of view.getAllByTestId("row")) {
      setBox(row, { height: 100 })
    }
    fireEvent.scroll(parent)

    setScroll(parent, { top: 40, height: 600, client: 200 })
    fireEvent.scroll(parent)

    await waitFor(() => {
      expect(view.getAllByTestId("row").map((node) => node.textContent)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"])
      expect(view.getByTestId("top-space").style.height).toBe("0px")
    })
  })

  it("trim 边界轻微回摆时不会立刻把顶部消息重新挂回", async () => {
    const view = render(<Harness sessionID="s1" ids={["m1", "m2", "m3", "m4", "m5", "m6"]} />)
    const parent = view.getByTestId("scroll-parent")
    setScroll(parent, { top: 520, height: 600, client: 200 })
    for (const row of view.getAllByTestId("row")) {
      setBox(row, { height: 100 })
    }
    fireEvent.scroll(parent)

    await waitFor(() => {
      expect(view.getAllByTestId("row").map((node) => node.textContent)).toEqual(["m4", "m5", "m6"])
    })

    setScroll(parent, { top: 480, height: 600, client: 200 })
    fireEvent.scroll(parent)

    await waitFor(() => {
      expect(view.getAllByTestId("row").map((node) => node.textContent)).toEqual(["m4", "m5", "m6"])
    })
  })

  it("trim 不会裁掉当前视口到底部的消息", async () => {
    const view = render(<Harness sessionID="s1" ids={["m1", "m2", "m3", "m4", "m5", "m6"]} />)
    const parent = view.getByTestId("scroll-parent")
    setScroll(parent, { top: 250, height: 600, client: 200 })
    for (const row of view.getAllByTestId("row")) {
      setBox(row, { height: 100 })
    }

    fireEvent.scroll(parent)

    await waitFor(() => {
      expect(view.getAllByTestId("row").map((node) => node.textContent)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"])
    })
  })

  it("切换 session 后不会沿用旧会话补偿状态", async () => {
    const view = render(<Harness sessionID="s1" ids={["m3", "m4"]} />)
    const parent = view.getByTestId("scroll-parent")
    setScroll(parent, { top: 20, height: 200, client: 100 })

    fireEvent.click(view.getByTestId("prepare-prepend"))

    setScroll(parent, { top: 20, height: 400, client: 100 })
    view.rerender(<Harness sessionID="s2" ids={["n1", "n2"]} />)

    await waitFor(() => {
      expect(parent.scrollTop).toBe(20)
      expect(view.getByTestId("top-space").style.height).toBe("0px")
      expect(view.getAllByTestId("row").map((node) => node.textContent)).toEqual(["n1", "n2"])
    })
  })

  it("同一 session 历史缩短后不会渲染空 history", async () => {
    const view = render(<Harness sessionID="s1" ids={["m1", "m2", "m3", "m4"]} />)
    const parent = view.getByTestId("scroll-parent")
    setScroll(parent, { top: 430, height: 400, client: 100 })
    for (const row of view.getAllByTestId("row")) {
      setBox(row, { height: 100 })
    }

    fireEvent.scroll(parent)

    await waitFor(() => {
      expect(view.getAllByTestId("row").map((node) => node.textContent)).toEqual(["m3", "m4"])
    })

    view.rerender(<Harness sessionID="s1" ids={["m1"]} />)

    await waitFor(() => {
      expect(view.getAllByTestId("row").map((node) => node.textContent)).toEqual(["m1"])
      expect(view.getByTestId("top-space").style.height).toBe("0px")
    })
  })

  it("preparePrepend 之后若未发生 prepend（例如历史缩短），不会走 restore 锚点补偿", async () => {
    const view = render(
      <Harness
        sessionID="s1"
        ids={["m3", "m4"]}
        all={["m1", "m2", "m3", "m4"]}
        box={{
          m3: { top: 50, height: 100 },
          m4: { top: 150, height: 100 },
        }}
      />,
    )
    const parent = view.getByTestId("scroll-parent")
    setScroll(parent, { top: 20, height: 200, client: 100 })

    fireEvent.click(view.getByTestId("prepare-prepend"))

    view.rerender(
      <Harness
        sessionID="s1"
        ids={["m4"]}
        all={["m1", "m2", "m3", "m4"]}
        box={{
          m4: { top: 80, height: 100 },
        }}
      />,
    )

    await waitFor(() => {
      expect(parent.scrollTop).toBe(20)
    })
  })

  it("preparePrepend 后无关 rerender 不会提前清 pending，后续真正 prepend 仍会 restore", async () => {
    const view = render(
      <Harness
        sessionID="s1"
        ids={["m3", "m4"]}
        loading={false}
        box={{
          m3: { top: 50, height: 100 },
          m4: { top: 150, height: 100 },
        }}
      />,
    )
    const parent = view.getByTestId("scroll-parent")
    setScroll(parent, { top: 20, height: 200, client: 100 })

    fireEvent.click(view.getByTestId("prepare-prepend"))

    // 模拟 olderLoading 等无关状态变更导致的 rerender，但列表内容不变
    view.rerender(
      <Harness
        sessionID="s1"
        ids={["m3", "m4"]}
        loading
        box={{
          m3: { top: 50, height: 100 },
          m4: { top: 150, height: 100 },
        }}
      />,
    )

    setScroll(parent, { top: 20, height: 450, client: 100 })
    view.rerender(
      <Harness
        sessionID="s1"
        ids={["m1", "m2", "m3", "m4"]}
        loading={false}
        box={{
          m1: { top: 50, height: 100 },
          m2: { top: 150, height: 100 },
          m3: { top: 250, height: 100 },
          m4: { top: 350, height: 100 },
        }}
      />,
    )

    await waitFor(() => {
      expect(parent.scrollTop).toBe(220)
    })
  })

  it("请求结束但未发生 prepend 时，pending 会在 loading 结束后清掉，结束前仍抑制补偿", async () => {
    const view = render(
      <Harness
        sessionID="s1"
        ids={["m1", "m2", "m3"]}
        loading={false}
        box={{
          m1: { top: -150, height: 100 },
          m2: { top: -50, height: 100 },
          m3: { top: 50, height: 100 },
        }}
      />,
    )
    const parent = view.getByTestId("scroll-parent")
    parent.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 100,
      width: 0,
      height: 100,
      toJSON: () => ({}),
    }))
    setScroll(parent, { top: 20, height: 300, client: 100 })

    fireEvent.click(view.getByTestId("prepare-prepend"))

    // 请求进行中：loading=true，且列表未 prepend
    view.rerender(
      <Harness
        sessionID="s1"
        ids={["m1", "m2", "m3"]}
        loading
        box={{
          m1: { top: -150, height: 100 },
          m2: { top: -50, height: 100 },
          m3: { top: 50, height: 100 },
        }}
      />,
    )

    // loading 期间：scroll 尝试 snap，但应被 pending 抑制
    fireEvent.scroll(parent)

    // loading 期间：顶部行变高（anchor 仍为 m1），scrollTop 不应变化
    view.rerender(
      <Harness
        sessionID="s1"
        ids={["m1", "m2", "m3"]}
        loading
        box={{
          m1: { top: -150, height: 200 },
          m2: { top: -50, height: 100 },
          m3: { top: 50, height: 100 },
        }}
      />,
    )

    await waitFor(() => expect(parent.scrollTop).toBe(20))

    // 请求结束且未 prepend：loading=false，应清掉 pending
    view.rerender(
      <Harness
        sessionID="s1"
        ids={["m1", "m2", "m3"]}
        loading={false}
        box={{
          m1: { top: -150, height: 200 },
          m2: { top: -50, height: 100 },
          m3: { top: 50, height: 100 },
        }}
      />,
    )

    // 请求结束后：scroll 允许 snap 捕获到 m2，随后 m1 变高应触发 apply
    fireEvent.scroll(parent)

    view.rerender(
      <Harness
        sessionID="s1"
        ids={["m1", "m2", "m3"]}
        loading={false}
        box={{
          m1: { top: -150, height: 300 },
          m2: { top: -50, height: 100 },
          m3: { top: 50, height: 100 },
        }}
      />,
    )

    await waitFor(() => expect(parent.scrollTop).toBe(120))
  })

  it("请求结束但未发生 prepend 时，可显式取消 pending，后续高度变化仍会补偿 scrollTop", async () => {
    const view = render(
      <Harness
        sessionID="s1"
        ids={["m1", "m2", "m3"]}
        box={{
          m1: { top: -150, height: 100 },
          m2: { top: -50, height: 100 },
          m3: { top: 50, height: 100 },
        }}
      />,
    )
    const parent = view.getByTestId("scroll-parent")
    parent.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 100,
      width: 0,
      height: 100,
      toJSON: () => ({}),
    }))
    setScroll(parent, { top: 20, height: 300, client: 100 })

    fireEvent.click(view.getByTestId("prepare-prepend"))
    fireEvent.click(view.getByTestId("cancel-prepend"))

    // 通过 rerender 更新 row 的测量高度，模拟真实的 ResizeObserver/测量变化
    // 同时保持 m1 仍在视口上方（bottom <= base），让 snap 捕获到 m2 作为 anchor
    view.rerender(
      <Harness
        sessionID="s1"
        ids={["m1", "m2", "m3"]}
        box={{
          m1: { top: -250, height: 200 },
          m2: { top: -50, height: 100 },
          m3: { top: 50, height: 100 },
        }}
      />,
    )

    await waitFor(() => {
      expect(parent.scrollTop).toBe(120)
    })
  })

  it("顶部高度补偿通过 history-trim programmatic scroll 包裹", async () => {
    let parent: HTMLElement | null = null
    const runProgrammaticScroll = vi.fn(
      (_cause: "history-restore" | "history-trim", fn: (node: HTMLElement) => void) => {
        if (!parent) throw new Error("missing scroll parent")
        fn(parent)
      },
    )
    const view = render(
      <Harness
        sessionID="s1"
        ids={["m1", "m2", "m3"]}
        runProgrammaticScroll={runProgrammaticScroll}
        box={{
          m1: { top: -150, height: 100 },
          m2: { top: -50, height: 100 },
          m3: { top: 50, height: 100 },
        }}
      />,
    )
    parent = view.getByTestId("scroll-parent")
    parent.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 100,
      width: 0,
      height: 100,
      toJSON: () => ({}),
    }))
    setScroll(parent, { top: 20, height: 300, client: 100 })

    view.rerender(
      <Harness
        sessionID="s1"
        ids={["m1", "m2", "m3"]}
        runProgrammaticScroll={runProgrammaticScroll}
        box={{
          m1: { top: -250, height: 200 },
          m2: { top: -50, height: 100 },
          m3: { top: 50, height: 100 },
        }}
      />,
    )

    await waitFor(() => {
      expect(parent?.scrollTop).toBe(120)
      expect(runProgrammaticScroll).toHaveBeenCalledWith("history-trim", expect.any(Function))
    })
  })

  it("底部跟随模式下历史区高度变化不应再补偿 scrollTop", async () => {
    const view = render(
      <Harness
        sessionID="s1"
        ids={["m1", "m2", "m3"]}
        preserveScrollAnchor={false}
        box={{
          m1: { top: -150, height: 100 },
          m2: { top: -50, height: 100 },
          m3: { top: 50, height: 100 },
        }}
      />,
    )
    const parent = view.getByTestId("scroll-parent")
    parent.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 100,
      width: 0,
      height: 100,
      toJSON: () => ({}),
    }))
    setScroll(parent, { top: 200, height: 300, client: 100 })

    view.rerender(
      <Harness
        sessionID="s1"
        ids={["m1", "m2", "m3"]}
        preserveScrollAnchor={false}
        box={{
          m1: { top: -250, height: 200 },
          m2: { top: -50, height: 100 },
          m3: { top: 50, height: 100 },
        }}
      />,
    )

    await waitFor(() => {
      expect(parent.scrollTop).toBe(200)
    })
  })

  it("手动压缩删掉视口上方历史后，detached 锚点位置仍应保持", async () => {
    const view = render(
      <Harness
        sessionID="s1"
        ids={["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9", "m10"]}
        box={{
          m1: { top: -650, height: 100 },
          m2: { top: -550, height: 100 },
          m3: { top: -450, height: 100 },
          m4: { top: -350, height: 100 },
          m5: { top: -250, height: 100 },
          m6: { top: -150, height: 100 },
          m7: { top: -50, height: 100 },
          m8: { top: 50, height: 100 },
          m9: { top: 150, height: 100 },
          m10: { top: 250, height: 100 },
        }}
      />,
    )
    const parent = view.getByTestId("scroll-parent")
    parent.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 200,
      width: 0,
      height: 200,
      toJSON: () => ({}),
    }))
    setScroll(parent, { top: 620, height: 1000, client: 200 })

    fireEvent.scroll(parent)

    view.rerender(
      <Harness
        sessionID="s1"
        ids={["m7", "m8", "m9", "m10"]}
        box={{
          m7: { top: -620, height: 100 },
          m8: { top: -520, height: 100 },
          m9: { top: -420, height: 100 },
          m10: { top: -320, height: 100 },
        }}
      />,
    )

    await waitFor(() => {
      expect(parent.scrollTop).toBe(50)
    })
  })

  it("滚动容器变高时会回退 trim 窗口", async () => {
    const view = render(<Harness sessionID="s1" ids={["m1", "m2", "m3", "m4", "m5", "m6"]} />)
    const parent = view.getByTestId("scroll-parent")
    setScroll(parent, { top: 520, height: 600, client: 200 })
    for (const row of view.getAllByTestId("row")) {
      setBox(row, { height: 100 })
    }

    fireEvent.scroll(parent)

    await waitFor(() => {
      expect(view.getAllByTestId("row").map((node) => node.textContent)).toEqual(["m4", "m5", "m6"])
    })

    setScroll(parent, { top: 520, height: 600, client: 400 })
    triggerResize(parent)

    await waitFor(() => {
      expect(view.getAllByTestId("row").map((node) => node.textContent)).toEqual(["m2", "m3", "m4", "m5", "m6"])
    })
  })

  it("容器宽度变化时取消旧 trim，避免隐藏历史沿用过期高度", async () => {
    const view = render(<Harness sessionID="s1" ids={["m1", "m2", "m3", "m4", "m5", "m6"]} />)
    const parent = view.getByTestId("scroll-parent")
    Object.defineProperty(parent, "clientWidth", { configurable: true, value: 320 })
    parent.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 320,
      bottom: 100,
      width: 320,
      height: 100,
      toJSON: () => ({}),
    }))
    setScroll(parent, { top: 520, height: 600, client: 200 })
    for (const row of view.getAllByTestId("row")) {
      setBox(row, { height: 100 })
    }

    fireEvent.scroll(parent)

    await waitFor(() => {
      expect(view.getAllByTestId("row").map((node) => node.textContent)).toEqual(["m4", "m5", "m6"])
    })

    Object.defineProperty(parent, "clientWidth", { configurable: true, value: 480 })
    parent.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 480,
      bottom: 100,
      width: 480,
      height: 100,
      toJSON: () => ({}),
    }))
    triggerResize(parent)

    await waitFor(() => {
      expect(view.getAllByTestId("row").map((node) => node.textContent)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"])
    })
  })

  it("没有 ResizeObserver 时，下一次滚动也会取消旧 trim，避免沿用过期宽度", async () => {
    ;(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = undefined
    const view = render(<Harness sessionID="s1" ids={["m1", "m2", "m3", "m4", "m5", "m6"]} />)
    const parent = view.getByTestId("scroll-parent")
    Object.defineProperty(parent, "clientWidth", { configurable: true, value: 320 })
    parent.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 320,
      bottom: 100,
      width: 320,
      height: 100,
      toJSON: () => ({}),
    }))
    setScroll(parent, { top: 520, height: 600, client: 200 })
    for (const row of view.getAllByTestId("row")) {
      setBox(row, { height: 100 })
    }

    fireEvent.scroll(parent)

    await waitFor(() => {
      expect(view.getAllByTestId("row").map((node) => node.textContent)).toEqual(["m4", "m5", "m6"])
    })

    Object.defineProperty(parent, "clientWidth", { configurable: true, value: 480 })
    parent.getBoundingClientRect = vi.fn(() => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 480,
      bottom: 100,
      width: 480,
      height: 100,
      toJSON: () => ({}),
    }))

    fireEvent.scroll(parent)

    await waitFor(() => {
      expect(view.getAllByTestId("row").map((node) => node.textContent)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"])
      expect(view.getByTestId("top-space").style.height).toBe("0px")
    })
  })

  it("history anchor 移到 tail 后仍能用 tail row 恢复", () => {
    const view = render(<Harness sessionID="s1" ids={["m2"]} all={["m2"]} box={{ m2: { top: 50, height: 100 } }} />)
    const parent = view.getByTestId("scroll-parent")
    setScroll(parent, { top: 20, height: 200, client: 100 })

    fireEvent.click(view.getByTestId("prepare-prepend"))

    setScroll(parent, { top: 20, height: 300, client: 100 })
    view.rerender(
      <Harness
        sessionID="s1"
        ids={["m1"]}
        all={["m1", "m2"]}
        tailIds={["m2"]}
        box={{
          m1: { top: 50, height: 100 },
          m2: { top: 150, height: 100 },
        }}
      />,
    )

    expect(parent.scrollTop).toBe(120)
  })

  it("初始只有 tail 时，prepend 历史后仍按 tail 锚点补偿", () => {
    const view = render(
      <Harness sessionID="s1" ids={[]} all={["m1"]} tailIds={["m1"]} box={{ m1: { top: 50, height: 100 } }} />,
    )
    const parent = view.getByTestId("scroll-parent")
    setScroll(parent, { top: 20, height: 200, client: 100 })

    fireEvent.click(view.getByTestId("prepare-prepend"))

    setScroll(parent, { top: 20, height: 300, client: 100 })
    view.rerender(
      <Harness
        sessionID="s1"
        ids={["m0"]}
        all={["m0", "m1"]}
        tailIds={["m1"]}
        box={{
          m0: { top: 50, height: 100 },
          m1: { top: 150, height: 100 },
        }}
      />,
    )

    expect(parent.scrollTop).toBe(120)
  })

  it("稳定期内不会 trim，结束后才恢复", async () => {
    const view = render(<Harness sessionID="s1" ids={["m1", "m2", "m3", "m4", "m5", "m6"]} paused />)
    const parent = view.getByTestId("scroll-parent")
    setScroll(parent, { top: 520, height: 600, client: 200 })
    for (const row of view.getAllByTestId("row")) {
      setBox(row, { height: 100 })
    }

    fireEvent.scroll(parent)

    await waitFor(() => {
      expect(view.getAllByTestId("row").map((node) => node.textContent)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"])
      expect(view.getByTestId("top-space").style.height).toBe("0px")
    })

    view.rerender(<Harness sessionID="s1" ids={["m1", "m2", "m3", "m4", "m5", "m6"]} paused={false} />)
    fireEvent.scroll(parent)

    await waitFor(() => {
      expect(view.getAllByTestId("row").map((node) => node.textContent)).toEqual(["m4", "m5", "m6"])
      expect(Number.parseFloat(view.getByTestId("top-space").style.height)).toBeGreaterThan(200)
    })
  })
})
