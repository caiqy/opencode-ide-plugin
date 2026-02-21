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
    onCloseTabsToRight: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    onToggleShare: vi.fn(),
    ...overrides,
  }
}

describe("CompactHeader/TabBar", () => {
  beforeEach(() => {
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

  it("drop reorders tabs using drag indices", () => {
    const p = props()
    render(<TabBar {...p} />)

    const from = screen.getByTitle("会话 1")
    const to = screen.getByTitle("会话 2")
    const data = { effectAllowed: "", dropEffect: "", setData: vi.fn() }

    fireEvent.dragStart(from, { dataTransfer: data })
    fireEvent.dragOver(to, { dataTransfer: data })
    fireEvent.drop(to, { dataTransfer: data })

    expect(p.onReorder).toHaveBeenCalledWith(0, 1)
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
})
