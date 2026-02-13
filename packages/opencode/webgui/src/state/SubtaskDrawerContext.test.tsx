import { act, renderHook } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it } from "vitest"

import { SubtaskDrawerProvider, useSubtaskDrawer } from "./SubtaskDrawerContext"

function wrapper(props: { children: ReactNode }) {
  return <SubtaskDrawerProvider>{props.children}</SubtaskDrawerProvider>
}

describe("SubtaskDrawerContext", () => {
  it("open/close 会更新抽屉状态", () => {
    const { result } = renderHook(() => useSubtaskDrawer(), { wrapper })

    expect(result.current.isOpen).toBe(false)
    expect(result.current.sessionId).toBe(null)

    act(() => {
      result.current.openSubtaskDrawer({ sessionId: "s-child", title: "demo" })
    })

    expect(result.current.isOpen).toBe(true)
    expect(result.current.sessionId).toBe("s-child")
    expect(result.current.title).toBe("demo")

    act(() => {
      result.current.closeSubtaskDrawer()
    })

    expect(result.current.isOpen).toBe(false)
    expect(result.current.sessionId).toBe(null)
    expect(result.current.title).toBe(null)
  })
})
