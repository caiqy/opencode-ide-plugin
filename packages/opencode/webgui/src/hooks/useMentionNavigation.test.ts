import { describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"
import { useMentionNavigation } from "./useMentionNavigation"

describe("useMentionNavigation", () => {
  it("keeps selectedIndex stable when itemCount is 0", () => {
    const onSelect = vi.fn()
    const onClose = vi.fn()

    const { result } = renderHook(() =>
      useMentionNavigation({
        itemCount: 0,
        onSelect,
        onClose,
        isOpen: true,
      }),
    )

    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }))
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }))
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }))
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }))
    })

    expect(result.current.selectedIndex).toBe(0)
    expect(onSelect).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })
})
