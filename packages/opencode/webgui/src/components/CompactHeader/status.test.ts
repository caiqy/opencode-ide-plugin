import { describe, expect, it } from "vitest"

import { DEFAULT_STATUS_TAB, STATUS_TABS, buildLspView, buildMcpView, buildPluginView, buildServerView } from "./status"

describe("CompactHeader/status", () => {
  it("固定 tab 顺序并默认进入 servers", () => {
    expect(DEFAULT_STATUS_TAB).toBe("servers")
    expect(STATUS_TABS.map((item: { id: string }) => item.id)).toEqual(["servers", "mcp", "lsp", "plugins"])
    expect(STATUS_TABS.map((item: { label: string }) => item.label)).toEqual(["Server", "MCP", "LSP", "Plugins"])
  })

  it("buildServerView 只映射连接状态、bridge 和项目路径摘要", () => {
    const view = buildServerView({
      state: "ready",
      error: null,
      updatedAt: 1,
      data: {
        connectionState: "connected",
        project: "p1",
        worktree: "D:/repo",
        directory: "D:/repo",
        bridge: {
          installed: true,
          ready: true,
          customApi: true,
          restartMode: "window",
        },
      },
    })

    expect(view.state).toBe("ready")
    expect(view.summary.project).toBe("p1")
    expect(view.summary.directory).toBe("D:/repo")
    expect(view.summary.connection).toBe("connected")
    expect(view.summary.bridge.ready).toBe(true)
    expect(view.summary).not.toHaveProperty("health")
    expect(view.note).toContain("不提供多 server 管理")
  })

  it("buildPluginView 只展示当前实例配置中的插件列表", () => {
    const ready = buildPluginView({
      state: "ready",
      error: null,
      updatedAt: 2,
      data: ["foo", "bar"],
    })
    expect(ready.items).toEqual(["foo", "bar"])
    expect(ready.state).toBe("ready")

    const empty = buildPluginView({
      state: "empty",
      error: null,
      updatedAt: 2,
      data: [],
    })
    expect(empty.empty).toContain("当前实例")
    expect(empty.empty).toContain("已配置插件")
  })

  it("buildLspView 只展示已连接 LSP 列表", () => {
    const ready = buildLspView({
      state: "ready",
      error: null,
      updatedAt: 2,
      data: [{ id: "ts", name: "TypeScript", root: "D:/repo", status: "connected" }],
    })

    expect(ready.items).toHaveLength(1)
    expect(ready.items[0].name).toBe("TypeScript")

    const failed = buildLspView({
      state: "failed",
      error: "boom",
      updatedAt: null,
      data: [],
    })
    expect(failed.error).toBe("boom")
  })

  it("buildMcpView 保留手动刷新和开关状态", () => {
    const view = buildMcpView({
      state: "ready",
      error: null,
      updatedAt: 3,
      data: {
        alpha: { status: "connected" },
        beta: { status: "disabled" },
        gamma: { status: "failed", error: "bad" },
        delta: { status: "needs_auth" },
      },
    })

    expect(view.refreshLabel).toBe("手动刷新")
    expect(view.items.find((item: { name: string }) => item.name === "alpha")?.enabled).toBe(true)
    expect(view.items.find((item: { name: string }) => item.name === "beta")?.enabled).toBe(false)
    expect(view.items.find((item: { name: string }) => item.name === "gamma")?.error).toBe("bad")
    expect(view.items.find((item: { name: string }) => item.name === "delta")?.disabled).toBe(true)
    expect(view.items.find((item: { name: string }) => item.name === "delta")?.reason).toContain("认证")
  })
})
