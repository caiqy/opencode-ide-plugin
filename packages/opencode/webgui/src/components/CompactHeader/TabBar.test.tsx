import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import type React from "react"

const mocks = vi.hoisted(() => ({
  useSession: vi.fn(),
  isInstalled: vi.fn(),
  send: vi.fn(),
}))

vi.mock("../../state/SessionContext", async () => {
  const actual = await vi.importActual<typeof import("../../state/SessionContext")>("../../state/SessionContext")
  return {
    ...actual,
    useSession: (...args: unknown[]) => mocks.useSession(...args),
  }
})

vi.mock("../../lib/ideBridge", () => ({
  ideBridge: {
    isInstalled: (...args: unknown[]) => mocks.isInstalled(...args),
    send: (...args: unknown[]) => mocks.send(...args),
  },
}))

import { TabBar } from "./TabBar"

function props(overrides: Partial<React.ComponentProps<typeof TabBar>> = {}) {
  return {
    openTabs: ["s1", "s2"],
    activeTab: "s1",
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onReorder: vi.fn(),
    onCloseOtherTabs: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onToggleShare: vi.fn(),
    ...overrides,
  }
}

describe("CompactHeader/TabBar", () => {
  const scroll = vi.fn(function (this: HTMLElement) {
    return this
  })

  beforeEach(() => {
    scroll.mockClear()
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scroll,
    })
    mocks.isInstalled.mockReturnValue(true)
    mocks.send.mockReset()
    mocks.useSession.mockReturnValue({
      sessions: [
        { id: "s1", title: "会话 1", share: { url: "https://example.com/s1" } },
        { id: "s2", title: "会话 2" },
      ],
      isSessionIdle: vi.fn(() => true),
      isSessionReasoning: vi.fn(() => false),
    })
  })

  it("reorders tabs when pointer drag ends outside tab wrappers", () => {
    const p = props()
    render(<TabBar {...p} />)

    const from = screen.getByTitle("会话 1")
    const to = screen.getByTitle("会话 2")

    fireEvent.pointerDown(from, { pointerId: 1, button: 0, clientX: 20, clientY: 12 })
    fireEvent.pointerMove(from, { pointerId: 1, clientX: 40, clientY: 12 })
    fireEvent.pointerEnter(to, { pointerId: 1, clientX: 180, clientY: 12 })
    fireEvent.pointerUp(window, { pointerId: 1, clientX: 260, clientY: 12 })

    expect(p.onReorder).toHaveBeenCalledWith(0, 1)
  })

  it("does not reorder when pointer movement stays below threshold", () => {
    const p = props()
    render(<TabBar {...p} />)

    const from = screen.getByTitle("会话 1")

    fireEvent.pointerDown(from, { pointerId: 2, button: 0, clientX: 20, clientY: 12 })
    fireEvent.pointerMove(from, { pointerId: 2, clientX: 23, clientY: 12 })
    fireEvent.pointerUp(from, { pointerId: 2, clientX: 23, clientY: 12 })

    expect(p.onReorder).not.toHaveBeenCalled()
  })

  it("cancels pointer dragging on pointercancel", () => {
    const p = props()
    render(<TabBar {...p} />)

    const from = screen.getByTitle("会话 1")
    const to = screen.getByTitle("会话 2")

    fireEvent.pointerDown(from, { pointerId: 3, button: 0, clientX: 20, clientY: 12 })
    fireEvent.pointerMove(from, { pointerId: 3, clientX: 40, clientY: 12 })
    fireEvent.pointerEnter(to, { pointerId: 3, clientX: 180, clientY: 12 })
    fireEvent.pointerCancel(window, { pointerId: 3 })
    fireEvent.pointerUp(to, { pointerId: 3, clientX: 180, clientY: 12 })

    expect(p.onReorder).not.toHaveBeenCalled()
  })

  it("does not start drag reorder from close button", () => {
    const p = props()
    render(<TabBar {...p} />)

    const [close] = screen.getAllByRole("button", { name: "关闭标签" })
    const to = screen.getByTitle("会话 2")

    fireEvent.pointerDown(close, { pointerId: 4, button: 0, clientX: 20, clientY: 12 })
    fireEvent.pointerMove(close, { pointerId: 4, clientX: 60, clientY: 12 })
    fireEvent.pointerEnter(to, { pointerId: 4, clientX: 180, clientY: 12 })
    fireEvent.pointerUp(window, { pointerId: 4, clientX: 180, clientY: 12 })

    expect(p.onReorder).not.toHaveBeenCalled()
  })

  it("opens share url through ide bridge when available", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null)
    render(<TabBar {...props()} />)

    fireEvent.contextMenu(screen.getByTitle("会话 1"), { clientX: 24, clientY: 28 })
    fireEvent.click(screen.getByRole("button", { name: "打开分享链接" }))

    expect(mocks.send).toHaveBeenCalledWith({
      type: "openUrl",
      payload: { url: "https://example.com/s1" },
    })
    expect(openSpy).not.toHaveBeenCalled()
    openSpy.mockRestore()
  })

  it("starts inline rename from context menu action", () => {
    const p = props()
    render(<TabBar {...p} />)

    fireEvent.contextMenu(screen.getByTitle("会话 1"), { clientX: 24, clientY: 28 })
    fireEvent.click(screen.getByRole("button", { name: "重命名" }))

    expect(screen.getByDisplayValue("会话 1")).toBeInTheDocument()
    expect(p.onRename).not.toHaveBeenCalled()
  })

  it("scrolls active tab into view when activeTab changes", () => {
    const p = props()
    const view = render(<TabBar {...p} />)
    const node = screen.getByTitle("会话 2")

    view.rerender(<TabBar {...props({ activeTab: "s2" })} />)

    expect(scroll).toHaveBeenCalledWith({
      inline: "nearest",
      block: "nearest",
      behavior: "smooth",
    })
    expect(scroll.mock.contexts.some((el) => el instanceof HTMLElement && el.contains(node))).toBe(true)
  })

  it("keeps wrapper width constraints aligned with tab max width", () => {
    render(<TabBar {...props()} />)

    const tab = screen.getByTitle("会话 1")
    const wrapper = tab.parentElement
    expect(wrapper?.className).toContain("min-w-[72px]")
    expect(wrapper?.className).toContain("max-w-[180px]")
    expect(wrapper?.className).toContain("flex-[1_1_150px]")
  })
})
