import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ConnectionState } from "../../lib/api/events"

const mocks = vi.hoisted(() => ({
  useStatusPopoverData: vi.fn(),
}))

vi.mock("./useStatusPopoverData", () => ({
  useStatusPopoverData: (...args: unknown[]) => mocks.useStatusPopoverData(...args),
}))

import { StatusPopover } from "./StatusPopover"

function data() {
  return {
    connectionState: "connected" as ConnectionState,
    servers: {
      state: "ready",
      error: null,
      updatedAt: 1,
      data: {
        connectionState: "connected" as ConnectionState,
        project: "p1",
        worktree: "D:/repo",
        directory: "D:/repo",
        health: true,
        bridge: { installed: true, ready: true, customApi: true, restartMode: "window" as const },
      },
    },
    mcp: {
      state: "ready",
      error: null,
      updatedAt: 1,
      data: { alpha: { status: "connected" as const } },
    },
    lsp: {
      state: "ready",
      error: null,
      updatedAt: 1,
      data: [{ id: "ts", name: "TypeScript", root: "D:/repo", status: "connected" as const }],
    },
    plugins: {
      state: "ready",
      error: null,
      updatedAt: 1,
      data: ["foo"],
    },
    refreshAll: vi.fn(),
    refreshMcp: vi.fn().mockResolvedValue(undefined),
    toggleMcp: vi.fn().mockResolvedValue(undefined),
  }
}

describe("CompactHeader/StatusPopover", () => {
  beforeEach(() => {
    mocks.useStatusPopoverData.mockReturnValue(data())
  })

  it("渲染四个状态 tab 并默认选中 servers", () => {
    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    expect(mocks.useStatusPopoverData).toHaveBeenCalledWith({ open: true, connectionState: "connected" })
    expect(screen.getAllByRole("tab").map((item) => item.textContent)).toEqual(["servers", "mcp", "lsp", "plugins"])
    expect(screen.getByRole("tab", { name: "servers" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("SSE 连接：connected")).toBeInTheDocument()
    expect(screen.getByText("IDE bridge：ready")).toBeInTheDocument()
  })

  it("显示 lsp 和 plugins 的只读内容", async () => {
    const user = userEvent.setup()
    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "lsp" }))
    expect(screen.getByText("TypeScript")).toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "plugins" }))
    expect(screen.getByText("foo")).toBeInTheDocument()
  })

  it("分区 stale 时显示陈旧提示而不是连接错误", async () => {
    mocks.useStatusPopoverData.mockReturnValue({
      ...data(),
      plugins: {
        state: "stale",
        error: "boom",
        updatedAt: 1,
        data: ["foo"],
      },
    })
    const user = userEvent.setup()
    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "plugins" }))
    expect(screen.getByText(/数据可能不是最新/)).toBeInTheDocument()
    expect(screen.queryByText(/连接错误/)).not.toBeInTheDocument()
  })

  it("支持方向键切换 tab 并在 Escape 后把焦点还给触发器", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const trigger = document.createElement("button")
    trigger.textContent = "trigger"
    document.body.appendChild(trigger)
    const triggerRef = { current: trigger }

    render(<StatusPopover open={true} connectionState="connected" onClose={onClose} triggerRef={triggerRef} />)

    const servers = screen.getByRole("tab", { name: "servers" })
    servers.focus()
    await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("tab", { name: "mcp" })).toHaveAttribute("aria-selected", "true")

    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it("点击外部会关闭弹层", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <div>
        <button type="button">outside</button>
        <StatusPopover open={true} connectionState="connected" onClose={onClose} />
      </div>,
    )

    await user.click(screen.getByRole("button", { name: "outside" }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it("MCP 开关只调用 adapter action", async () => {
    const user = userEvent.setup()
    const view = data()
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "mcp" }))
    await user.click(screen.getByRole("checkbox", { name: "切换 alpha" }))

    expect(view.toggleMcp).toHaveBeenCalledWith("alpha")
  })

  it("MCP 刷新按钮只调用 refreshMcp", async () => {
    const user = userEvent.setup()
    const view = data()
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "mcp" }))
    await user.click(screen.getByRole("button", { name: "手动刷新" }))

    expect(view.refreshMcp).toHaveBeenCalledOnce()
  })
})
