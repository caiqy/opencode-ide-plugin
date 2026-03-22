import { act, render, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { useHistoryMeasure } from "./useHistoryMeasure"

function Harness(props: { sessionID: string; ids: string[] }) {
  const measure = useHistoryMeasure({
    sessionID: props.sessionID,
    items: props.ids.map((id) => ({ id })),
  })

  return (
    <div>
      {props.ids.map((id) => (
        <div key={id} ref={measure.row(id)} data-testid={id} />
      ))}
    </div>
  )
}

describe("useHistoryMeasure", () => {
  const Raw = globalThis.ResizeObserver

  beforeEach(() => {
    ;(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
      constructor(_: ResizeObserverCallback) {}
      disconnect() {}
      observe() {}
      unobserve() {}
    }
  })

  afterEach(() => {
    ;(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = Raw
  })

  it("按 block 生成 prefix ledger", () => {
    const view = renderHook(({ sessionID }) => useHistoryMeasure({ sessionID, items: [{ id: "b1" }, { id: "b2" }] }), {
      initialProps: { sessionID: "s1" },
    })

    act(() => {
      view.result.current.onMeasure("b1", 120)
      view.result.current.onMeasure("b2", 80)
    })

    expect(view.result.current.ledger("b1")).toBe(0)
    expect(view.result.current.ledger("b2")).toBe(120)
    expect(view.result.current.prefix).toEqual([0, 120])
  })

  it("切回同一 session 时复用已测量缓存", () => {
    const view = renderHook(({ sessionID }) => useHistoryMeasure({ sessionID, items: [{ id: "b1" }, { id: "b2" }] }), {
      initialProps: { sessionID: "s1" },
    })

    act(() => {
      view.result.current.onMeasure("b1", 144)
    })

    view.rerender({ sessionID: "s2" })
    view.rerender({ sessionID: "s1" })

    expect(view.result.current.ledger("b2")).toBe(144)
  })

  it("同一 session 结构版本变化时丢弃旧测量缓存", () => {
    const view = renderHook(
      ({ version }) =>
        useHistoryMeasure({
          sessionID: "s1",
          items: [
            { id: "b1", version },
            { id: "b2", version },
          ],
        }),
      {
        initialProps: { version: "v1" },
      },
    )

    act(() => {
      view.result.current.onMeasure("b1", 144)
    })

    expect(view.result.current.ledger("b2")).toBe(144)

    view.rerender({ version: "v2" })

    expect(view.result.current.ledger("b2")).toBe(96)
  })

  it("没有 ResizeObserver 时退化为首次挂载测量", () => {
    ;(globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver = undefined

    const view = render(<Harness sessionID="s1" ids={["b1", "b2"]} />)
    Object.defineProperty(view.getByTestId("b1"), "offsetHeight", { configurable: true, value: 110 })
    Object.defineProperty(view.getByTestId("b2"), "offsetHeight", { configurable: true, value: 90 })

    const hook = renderHook(() => useHistoryMeasure({ sessionID: "s1", items: [{ id: "b1" }, { id: "b2" }] }))
    act(() => {
      hook.result.current.onMeasure("b1", 110)
      hook.result.current.onMeasure("b2", 90)
    })

    expect(hook.result.current.prefix).toEqual([0, 110])
  })

  it("挂载测量保留小数高度，避免累计整数误差", () => {
    const hook = renderHook(() => useHistoryMeasure({ sessionID: "s1", items: [{ id: "b1" }, { id: "b2" }] }))
    const b1 = document.createElement("div")
    const b2 = document.createElement("div")
    Object.defineProperty(b1, "offsetHeight", { configurable: true, value: 100 })
    Object.defineProperty(b2, "offsetHeight", { configurable: true, value: 80 })
    b1.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 100.5,
      width: 0,
      height: 100.5,
      toJSON: () => ({}),
    })
    b2.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 80.25,
      width: 0,
      height: 80.25,
      toJSON: () => ({}),
    })

    act(() => {
      hook.result.current.row("b1")(b1)
      hook.result.current.row("b2")(b2)
    })

    expect(hook.result.current.prefix).toEqual([0, 100.5])
  })
})
