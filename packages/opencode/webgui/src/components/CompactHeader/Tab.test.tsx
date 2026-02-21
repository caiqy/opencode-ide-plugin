import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import type React from "react"

import { Tab } from "./Tab"

function props(overrides: Partial<React.ComponentProps<typeof Tab>> = {}) {
  return {
    sessionId: "s1",
    title: "新建会话 1",
    isActive: false,
    isBusy: false,
    isReasoning: false,
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onRename: vi.fn(),
    onContextMenu: vi.fn(),
    onDragStart: vi.fn(),
    onDragOver: vi.fn(),
    onDrop: vi.fn(),
    onDragEnd: vi.fn(),
    isDragOver: null,
    ...overrides,
  }
}

describe("CompactHeader/Tab", () => {
  it("double click enters edit mode and saves renamed title", () => {
    const p = props({ title: "old title" })
    render(<Tab {...p} />)

    fireEvent.doubleClick(screen.getByTitle("old title"))
    const input = screen.getByDisplayValue("old title")
    fireEvent.change(input, { target: { value: "new title" } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(p.onRename).toHaveBeenCalledWith("new title")
  })

  it("shows status dot when busy", () => {
    const { container } = render(<Tab {...props({ isBusy: true })} />)
    expect(container.querySelector(".bg-yellow-500")).toBeTruthy()
  })
})
