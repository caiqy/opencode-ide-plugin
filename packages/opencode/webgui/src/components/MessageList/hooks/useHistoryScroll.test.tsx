import { act, renderHook } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useHistoryScroll } from "./useHistoryScroll"

describe("useHistoryScroll", () => {
  it("只补偿 anchor 之前的高度变化", () => {
    const view = renderHook(() => useHistoryScroll({ ids: ["b1", "b2", "b3", "b4"] }))

    act(() => {
      view.result.current.capture({ id: "b3", offset: 12 })
      view.result.current.onHeightChange({ id: "b1", delta: 40 })
    })
    expect(view.result.current.nextTop()).toBe(40)

    act(() => {
      view.result.current.onHeightChange({ id: "b4", delta: 60 })
    })
    expect(view.result.current.nextTop()).toBe(40)
  })

  it("prepend 后恢复同一 anchor 偏移", () => {
    const view = renderHook(() => useHistoryScroll({ ids: ["m1", "m2", "m3", "m4"] }))
    const parent = { scrollTop: 20 }
    const rows = {
      m3: {
        getBoundingClientRect: () => ({ top: 250 }),
      },
    }

    act(() => {
      view.result.current.capture({ id: "m3", offset: 50 })
      view.result.current.restore(parent as never, rows as never, 0)
    })

    expect(parent.scrollTop).toBe(220)
  })

  it("高度变化补偿会真正写回 scrollTop", () => {
    const view = renderHook(() => useHistoryScroll({ ids: ["m1", "m2", "m3", "m4"] }))
    const parent = { scrollTop: 520 }

    act(() => {
      view.result.current.capture({ id: "m4", offset: -20 })
      view.result.current.onHeightChange({ id: "m2", delta: 40 })
    })

    expect(view.result.current.nextTop()).toBe(40)

    act(() => {
      view.result.current.apply(parent)
    })

    expect(parent.scrollTop).toBe(560)
    expect(view.result.current.nextTop()).toBe(0)
  })

  it("anchor 消失时回退到后继稳定 block", () => {
    const view = renderHook(() => useHistoryScroll({ ids: ["m1", "m2", "m3", "m4"] }))
    const parent = { scrollTop: 20 }
    const rows = {
      m3: {
        getBoundingClientRect: () => ({ top: 160 }),
      },
    }

    act(() => {
      view.result.current.capture({ id: "m2", offset: 30 })
      view.result.current.restore(parent as never, rows as never, 0)
    })

    expect(parent.scrollTop).toBe(150)
  })
})
