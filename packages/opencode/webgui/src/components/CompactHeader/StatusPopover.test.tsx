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

type View = {
  connectionState: ConnectionState
  servers: {
    state: "ready" | "empty" | "failed" | "stale"
    error: string | null
    updatedAt: number | null
    data: {
      connectionState: ConnectionState
      project: string | null
      worktree: string | null
      directory: string | null
      bridge: { installed: boolean; ready: boolean; customApi: boolean; restartMode: "window" | "ide" | null }
    }
  }
  mcp: {
    state: "ready" | "empty" | "failed" | "stale"
    error: string | null
    updatedAt: number | null
    data: Record<
      string,
      {
        status: "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration"
        error?: string
        tools?: Array<{ id: string; name: string; enabled: boolean }>
      }
    >
  }
  lsp: {
    state: "ready" | "empty" | "failed" | "stale"
    error: string | null
    updatedAt: number | null
    data: Array<{ id: string; name: string; root: string; status: "connected" | "error" }>
  }
  plugins: {
    state: "ready" | "empty" | "failed" | "stale"
    error: string | null
    updatedAt: number | null
    data: string[]
  }
  refreshAll: ReturnType<typeof vi.fn>
  refreshMcp: ReturnType<typeof vi.fn>
  toggleMcp: ReturnType<typeof vi.fn>
  toggleTool: ReturnType<typeof vi.fn>
  mcpBusy: Record<string, boolean>
  mcpToolBusy: Record<string, Record<string, boolean>>
  mcpRefreshing: boolean
}

function data(): View {
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
        bridge: { installed: true, ready: true, customApi: true, restartMode: "window" as const },
      },
    },
    mcp: {
      state: "ready",
      error: null,
      updatedAt: 1,
      data: {
        alpha: {
          status: "connected" as const,
          tools: [
            { id: "alpha.read", name: "alpha.read", enabled: true },
            { id: "alpha.write", name: "alpha.write", enabled: false },
          ],
        },
      },
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
    toggleTool: vi.fn().mockResolvedValue(undefined),
    mcpBusy: {},
    mcpToolBusy: {},
    mcpRefreshing: false,
  }
}

describe("CompactHeader/StatusPopover", () => {
  beforeEach(() => {
    mocks.useStatusPopoverData.mockReturnValue(data())
  })

  it("渲染四个状态 tab 并默认选中 servers", () => {
    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    expect(mocks.useStatusPopoverData).toHaveBeenCalledWith({ open: true, connectionState: "connected" })
    expect(screen.getByRole("dialog", { name: "状态面板" })).toHaveClass("right-2")
    expect(screen.getByRole("dialog", { name: "状态面板" })).toHaveClass("modern-card")
    expect(screen.getAllByRole("tab").map((item) => item.textContent)).toEqual(["Server", "MCP", "LSP", "Plugins"])
    expect(screen.getByRole("tab", { name: "Server" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("SSE 连接：connected")).toBeInTheDocument()
    expect(screen.getByText("IDE bridge：ready")).toBeInTheDocument()
    expect(screen.queryByText(/项目：/)).not.toBeInTheDocument()
    expect(screen.queryByText(/健康检查/)).not.toBeInTheDocument()
    expect(screen.queryByText(/首版仅展示当前连接/)).not.toBeInTheDocument()
    expect(screen.getByText("SSE 连接：connected").closest("div.space-y-2")).toHaveClass("pr-4")
  })

  it("面板限制最大高度并提供内容区滚动", () => {
    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    const dlg = screen.getByRole("dialog", { name: "状态面板" })
    expect(dlg).toHaveClass("max-h-[60vh]")
    const box = screen.getByTestId("status-scroll")
    expect(box).toHaveClass("overflow-y-auto")
  })

  it("打开后把焦点移到默认 tab", async () => {
    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Server" })).toHaveFocus()
    })
  })

  it("显示 lsp 和 plugins 的只读内容", async () => {
    const user = userEvent.setup()
    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "LSP" }))
    expect(screen.getByText("TypeScript")).toBeInTheDocument()

    await user.click(screen.getByRole("tab", { name: "Plugins" }))
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

    await user.click(screen.getByRole("tab", { name: "Plugins" }))
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

    const servers = screen.getByRole("tab", { name: "Server" })
    servers.focus()
    await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("tab", { name: "MCP" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tab", { name: "MCP" })).toHaveFocus()

    await user.keyboard("{Escape}")
    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => expect(trigger).toHaveFocus())
    trigger.remove()
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

  it("点击外部控件关闭时不抢回 trigger 焦点", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const trigger = document.createElement("button")
    trigger.textContent = "trigger"
    document.body.appendChild(trigger)
    const triggerRef = { current: trigger }

    render(
      <div>
        <button type="button">outside</button>
        <StatusPopover open={true} connectionState="connected" onClose={onClose} triggerRef={triggerRef} />
      </div>,
    )

    const outside = screen.getByRole("button", { name: "outside" })
    await user.click(outside)
    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => expect(outside).toHaveFocus())
    expect(trigger).not.toHaveFocus()
    trigger.remove()
  })

  it("MCP server 开关使用 switch 语义并只调用 adapter action", async () => {
    const user = userEvent.setup()
    const view = data()
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "MCP" }))
    const sw = screen.getByRole("switch", { name: "切换 alpha" })
    expect(sw).toHaveAttribute("aria-checked", "true")
    await user.click(sw)

    expect(view.toggleMcp).toHaveBeenCalledWith("alpha")
  })

  it("MCP tool 开关使用 switch 语义并只调用 adapter action", async () => {
    const user = userEvent.setup()
    const view = data()
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "MCP" }))
    await user.click(screen.getByRole("button", { name: "展开工具 alpha" }))
    const sw = screen.getByRole("switch", { name: "切换 alpha.read" })
    expect(sw).toHaveAttribute("aria-checked", "true")
    await user.click(sw)

    expect(view.toggleTool).toHaveBeenCalledWith("alpha", "alpha.read", false)
  })

  it("MCP tool 切换成功后显示下一轮生效提示", async () => {
    const user = userEvent.setup()
    const view = data()
    view.toggleTool = vi.fn().mockResolvedValue(true)
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "MCP" }))
    await user.click(screen.getByRole("button", { name: "展开工具 alpha" }))
    await user.click(screen.getByRole("switch", { name: "切换 alpha.read" }))

    expect(screen.getByText("已保存，将在下一轮回复生效")).toBeInTheDocument()
  })

  it("MCP tool 切换失败后不显示下一轮生效提示", async () => {
    const user = userEvent.setup()
    const view = data()
    view.toggleTool = vi.fn().mockResolvedValue(false)
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "MCP" }))
    await user.click(screen.getByRole("button", { name: "展开工具 alpha" }))
    await user.click(screen.getByRole("switch", { name: "切换 alpha.read" }))

    expect(screen.queryByText("已保存，将在下一轮回复生效")).not.toBeInTheDocument()
  })

  it("MCP 刷新按钮只调用 refreshMcp", async () => {
    const user = userEvent.setup()
    const view = data()
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "MCP" }))
    const btn = screen.getByRole("button", { name: "手动刷新" })
    expect(btn).toHaveClass("rounded")
    expect(btn).toHaveClass("border")
    await user.click(btn)

    expect(view.refreshMcp).toHaveBeenCalledOnce()
  })

  it("MCP 刷新中展示 loading 文案并禁用按钮", async () => {
    const user = userEvent.setup()
    const view = data()
    view.mcpRefreshing = true
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "MCP" }))
    expect(screen.getByRole("button", { name: "刷新中..." })).toBeDisabled()
  })

  it("MCP 失败项会展示错误原因", async () => {
    const user = userEvent.setup()
    const view = data()
    view.mcp = {
      state: "ready",
      error: null,
      updatedAt: 1,
      data: {
        bad: { status: "failed", error: "boom" },
      },
    }
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "MCP" }))
    expect(screen.getByText("boom")).toBeInTheDocument()
  })

  it("servers 失败时显示重试入口", async () => {
    const user = userEvent.setup()
    const view = data()
    view.servers = {
      state: "failed",
      error: "server boom",
      updatedAt: null,
      data: view.servers.data,
    }
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    expect(screen.getByText(/数据失败：server boom/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "重试" }))
    expect(view.refreshAll).toHaveBeenCalledOnce()
  })

  it("MCP 受限项显示禁用并说明原因", async () => {
    const user = userEvent.setup()
    const view = data()
    view.mcp = {
      state: "ready",
      error: null,
      updatedAt: 1,
      data: {
        auth: { status: "needs_auth" },
      },
    }
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "MCP" }))
    expect(screen.getByRole("switch", { name: "切换 auth" })).toBeDisabled()
    expect(screen.getByText(/需要认证/)).toBeInTheDocument()
  })

  it("MCP tool busy 只禁用当前 tool 开关并展示 loading", async () => {
    const user = userEvent.setup()
    const view = data()
    view.mcpToolBusy = { alpha: { "alpha.read": true } }
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "MCP" }))
    await user.click(screen.getByRole("button", { name: "展开工具 alpha" }))
    expect(screen.getByRole("switch", { name: "切换 alpha.read" })).toBeDisabled()
    expect(screen.getByRole("switch", { name: "切换 alpha.write" })).toBeEnabled()
    expect(screen.getByText("更新中...")).toBeInTheDocument()
  })

  it("MCP 工具列表默认收起并可展开收起", async () => {
    const user = userEvent.setup()
    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "MCP" }))
    const btn = screen.getByRole("button", { name: "展开工具 alpha" })
    expect(btn).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByRole("switch", { name: "切换 alpha.read" })).not.toBeInTheDocument()

    await user.click(btn)
    expect(btn).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("switch", { name: "切换 alpha.read" })).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "收起工具 alpha" }))
    expect(screen.queryByRole("switch", { name: "切换 alpha.read" })).not.toBeInTheDocument()
  })
})
