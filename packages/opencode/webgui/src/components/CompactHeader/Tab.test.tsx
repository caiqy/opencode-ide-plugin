import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import type React from "react"

import { Tab } from "./Tab"

function props(overrides: Partial<React.ComponentProps<typeof Tab>> = {}) {
  return {
    title: "新建会话 1",
    isActive: false,
    isBusy: false,
    isReasoning: false,
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onRename: vi.fn(),
    onContextMenu: vi.fn(),
    isDragOver: null,
    ...overrides,
  }
}

describe("CompactHeader/Tab", () => {
  it("uses browser-like dynamic width constraints", () => {
    render(<Tab {...props()} />)

    const tab = screen.getByTitle("新建会话 1")
    expect(tab.className).toContain("min-w-[72px]")
    expect(tab.className).toContain("max-w-[180px]")
    expect(tab.className).toContain("flex-[1_1_150px]")
  })

  it("applies flat bright background and blue bottom border when active", () => {
    render(<Tab {...props({ isActive: true })} />)

    const tab = screen.getByTitle("新建会话 1")
    expect(tab.className).toContain("bg-white")
    expect(tab.className).toContain("border-b-blue-500")
    expect(tab.className).not.toContain("rounded")
    expect(tab.className).not.toContain("border-x")
    expect(tab.className).not.toContain("border-t")
  })

  it("applies light background and transparent bottom border when inactive", () => {
    render(<Tab {...props({ isActive: false })} />)

    const tab = screen.getByTitle("新建会话 1")
    expect(tab.className).toContain("bg-gray-100/50")
    expect(tab.className).toContain("border-b-transparent")
    expect(tab.className).toContain("text-gray-700")
    expect(tab.className).toContain("dark:text-gray-300")
    expect(tab.className).not.toContain("rounded")
    expect(tab.className).not.toContain("border-x")
    expect(tab.className).not.toContain("border-t")
  })

  it("uses brighter default-title fallback colors", () => {
    render(<Tab {...props({ isActive: false, title: "New session - 2025-10-31T11:44:37.671Z" })} />)

    const title = screen.getByText("New session - 2025-10-31T11:44:37.671Z")
    expect(title.className).toContain("text-gray-500")
    expect(title.className).toContain("dark:text-gray-400")
  })

  it("keeps inactive close button visible by default", () => {
    render(<Tab {...props({ isActive: false })} />)

    const close = screen.getByRole("button", { name: "关闭标签" })
    expect(close.className).toContain("z-20")
    expect(close.className).toContain("opacity-60")
    expect(close.className).not.toContain("opacity-0")
  })

  it("renders long title without ellipsis truncation class", () => {
    const p = props({ title: "这是一个非常非常非常长的标题用于测试渐隐行为" })
    const { container } = render(<Tab {...p} />)

    const title = screen.getByText(p.title)
    expect(title.className).toContain("overflow-hidden")
    expect(title.className).toContain("whitespace-nowrap")
    expect(title.className).not.toContain("truncate")

    const fade = container.querySelector("span[aria-hidden='true']")
    expect(fade?.className).toContain("pointer-events-none")
    expect(fade?.className).toContain("from-gray-100/50")
    expect(fade?.className).not.toContain("from-white")
  })

  it("keeps active close button above edge overlays", () => {
    render(<Tab {...props({ isActive: true })} />)

    const close = screen.getByRole("button", { name: "关闭标签" })
    expect(close.className).toContain("opacity-100")
    expect(close.className).toContain("z-20")
  })

  it("does not set draggable attribute", () => {
    render(<Tab {...props()} />)

    expect(screen.getByTitle("新建会话 1").hasAttribute("draggable")).toBe(false)
  })

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

  it("does not show a stale reasoning dot while idle", () => {
    const { container } = render(<Tab {...props({ isBusy: false, isReasoning: true })} />)

    expect(container.querySelector(".bg-purple-500")).toBeNull()
    expect(container.querySelector(".animate-pulse")).toBeNull()
  })

  it("enters edit mode when isRenaming becomes true", () => {
    const p = props({ title: "old title", isRenaming: false })
    const { rerender } = render(<Tab {...p} />)

    expect(screen.queryByDisplayValue("old title")).not.toBeInTheDocument()

    rerender(<Tab {...p} isRenaming />)

    expect(screen.getByDisplayValue("old title")).toBeInTheDocument()
  })

  it("trims title and signals rename complete on save", () => {
    const p = props({ title: "old title", onRenameComplete: vi.fn() })
    render(<Tab {...p} />)

    fireEvent.doubleClick(screen.getByTitle("old title"))
    const input = screen.getByDisplayValue("old title")
    fireEvent.change(input, { target: { value: "  new title  " } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(p.onRenameComplete).toHaveBeenCalledTimes(1)
    expect(p.onRename).toHaveBeenCalledWith("new title")
  })

  it("does not rename when trimmed title is empty", () => {
    const p = props({ title: "old title", onRenameComplete: vi.fn() })
    render(<Tab {...p} />)

    fireEvent.doubleClick(screen.getByTitle("old title"))
    const input = screen.getByDisplayValue("old title")
    fireEvent.change(input, { target: { value: "   " } })
    fireEvent.keyDown(input, { key: "Enter" })

    expect(p.onRenameComplete).toHaveBeenCalledTimes(1)
    expect(p.onRename).not.toHaveBeenCalled()
  })

  it("signals rename complete when canceling edit", () => {
    const p = props({ title: "old title", onRenameComplete: vi.fn() })
    render(<Tab {...p} />)

    fireEvent.doubleClick(screen.getByTitle("old title"))
    fireEvent.keyDown(screen.getByDisplayValue("old title"), { key: "Escape" })

    expect(p.onRenameComplete).toHaveBeenCalledTimes(1)
    expect(p.onRename).not.toHaveBeenCalled()
  })
})
