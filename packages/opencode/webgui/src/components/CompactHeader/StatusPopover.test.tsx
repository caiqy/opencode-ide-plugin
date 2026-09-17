import { render, screen, waitFor, within } from "@testing-library/react"
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
      backendUrl: string | null
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
  toggleSkill: ReturnType<typeof vi.fn>
  mcpBusy: Record<string, boolean>
  mcpToolBusy: Record<string, Record<string, boolean>>
  mcpRefreshing: boolean
  skills: {
    state: "ready" | "empty" | "failed" | "stale"
    error: string | null
    updatedAt: number | null
    data: Record<string, { enabled: boolean; description?: string; source?: string }>
  }
  skillBusy: Record<string, boolean>
  acp?: {
    state: "ready" | "empty" | "failed" | "stale"
    error: string | null
    updatedAt: number | null
    data: {
      installed: boolean
      categories: Array<{
        id: string
        name: string
        description?: string
        status: "connected" | "disabled" | "unavailable"
        enabled: boolean
        tools: Array<{ id: string; name: string; description?: string; group?: string; enabled: boolean }>
      }>
    }
  }
  refreshAcp?: ReturnType<typeof vi.fn>
  toggleAcpCategory?: ReturnType<typeof vi.fn>
  toggleAcpTool?: ReturnType<typeof vi.fn>
  toggleAllAcpTools?: ReturnType<typeof vi.fn>
  toggleAllMcpTools?: ReturnType<typeof vi.fn>
  acpBusy?: Record<string, boolean>
  acpToolBusy?: Record<string, Record<string, boolean>>
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
        backendUrl: "http://127.0.0.1:4096",
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
    acp: {
      state: "ready",
      error: null,
      updatedAt: 1,
      data: {
        installed: true,
        categories: [
          {
            id: "vscode",
            name: "VS Code",
            description: "导航代码与命令",
            status: "connected",
            enabled: true,
            tools: [
              { id: "exec", name: "运行命令", description: "运行编辑器命令", enabled: true },
              { id: "nav", name: "代码导航", description: "跳转定义", enabled: false },
            ],
          },
        ],
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
    refreshAcp: vi.fn().mockResolvedValue(undefined),
    toggleAcpCategory: vi.fn().mockResolvedValue(undefined),
    toggleAcpTool: vi.fn().mockResolvedValue(undefined),
    toggleAllAcpTools: vi.fn().mockResolvedValue(undefined),
    toggleAllMcpTools: vi.fn().mockResolvedValue(undefined),
    acpBusy: {},
    acpToolBusy: {},
    mcpBusy: {},
    mcpToolBusy: {},
    mcpRefreshing: false,
    toggleSkill: vi.fn().mockResolvedValue(undefined),
    skills: {
      state: "ready",
      error: null,
      updatedAt: 1,
      data: {
        brainstorming: { enabled: true, description: "头脑风暴构思", source: "Built-in" },
        debugging: { enabled: false, description: "代码调试排错", source: "Project" },
      },
    },
    skillBusy: {},
  }
}

describe("CompactHeader/StatusPopover", () => {
  beforeEach(() => {
    mocks.useStatusPopoverData.mockReturnValue(data())
  })

  it("渲染六个状态 tab 并默认选中 servers", () => {
    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    expect(mocks.useStatusPopoverData).toHaveBeenCalledWith({ open: true, connectionState: "connected" })
    expect(screen.getByRole("dialog", { name: "状态面板" })).toHaveClass("left-2")
    expect(screen.getByRole("dialog", { name: "状态面板" })).toHaveClass("right-2")
    expect(screen.getByRole("dialog", { name: "状态面板" })).toHaveClass("modern-card")
    expect(screen.getAllByRole("tab").map((item) => item.textContent)).toEqual([
      "Server",
      "MCP",
      "ACP",
      "LSP",
      "Plugins",
      "Skills",
    ])
    expect(screen.getByRole("tab", { name: "Server" })).toHaveAttribute("aria-selected", "true")
    expect(screen.getByText("SSE 连接：connected")).toBeInTheDocument()
    expect(screen.getByText("后端地址：http://127.0.0.1:4096")).toBeInTheDocument()
    expect(screen.getByText("IDE bridge：ready")).toBeInTheDocument()
    expect(screen.queryByText(/项目：/)).not.toBeInTheDocument()
    expect(screen.queryByText(/健康检查/)).not.toBeInTheDocument()
    expect(screen.queryByText(/首版仅展示当前连接/)).not.toBeInTheDocument()
    expect(screen.getByText("SSE 连接：connected").closest("div.space-y-2")).toHaveClass("pr-4")
  })

  it("面板限制最大高度并提供内容区滚动", () => {
    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    const dlg = screen.getByRole("dialog", { name: "状态面板" })
    expect(dlg).toHaveClass("max-h-[72vh]")
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

  it("MCP tool 切换成功后不显示下一轮生效提示", async () => {
    const user = userEvent.setup()
    const view = data()
    view.toggleTool = vi.fn().mockResolvedValue(true)
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "MCP" }))
    await user.click(screen.getByRole("button", { name: "展开工具 alpha" }))
    await user.click(screen.getByRole("switch", { name: "切换 alpha.read" }))

    expect(screen.queryByText("已保存，将在下一轮回复生效")).not.toBeInTheDocument()
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

  it("MCP tool busy 只禁用当前 tool 开关并展示 spinner", async () => {
    const user = userEvent.setup()
    const view = data()
    view.mcpToolBusy = { alpha: { "alpha.read": true } }
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "MCP" }))
    await user.click(screen.getByRole("button", { name: "展开工具 alpha" }))

    const busySwitch = screen.getByRole("switch", { name: "切换 alpha.read" })
    const idleSwitch = screen.getByRole("switch", { name: "切换 alpha.write" })

    expect(busySwitch).toBeDisabled()
    expect(idleSwitch).toBeEnabled()

    const spinner = busySwitch.querySelector(".animate-spin")
    expect(spinner).toBeInTheDocument()

    const idleKnob = idleSwitch.querySelector(".animate-spin")
    expect(idleKnob).not.toBeInTheDocument()

    expect(screen.queryByText("更新中...")).not.toBeInTheDocument()
  })

  it("MCP server busy 只禁用当前 server 开关并展示 spinner", async () => {
    const user = userEvent.setup()
    const view = data()
    view.mcpBusy = { alpha: true }
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "MCP" }))

    const sw = screen.getByRole("switch", { name: "切换 alpha" })
    expect(sw).toBeDisabled()

    const spinner = sw.querySelector(".animate-spin")
    expect(spinner).toBeInTheDocument()
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

  it("Skills tab 展示 skill 列表并渲染开关", async () => {
    const user = userEvent.setup()
    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "Skills" }))

    expect(screen.getByText("brainstorming")).toBeInTheDocument()
    expect(screen.getByText("debugging")).toBeInTheDocument()

    const enabled = screen.getByRole("switch", { name: "切换 brainstorming" })
    expect(enabled).toHaveAttribute("aria-checked", "true")

    const disabled = screen.getByRole("switch", { name: "切换 debugging" })
    expect(disabled).toHaveAttribute("aria-checked", "false")
  })

  it("Skills tab 点击开关调用 toggleSkill", async () => {
    const user = userEvent.setup()
    const view = data()
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "Skills" }))
    await user.click(screen.getByRole("switch", { name: "切换 debugging" }))

    expect(view.toggleSkill).toHaveBeenCalledWith("debugging")
  })

  it("Skills busy 状态下开关禁用并展示 spinner", async () => {
    const user = userEvent.setup()
    const view = data()
    view.skillBusy = { brainstorming: true }
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "Skills" }))

    const sw = screen.getByRole("switch", { name: "切换 brainstorming" })
    expect(sw).toBeDisabled()
    expect(screen.getByRole("switch", { name: "切换 debugging" })).not.toBeDisabled()

    const spinner = sw.querySelector(".animate-spin")
    expect(spinner).toBeInTheDocument()
  })

  it("Skills tab empty 状态展示空态", async () => {
    const user = userEvent.setup()
    const view = data()
    view.skills = { state: "empty", error: null, updatedAt: null, data: {} }
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "Skills" }))

    expect(screen.getByText("暂无可展示数据")).toBeInTheDocument()
    expect(screen.queryByRole("switch", { name: /切换/ })).not.toBeInTheDocument()
  })

  it("Skills tab failed 状态展示错误并可重试", async () => {
    const user = userEvent.setup()
    const view = data()
    view.skills = { state: "failed", error: "skill failed", updatedAt: null, data: {} }
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "Skills" }))
    await user.click(screen.getByRole("button", { name: "重试" }))

    expect(screen.getByText("数据失败：skill failed")).toBeInTheDocument()
    expect(view.refreshAll).toHaveBeenCalledTimes(1)
  })

  it("Skills tab stale 状态展示陈旧提示并保留旧列表", async () => {
    const user = userEvent.setup()
    const view = data()
    view.skills = {
      state: "stale",
      error: "reload failed",
      updatedAt: new Date("2026-04-29T10:00:00Z").getTime(),
      data: { brainstorming: { enabled: true } },
    }
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "Skills" }))

    expect(screen.getByText(/数据可能不是最新/)).toBeInTheDocument()
    expect(screen.getByRole("switch", { name: "切换 brainstorming" })).toHaveAttribute("aria-checked", "true")
  })

  it("ACP tab 渲染大类和子工具列表并响应开关", async () => {
    const user = userEvent.setup()
    const view = data()
    mocks.useStatusPopoverData.mockReturnValue(view)
    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "ACP" }))

    expect(screen.getByText("ACP 宿主能力")).toBeInTheDocument()
    expect(screen.getByText("VS Code")).toBeInTheDocument()
    expect(screen.getByText("导航代码与命令")).toBeInTheDocument()
    const acpPanel = screen.getByRole("tabpanel", { name: "ACP" })
    expect(within(acpPanel).getByText("1/2 启用")).toBeInTheDocument()

    // 点击大类开关
    const catSwitch = screen.getByRole("switch", { name: "切换 VS Code" })
    expect(catSwitch).toHaveAttribute("aria-checked", "true")
    await user.click(catSwitch)
    expect(view.toggleAcpCategory).toHaveBeenCalledWith("vscode")

    // 展开子工具
    await user.click(screen.getByRole("button", { name: "展开工具 VS Code" }))
    expect(screen.getByText("运行命令")).toBeInTheDocument()
    expect(screen.getByText("运行编辑器命令")).toBeInTheDocument()
    expect(screen.getByText("代码导航")).toBeInTheDocument()

    // 点击子工具开关
    const toolSwitch = screen.getByRole("switch", { name: "切换 代码导航" })
    expect(toolSwitch).toHaveAttribute("aria-checked", "false")
    await user.click(toolSwitch)
    expect(view.toggleAcpTool).toHaveBeenCalledWith("vscode", "nav", true)
  })

  it("ACP 大类关闭时子工具开关允许独立操作且可点击", async () => {
    const user = userEvent.setup()
    const view = data()
    view.acp!.data.categories[0].enabled = false
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "ACP" }))
    await user.click(screen.getByRole("button", { name: "展开工具 VS Code" }))

    const toolSwitch = screen.getByRole("switch", { name: "切换 运行命令" })
    expect(toolSwitch).not.toBeDisabled()
    await user.click(toolSwitch)
    expect(view.toggleAcpTool).toHaveBeenCalled()
  })

  it("ACP 与 MCP 展开区支持一键全部启用与全部禁用", async () => {
    const user = userEvent.setup()
    const view = data()
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    // 测试 ACP 展开区的一键操作
    await user.click(screen.getByRole("tab", { name: "ACP" }))
    await user.click(screen.getByRole("button", { name: "展开工具 VS Code" }))

    const acpPanel = screen.getByRole("tabpanel", { name: "ACP" })
    const enableAllAcp = within(acpPanel).getByRole("button", { name: "全部启用" })
    const disableAllAcp = within(acpPanel).getByRole("button", { name: "全部禁用" })

    await user.click(enableAllAcp)
    expect(view.toggleAllAcpTools).toHaveBeenCalledWith("vscode", true)

    await user.click(disableAllAcp)
    expect(view.toggleAllAcpTools).toHaveBeenCalledWith("vscode", false)

    // 测试 MCP 展开区的一键操作
    await user.click(screen.getByRole("tab", { name: "MCP" }))
    await user.click(screen.getByRole("button", { name: "展开工具 alpha" }))

    const mcpPanel = screen.getByRole("tabpanel", { name: "MCP" })
    const enableAllMcp = within(mcpPanel).getByRole("button", { name: "全部启用" })
    const disableAllMcp = within(mcpPanel).getByRole("button", { name: "全部禁用" })

    await user.click(enableAllMcp)
    expect(view.toggleAllMcpTools).toHaveBeenCalledWith("alpha", true)

    await user.click(disableAllMcp)
    expect(view.toggleAllMcpTools).toHaveBeenCalledWith("alpha", false)
  })

  it("ACP tab 在未连接宿主时显示空状态提示", async () => {
    const user = userEvent.setup()
    const view = data()
    view.acp!.data.installed = false
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "ACP" }))

    expect(screen.getByText("未连接 IDE 宿主")).toBeInTheDocument()
    expect(screen.getByText(/当前运行在独立浏览器模式/)).toBeInTheDocument()
    expect(screen.getByPlaceholderText("搜索 ACP 宿主能力或子工具...")).toBeInTheDocument()
  })

  it("ACP tab 支持搜索过滤并在命中子工具时自动展开", async () => {
    const user = userEvent.setup()
    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "ACP" }))

    const searchInput = screen.getByPlaceholderText("搜索 ACP 宿主能力或子工具...")
    await user.type(searchInput, "运行编辑器命令")

    // 命中了子工具描述，自动展开
    expect(screen.getByText("运行命令")).toBeInTheDocument()
    expect(screen.getByText("运行编辑器命令")).toBeInTheDocument()
    // 未命中的子工具不再展示
    expect(screen.queryByText("代码导航")).not.toBeInTheDocument()
  })

  it("ACP tab 搜索命中大类时保留全部子工具", async () => {
    const user = userEvent.setup()
    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "ACP" }))

    await user.type(screen.getByPlaceholderText("搜索 ACP 宿主能力或子工具..."), "导航代码与命令")

    expect(screen.getByText("运行命令")).toBeInTheDocument()
    expect(screen.getByText("代码导航")).toBeInTheDocument()
  })

  it("ACP tab 扩展工具按来源平铺为多个一级大类", async () => {
    const user = userEvent.setup()
    const view = data()
    view.acp!.data.categories = [
      {
        id: "extensions::browser",
        name: "扩展工具 browser",
        status: "connected",
        enabled: true,
        tools: [
          { id: "open_browser_page", name: "open_browser_page", group: "browser", enabled: true },
          { id: "read_page", name: "read_page", group: "browser", enabled: true },
        ],
      },
      {
        id: "extensions::ms-python.python",
        name: "扩展工具 ms-python.python",
        status: "connected",
        enabled: true,
        tools: [
          {
            id: "install_python_packages",
            name: "install_python_packages",
            group: "ms-python.python",
            enabled: false,
          },
        ],
      },
    ]
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "ACP" }))

    expect(screen.getByText("扩展工具 browser")).toBeInTheDocument()
    expect(screen.getByText("扩展工具 ms-python.python")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "展开工具 扩展工具 browser" }))
    expect(screen.getByText("open_browser_page")).toBeInTheDocument()
    expect(screen.queryByText("install_python_packages")).not.toBeInTheDocument()
  })

  it("MCP tab 搜索只展示命中的子工具", async () => {
    const user = userEvent.setup()
    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "MCP" }))

    await user.type(screen.getByPlaceholderText("搜索 MCP 服务或子工具..."), "read")

    expect(screen.getByText("alpha.read")).toBeInTheDocument()
    expect(screen.queryByText("alpha.write")).not.toBeInTheDocument()
  })

  it("Skills tab 渲染详细描述文本", async () => {
    const user = userEvent.setup()
    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "Skills" }))

    expect(screen.getByText("brainstorming")).toBeInTheDocument()
    expect(screen.getByText("头脑风暴构思")).toBeInTheDocument()
    expect(screen.getByText("Built-in")).toBeInTheDocument()
    expect(screen.getByText("debugging")).toBeInTheDocument()
    expect(screen.getByText("代码调试排错")).toBeInTheDocument()
    expect(screen.getByText("Project")).toBeInTheDocument()
  })

  it("MCP tab 渲染 Server 描述及子工具描述", async () => {
    const user = userEvent.setup()
    const view = data()
    view.mcp.data.alpha = {
      ...view.mcp.data.alpha,
      description: "Alpha MCP 基础服务",
      tools: [
        { id: "alpha.read", name: "alpha.read", description: "读取资源内容", enabled: true },
      ],
    }
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "MCP" }))

    expect(screen.getByText("Alpha MCP 基础服务")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "展开工具 alpha" }))
    expect(screen.getByText("读取资源内容")).toBeInTheDocument()
  })

  it("Skills tab 支持展开完整描述", async () => {
    const user = userEvent.setup()
    const view = data()
    view.skills.data.brainstorming.description =
      "这是一个非常长非常长非常长非常长非常长非常长非常长非常长非常长非常长非常长的技能描述文本，用于验证展开与收起交互"
    mocks.useStatusPopoverData.mockReturnValue(view)

    render(<StatusPopover open={true} connectionState="connected" onClose={vi.fn()} />)

    await user.click(screen.getByRole("tab", { name: "Skills" }))

    const toggleBtn = screen.getByRole("button", { name: "展开全部" })
    expect(toggleBtn).toBeInTheDocument()
    await user.click(toggleBtn)
    expect(screen.getByRole("button", { name: "收起" })).toBeInTheDocument()
  })
})
