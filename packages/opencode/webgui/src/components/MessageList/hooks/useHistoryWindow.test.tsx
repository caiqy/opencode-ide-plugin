import { act, renderHook } from "@testing-library/react"
import { useLayoutEffect } from "react"
import { describe, expect, it } from "vitest"
import { useHistoryWindow } from "./useHistoryWindow"

describe("useHistoryWindow", () => {
  it("用 hysteresis 避免 trim 边界来回翻转", () => {
    const view = renderHook(() =>
      useHistoryWindow({
        sessionID: "s1",
        sizes: [100, 100, 100, 100, 100, 100],
      }),
    )

    act(() => {
      view.result.current.onScroll(520)
    })
    expect(view.result.current.start).toBe(3)

    act(() => {
      view.result.current.onScroll(480)
    })
    expect(view.result.current.start).toBe(3)

    act(() => {
      view.result.current.onScroll(180)
    })
    expect(view.result.current.start).toBe(0)
  })

  it("切回旧 session 时恢复各自窗口", () => {
    const view = renderHook(
      ({ sessionID }) =>
        useHistoryWindow({
          sessionID,
          sizes: [100, 100, 100, 100],
        }),
      { initialProps: { sessionID: "s1" } },
    )

    act(() => {
      view.result.current.onScroll(430)
    })
    expect(view.result.current.start).toBe(2)

    view.rerender({ sessionID: "s2" })
    expect(view.result.current.start).toBe(0)

    view.rerender({ sessionID: "s1" })
    expect(view.result.current.start).toBe(2)
  })

  it("切换 session 时首帧不会暴露旧会话的 trim 窗口", () => {
    const seen: Array<{ id: string; start: number }> = []
    const view = renderHook(
      ({ sessionID }) => {
        const win = useHistoryWindow({
          sessionID,
          sizes: [100, 100, 100, 100],
        })

        useLayoutEffect(() => {
          seen.push({ id: sessionID, start: win.start })
        }, [sessionID, win.start])

        return win
      },
      { initialProps: { sessionID: "s1" } },
    )

    act(() => {
      view.result.current.onScroll(430)
    })
    expect(view.result.current.start).toBe(2)

    seen.length = 0
    view.rerender({ sessionID: "s2" })

    expect(seen).toEqual([{ id: "s2", start: 0 }])
  })

  it("同一 session 历史缩短时会立即 clamp 旧窗口", () => {
    const view = renderHook(
      ({ sizes }) =>
        useHistoryWindow({
          sessionID: "s1",
          sizes,
        }),
      { initialProps: { sizes: [100, 100, 100, 100] } },
    )

    act(() => {
      view.result.current.onScroll(430)
    })
    expect(view.result.current.start).toBe(2)

    view.rerender({ sizes: [100] })

    expect(view.result.current.start).toBe(0)
    expect(view.result.current.top).toBe(0)
  })

  it("同一 session 历史明显缩短时会重置窗口，避免跳到新尾部", () => {
    const view = renderHook(
      ({ sizes }) =>
        useHistoryWindow({
          sessionID: "s1",
          sizes,
        }),
      { initialProps: { sizes: Array.from({ length: 20 }, () => 100) } },
    )

    act(() => {
      view.result.current.onScroll(1500, 200)
    })
    expect(view.result.current.start).toBeGreaterThan(0)

    view.rerender({ sizes: Array.from({ length: 9 }, () => 100) })

    expect(view.result.current.start).toBe(0)
    expect(view.result.current.top).toBe(0)
  })

  it("视口变高时会保留更多 history block", () => {
    const view = renderHook(() =>
      useHistoryWindow({
        sessionID: "s1",
        sizes: [100, 100, 100, 100, 100, 100],
      }),
    )

    act(() => {
      view.result.current.onScroll(520, 200)
    })
    expect(view.result.current.start).toBe(3)

    act(() => {
      view.result.current.onScroll(520, 400)
    })
    expect(view.result.current.start).toBe(1)
  })
})
