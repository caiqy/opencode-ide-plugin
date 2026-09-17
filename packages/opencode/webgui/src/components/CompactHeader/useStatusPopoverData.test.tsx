import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ConnectionState } from "../../lib/api/events"

const mocks = vi.hoisted(() => ({
  mcpStatus: vi.fn(),
  mcpTools: vi.fn(),
  mcpConnect: vi.fn(),
  mcpDisconnect: vi.fn(),
  mcpSetEnabled: vi.fn(),
  mcpSetToolEnabled: vi.fn(),
  lspStatus: vi.fn(),
  configGet: vi.fn(),
  configUpdate: vi.fn(),
  projectCurrent: vi.fn(),
  pathGet: vi.fn(),
  appSkills: vi.fn(),
  appSetSkillEnabled: vi.fn(),
  bridgeGetAcpCapabilities: vi.fn(),
  bridgeInstalled: true,
  bridgeReady: true,
  bridgeCustomApi: true,
  bridgeRestartMode: "window" as "window" | "ide" | null,
}))

vi.mock("../../lib/api/sdkClient", () => ({
  sdk: {
    mcp: {
      status: (...args: unknown[]) => mocks.mcpStatus(...args),
      tools: (...args: unknown[]) => mocks.mcpTools(...args),
      connect: (...args: unknown[]) => mocks.mcpConnect(...args),
      disconnect: (...args: unknown[]) => mocks.mcpDisconnect(...args),
      setEnabled: (...args: unknown[]) => mocks.mcpSetEnabled(...args),
      setToolEnabled: (...args: unknown[]) => mocks.mcpSetToolEnabled(...args),
    },
    lsp: {
      status: (...args: unknown[]) => mocks.lspStatus(...args),
    },
    config: {
      get: (...args: unknown[]) => mocks.configGet(...args),
      update: (...args: unknown[]) => mocks.configUpdate(...args),
    },
    project: {
      current: (...args: unknown[]) => mocks.projectCurrent(...args),
    },
    path: {
      get: (...args: unknown[]) => mocks.pathGet(...args),
    },
    app: {
      skills: (...args: unknown[]) => mocks.appSkills(...args),
      setSkillEnabled: (...args: unknown[]) => mocks.appSetSkillEnabled(...args),
    },
  },
}))

vi.mock("../../lib/ideBridge", () => ({
  ideBridge: {
    isInstalled: () => mocks.bridgeInstalled,
    get ready() {
      return mocks.bridgeReady
    },
    get customApi() {
      return mocks.bridgeCustomApi
    },
    get restartMode() {
      return mocks.bridgeRestartMode
    },
    getAcpCapabilities: (...args: unknown[]) => mocks.bridgeGetAcpCapabilities(...args),
  },
}))

import { useStatusPopoverData } from "./useStatusPopoverData"

function ok<T>(data: T) {
  return { data, error: null }
}

function fail(msg: string) {
  return { data: null, error: { message: msg } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function hook(open: boolean, connectionState: ConnectionState = "connected") {
  return renderHook(
    ({ open, connectionState }: { open: boolean; connectionState: ConnectionState }) =>
      useStatusPopoverData({ open, connectionState }),
    {
      initialProps: { open, connectionState },
    },
  )
}

describe("CompactHeader/useStatusPopoverData", () => {
  beforeEach(() => {
    Reflect.set(globalThis, "__OPENCODE_BACKEND_URL__", "http://127.0.0.1:4096")
    mocks.mcpStatus.mockReset()
    mocks.mcpTools.mockReset()
    mocks.mcpConnect.mockReset()
    mocks.mcpDisconnect.mockReset()
    mocks.mcpSetEnabled.mockReset()
    mocks.mcpSetToolEnabled.mockReset()
    mocks.lspStatus.mockReset()
    mocks.configGet.mockReset()
    mocks.configUpdate.mockReset()
    mocks.projectCurrent.mockReset()
    mocks.pathGet.mockReset()
    mocks.appSkills.mockReset()
    mocks.appSetSkillEnabled.mockReset()
    mocks.bridgeGetAcpCapabilities.mockReset()
    mocks.bridgeInstalled = true
    mocks.bridgeReady = true
    mocks.bridgeCustomApi = true
    mocks.bridgeRestartMode = "window"

    mocks.bridgeGetAcpCapabilities.mockResolvedValue({ categories: [] })

    mocks.mcpStatus.mockResolvedValue(ok({ alpha: { status: "connected" } }))
    mocks.mcpTools.mockImplementation((options: { path: { name: string } }) =>
      ok({
        server: options.path.name,
        connected: options.path.name === "alpha",
        tools:
          options.path.name === "alpha"
            ? [
                {
                  id: "alpha.read",
                  name: "Read",
                  enabled: true,
                },
              ]
            : [],
      }),
    )
    mocks.mcpConnect.mockResolvedValue(ok({}))
    mocks.mcpDisconnect.mockResolvedValue(ok({}))
    mocks.mcpSetEnabled.mockResolvedValue(ok({}))
    mocks.mcpSetToolEnabled.mockResolvedValue(ok({}))
    mocks.lspStatus.mockResolvedValue(ok([{ id: "ts", name: "TypeScript", root: "D:/repo", status: "connected" }]))
    mocks.configGet.mockResolvedValue(ok({ plugin: ["foo", "bar"], tools: {} }))
    mocks.configUpdate.mockResolvedValue(ok({ plugin: ["foo", "bar"], tools: {} }))
    mocks.projectCurrent.mockResolvedValue(ok({ id: "p1", worktree: "D:/repo", time: { created: 1 } }))
    mocks.pathGet.mockResolvedValue(ok({ state: "ready", config: "cfg", worktree: "D:/repo", directory: "D:/repo" }))
    mocks.appSkills.mockResolvedValue(
      ok([
        { name: "brainstorming", description: "Brainstorming skill", enabled: true },
        { name: "debugging", description: "Debugging skill", enabled: true },
      ]),
    )
  })

  it("在打开弹层时聚合首版所需数据", async () => {
    const view = hook(false)
    expect(mocks.mcpStatus).not.toHaveBeenCalled()

    view.rerender({ open: true, connectionState: "connected" })

    await waitFor(() => {
      expect(mocks.mcpStatus).toHaveBeenCalledTimes(1)
      expect(mocks.lspStatus).toHaveBeenCalledTimes(1)
      expect(mocks.configGet).toHaveBeenCalledTimes(1)
      expect(mocks.projectCurrent).toHaveBeenCalledTimes(1)
      expect(mocks.pathGet).toHaveBeenCalledTimes(1)
      expect(view.result.current.servers.state).toBe("ready")
    })

    expect(view.result.current.connectionState).toBe("connected")
    expect(view.result.current.servers.state).toBe("ready")
    expect(view.result.current.servers.data.backendUrl).toBe("http://127.0.0.1:4096")
    expect(view.result.current.servers.data.project).toBe("p1")
    expect(view.result.current.servers.data.directory).toBe("D:/repo")
    expect(view.result.current.servers.data.bridge.ready).toBe(true)
    expect(view.result.current.plugins.state).toBe("ready")
    expect(view.result.current.plugins.data).toEqual(["foo", "bar"])
    expect(view.result.current.lsp.state).toBe("ready")
    expect(view.result.current.mcp.state).toBe("ready")
  })

  it("refreshAll 不等待 skills 慢请求即可更新其他分区", async () => {
    const skills = deferred<ReturnType<typeof ok>>()
    mocks.appSkills.mockImplementationOnce(() => skills.promise)

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.servers.state).toBe("ready")
      expect(view.result.current.mcp.state).toBe("ready")
      expect(view.result.current.plugins.state).toBe("ready")
    })
    expect(view.result.current.skills.state).toBe("empty")

    await act(async () => {
      skills.resolve(ok([{ name: "brainstorming", description: "Brainstorming skill", enabled: true }]))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(view.result.current.skills.state).toBe("ready")
    })
  })

  it("refreshAll 不等待 config 慢请求即可更新非 config 分区", async () => {
    const cfg = deferred<ReturnType<typeof ok>>()
    mocks.configGet.mockImplementationOnce(() => cfg.promise)

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.servers.state).toBe("ready")
      expect(view.result.current.mcp.state).toBe("ready")
      expect(view.result.current.lsp.state).toBe("ready")
    })
    expect(view.result.current.plugins.state).toBe("empty")
    await waitFor(() => {
      expect(view.result.current.skills.state).toBe("ready")
    })

    await act(async () => {
      cfg.resolve(ok({ plugin: ["foo"], tools: {} }))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(view.result.current.plugins.state).toBe("ready")
      expect(view.result.current.skills.state).toBe("ready")
    })
  })

  it("refreshAll 遇到 config 失败时只请求一次 config", async () => {
    mocks.configGet.mockResolvedValue(fail("config error"))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.plugins.state).toBe("failed")
      expect(view.result.current.skills.state).toBe("ready")
    })

    expect(mocks.configGet).toHaveBeenCalledTimes(1)
  })

  it("单个分区刷新失败时保留旧快照并标记 stale", async () => {
    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.plugins.state).toBe("ready")
    })

    mocks.configGet.mockResolvedValueOnce(fail("config boom"))

    await act(async () => {
      await view.result.current.refreshAll()
    })

    expect(view.result.current.plugins.state).toBe("stale")
    expect(view.result.current.plugins.data).toEqual(["foo", "bar"])
    expect(view.result.current.plugins.error).toBe("config boom")
    expect(view.result.current.lsp.state).toBe("ready")
    expect(view.result.current.mcp.state).toBe("ready")
  })

  it("servers 分区首次失败时标记 failed", async () => {
    mocks.projectCurrent.mockResolvedValueOnce(fail("project boom"))
    mocks.pathGet.mockResolvedValueOnce(fail("path boom"))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.servers.state).toBe("failed")
    })

    expect(view.result.current.servers.error).toContain("project boom")
  })

  it("servers 分区刷新失败后保留旧快照并标记 stale", async () => {
    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.servers.state).toBe("ready")
    })

    mocks.projectCurrent.mockResolvedValueOnce(fail("project boom"))
    mocks.pathGet.mockResolvedValueOnce(fail("path boom"))

    await act(async () => {
      await view.result.current.refreshAll()
    })

    expect(view.result.current.servers.state).toBe("stale")
    expect(view.result.current.servers.data.project).toBe("p1")
    expect(view.result.current.servers.error).toContain("project boom")
  })

  it("未注入 opencode backend 地址时回退到当前 origin", async () => {
    Reflect.deleteProperty(globalThis, "__OPENCODE_BACKEND_URL__")

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.servers.state).toBe("ready")
    })

    expect(view.result.current.servers.data.backendUrl).toBe(window.location.origin)
  })

  it("refreshMcp 只刷新 MCP 分区", async () => {
    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.mcp.state).toBe("ready")
    })

    mocks.mcpStatus.mockResolvedValueOnce(ok({ alpha: { status: "disabled" } }))

    await act(async () => {
      await view.result.current.refreshMcp()
    })

    expect(mocks.mcpStatus).toHaveBeenCalledTimes(2)
    expect(mocks.lspStatus).toHaveBeenCalledTimes(1)
    expect(mocks.configGet).toHaveBeenCalledTimes(1)
    expect(view.result.current.mcp.data.alpha?.status).toBe("disabled")
  })

  it("refreshAll 与 refreshMcp 都会拉取 connected server 的工具列表", async () => {
    mocks.mcpStatus
      .mockResolvedValueOnce(ok({ alpha: { status: "connected" }, beta: { status: "disabled" } }))
      .mockResolvedValueOnce(ok({ alpha: { status: "connected" }, beta: { status: "disabled" } }))
    mocks.mcpTools.mockImplementation((options: { path: { name: string } }) =>
      ok({
        server: options.path.name,
        connected: true,
        tools: [
          {
            id: `${options.path.name}.read`,
            name: "Read",
            enabled: true,
          },
        ],
      }),
    )

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.mcp.state).toBe("ready")
      expect(view.result.current.mcp.data.alpha?.tools?.[0]?.id).toBe("alpha.read")
      expect(view.result.current.mcp.data.beta?.tools).toEqual([])
    })

    expect(mocks.mcpTools).toHaveBeenCalledTimes(1)
    expect(mocks.mcpTools).toHaveBeenCalledWith({ path: { name: "alpha" } })

    await act(async () => {
      await view.result.current.refreshMcp()
    })

    expect(mocks.mcpTools).toHaveBeenCalledTimes(2)
  })

  it("refreshMcp 期间 mcpRefreshing 为 true", async () => {
    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.mcp.state).toBe("ready")
    })

    const gate = deferred<{ data: Record<string, { status: "connected" }>; error: null }>()
    mocks.mcpStatus.mockImplementationOnce(() => gate.promise)

    act(() => {
      void view.result.current.refreshMcp()
    })

    await waitFor(() => {
      expect(view.result.current.mcpRefreshing).toBe(true)
    })

    await act(async () => {
      gate.resolve(ok({ alpha: { status: "connected" } }))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(view.result.current.mcpRefreshing).toBe(false)
    })
  })

  it("refreshMcp reject 时保留旧快照并标记 stale", async () => {
    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.mcp.state).toBe("ready")
    })

    mocks.mcpStatus.mockRejectedValueOnce(new Error("mcp boom"))

    await act(async () => {
      await view.result.current.refreshMcp()
    })

    expect(view.result.current.mcp.state).toBe("stale")
    expect(view.result.current.mcp.error).toContain("mcp boom")
  })

  it("toggleMcp 会按当前状态切换并局部刷新", async () => {
    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.mcp.state).toBe("ready")
    })
    expect(mocks.mcpStatus).toHaveBeenCalledTimes(1)

    mocks.mcpStatus.mockResolvedValueOnce(ok({ alpha: { status: "disabled" } }))

    await act(async () => {
      await view.result.current.toggleMcp("alpha")
    })

    expect(mocks.mcpSetEnabled).toHaveBeenCalledWith({
      path: { name: "alpha" },
      body: { enabled: false },
    })
    expect(mocks.mcpDisconnect).not.toHaveBeenCalled()
    expect(mocks.mcpStatus).toHaveBeenCalledTimes(2)
    expect(view.result.current.mcp.data.alpha?.status).toBe("disabled")
  })

  it("toggleMcp reject 时保留旧快照并标记 stale", async () => {
    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.mcp.state).toBe("ready")
    })

    mocks.mcpSetEnabled.mockRejectedValueOnce(new Error("toggle boom"))

    await act(async () => {
      await view.result.current.toggleMcp("alpha")
    })

    expect(view.result.current.mcp.state).toBe("stale")
    expect(view.result.current.mcp.error).toContain("toggle boom")
  })

  it("toggleMcp resolved error 时保留旧快照并标记 stale", async () => {
    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.mcp.state).toBe("ready")
    })

    mocks.mcpSetEnabled.mockResolvedValueOnce(fail("toggle error"))

    await act(async () => {
      await view.result.current.toggleMcp("alpha")
    })

    expect(view.result.current.mcp.state).toBe("stale")
    expect(view.result.current.mcp.error).toContain("toggle error")
    expect(mocks.mcpStatus).toHaveBeenCalledTimes(1)
  })

  it("toggleTool 只锁当前工具 busy", async () => {
    mocks.mcpTools.mockResolvedValueOnce(
      ok({
        server: "alpha",
        connected: true,
        tools: [
          {
            id: "alpha.read",
            name: "Read",
            enabled: true,
          },
          {
            id: "alpha.write",
            name: "Write",
            enabled: true,
          },
        ],
      }),
    )
    const gate = deferred<ReturnType<typeof ok>>()
    mocks.mcpSetToolEnabled.mockImplementationOnce(() => gate.promise)
    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.mcp.data.alpha?.tools?.length).toBe(2)
    })

    act(() => {
      void view.result.current.toggleTool("alpha", "alpha.read", false)
    })

    await waitFor(() => {
      expect(view.result.current.mcpToolBusy.alpha?.["alpha.read"]).toBe(true)
      expect(view.result.current.mcpToolBusy.alpha?.["alpha.write"]).toBeUndefined()
    })

    await act(async () => {
      gate.resolve(ok({ plugin: ["foo", "bar"], tools: { "alpha.read": false } }))
      await Promise.resolve()
    })
  })

  it("toggleTool 成功后更新 tools 配置并刷新 MCP 工具数据", async () => {
    mocks.mcpTools
      .mockResolvedValueOnce(
        ok({
          server: "alpha",
          connected: true,
          tools: [
            {
              id: "alpha.read",
              name: "Read",
              enabled: true,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        ok({
          server: "alpha",
          connected: true,
          tools: [
            {
              id: "alpha.read",
              name: "Read",
              enabled: false,
            },
          ],
        }),
      )
    mocks.configGet.mockResolvedValue(ok({ plugin: ["foo", "bar"], tools: {} }))
    mocks.mcpSetToolEnabled.mockResolvedValue(ok({}))
    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.mcp.data.alpha?.tools?.[0]?.enabled).toBe(true)
    })
    expect(mocks.mcpStatus).toHaveBeenCalledTimes(1)

    let res = false
    await act(async () => {
      res = await view.result.current.toggleTool("alpha", "alpha.read", false)
    })

    expect(res).toBe(true)
    expect(mocks.mcpSetToolEnabled).toHaveBeenCalledWith({
      path: { name: "alpha", toolId: "alpha.read" },
      body: { enabled: false },
    })
    expect(mocks.configUpdate).not.toHaveBeenCalled()
    expect(mocks.mcpStatus).toHaveBeenCalledTimes(2)
    expect(mocks.mcpTools).toHaveBeenCalledTimes(2)
    expect(view.result.current.mcp.data.alpha?.tools?.[0]?.enabled).toBe(false)
  })

  it("toggleTool 失败时回滚并标记 stale", async () => {
    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.mcp.data.alpha?.tools?.[0]?.enabled).toBe(true)
    })

    mocks.mcpSetToolEnabled.mockRejectedValueOnce(new Error("tool boom"))

    let res = true
    await act(async () => {
      res = await view.result.current.toggleTool("alpha", "alpha.read", false)
    })

    expect(res).toBe(false)
    expect(view.result.current.mcp.state).toBe("stale")
    expect(view.result.current.mcp.error).toContain("tool boom")
    expect(view.result.current.mcp.data.alpha?.tools?.[0]?.enabled).toBe(true)
  })

  it("连接状态变化时会重拉并忽略旧请求结果", async () => {
    const project = deferred<ReturnType<typeof ok>>()
    const path = deferred<ReturnType<typeof ok>>()
    const mcp = deferred<ReturnType<typeof ok>>()
    const lsp = deferred<ReturnType<typeof ok>>()

    mocks.projectCurrent
      .mockImplementationOnce(() => project.promise)
      .mockResolvedValueOnce(ok({ id: "p2", worktree: "D:/repo2", time: { created: 2 } }))
    mocks.pathGet
      .mockImplementationOnce(() => path.promise)
      .mockResolvedValueOnce(ok({ state: "ready", config: "cfg", worktree: "D:/repo2", directory: "D:/repo2" }))
    mocks.mcpStatus
      .mockImplementationOnce(() => mcp.promise)
      .mockResolvedValueOnce(ok({ alpha: { status: "disabled" } }))
    mocks.lspStatus
      .mockImplementationOnce(() => lsp.promise)
      .mockResolvedValueOnce(ok([{ id: "go", name: "Go", root: "D:/repo2", status: "connected" }]))
    mocks.configGet.mockResolvedValueOnce(ok({ plugin: ["bar"] }))

    const view = hook(true, "connected")
    view.rerender({ open: true, connectionState: "disconnected" })

    await waitFor(() => {
      expect(mocks.projectCurrent).toHaveBeenCalledTimes(2)
      expect(view.result.current.connectionState).toBe("disconnected")
    })

    project.resolve(ok({ id: "p1", worktree: "D:/repo", time: { created: 1 } }))
    path.resolve(ok({ state: "ready", config: "cfg", worktree: "D:/repo", directory: "D:/repo" }))
    mcp.resolve(ok({ alpha: { status: "connected" } }))
    lsp.resolve(ok([{ id: "ts", name: "TypeScript", root: "D:/repo", status: "connected" }]))
    await waitFor(() => {
      expect(view.result.current.servers.data.connectionState).toBe("disconnected")
      expect(view.result.current.servers.data.project).toBe("p2")
      expect(view.result.current.plugins.data).toEqual(["bar"])
    })
  })

  it("重复切换同一个 MCP 只发起一次请求", async () => {
    const gate = deferred<void>()
    mocks.mcpDisconnect.mockImplementationOnce(() => gate.promise)
    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.mcp.state).toBe("ready")
    })

    act(() => {
      void view.result.current.toggleMcp("alpha")
      void view.result.current.toggleMcp("alpha")
    })

    expect(mocks.mcpSetEnabled).toHaveBeenCalledTimes(1)

    await act(async () => {
      gate.resolve(undefined)
      await Promise.resolve()
    })
  })

  it("refreshAll 的旧 MCP 结果不会覆盖更晚的 refreshMcp", async () => {
    const full = deferred<ReturnType<typeof ok>>()
    mocks.mcpStatus
      .mockImplementationOnce(() => full.promise)
      .mockResolvedValueOnce(ok({ alpha: { status: "disabled" } }))

    const view = hook(true)

    await waitFor(() => {
      expect(mocks.mcpStatus).toHaveBeenCalledTimes(1)
    })

    await act(async () => {
      await view.result.current.refreshMcp()
    })

    expect(view.result.current.mcp.data.alpha?.status).toBe("disabled")

    await act(async () => {
      full.resolve(ok({ alpha: { status: "connected" } }))
      await Promise.resolve()
    })

    expect(view.result.current.mcp.data.alpha?.status).toBe("disabled")
  })

  it("refreshAll 使用后端返回的 effective enabled 状态", async () => {
    mocks.appSkills.mockResolvedValue(
      ok([
        { name: "brainstorming", description: "Brainstorming skill", enabled: true },
        { name: "debugging", description: "Debugging skill", enabled: false },
      ]),
    )

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.skills.state).toBe("ready")
    })

    expect(view.result.current.skills.data.brainstorming?.enabled).toBe(true)
    expect(view.result.current.skills.data.debugging?.enabled).toBe(false)
  })

  it("refreshAll 不依赖 config 即可加载 skills effective 状态", async () => {
    mocks.appSkills.mockResolvedValue(
      ok([
        { name: "allowed", description: "Allowed skill", enabled: true },
        { name: "denied", description: "Denied skill", enabled: false },
      ]),
    )
    mocks.configGet.mockResolvedValue(fail("config error"))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.skills.state).toBe("ready")
    })

    expect(view.result.current.skills.data.allowed?.enabled).toBe(true)
    expect(view.result.current.skills.data.denied?.enabled).toBe(false)
  })

  it("skills 加载失败时走 failed 分支", async () => {
    mocks.appSkills.mockResolvedValue(fail("skill error"))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.skills.state).not.toBe("empty")
    })

    expect(view.result.current.skills.state).toBe("failed")
    expect(view.result.current.skills.error).toBe("skill error")
  })

  it("toggleSkill 调用 setSkillEnabled 并刷新列表", async () => {
    mocks.appSetSkillEnabled.mockResolvedValue(ok(true))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.skills.state).toBe("ready")
    })

    await act(async () => {
      await view.result.current.toggleSkill("brainstorming")
    })

    expect(mocks.appSetSkillEnabled).toHaveBeenCalledWith({
      path: { name: "brainstorming" },
      body: { enabled: false },
    })
  })

  it("toggleSkill 成功后刷新并更新本地 enabled 状态", async () => {
    mocks.appSkills
      .mockResolvedValueOnce(
        ok([
          { name: "brainstorming", description: "Brainstorming skill", enabled: true },
          { name: "debugging", description: "Debugging skill", enabled: true },
        ]),
      )
      .mockResolvedValueOnce(
        ok([
          { name: "brainstorming", description: "Brainstorming skill", enabled: false },
          { name: "debugging", description: "Debugging skill", enabled: true },
        ]),
      )
    mocks.appSetSkillEnabled.mockResolvedValue(ok(true))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.skills.data.brainstorming?.enabled).toBe(true)
    })

    await act(async () => {
      await view.result.current.toggleSkill("brainstorming")
    })

    expect(view.result.current.skills.state).toBe("ready")
    expect(view.result.current.skills.data.brainstorming?.enabled).toBe(false)
  })

  it("toggleSkill 请求失败时保留旧数据并标记 stale", async () => {
    mocks.appSetSkillEnabled.mockResolvedValue(fail("toggle error"))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.skills.state).toBe("ready")
    })

    await act(async () => {
      await view.result.current.toggleSkill("brainstorming")
    })

    expect(view.result.current.skills.state).toBe("stale")
    expect(view.result.current.skills.error).toBe("toggle error")
    expect(view.result.current.skills.data.brainstorming?.enabled).toBe(true)
  })

  it("toggleSkill 刷新失败时保留旧数据并标记 stale", async () => {
    mocks.appSkills
      .mockResolvedValueOnce(
        ok([
          { name: "brainstorming", description: "Brainstorming skill", enabled: true },
          { name: "debugging", description: "Debugging skill", enabled: true },
        ]),
      )
      .mockResolvedValueOnce(fail("reload skill error"))
    mocks.appSetSkillEnabled.mockResolvedValue(ok(true))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.skills.state).toBe("ready")
    })

    await act(async () => {
      await view.result.current.toggleSkill("brainstorming")
    })

    expect(view.result.current.skills.state).toBe("stale")
    expect(view.result.current.skills.error).toBe("reload skill error")
    expect(view.result.current.skills.data.brainstorming?.enabled).toBe(true)
  })

  it("toggleSkill 对同一个 skill 防重入", async () => {
    const gate = deferred<ReturnType<typeof ok>>()
    mocks.appSetSkillEnabled.mockImplementation(() => gate.promise)

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.skills.state).toBe("ready")
    })

    await act(async () => {
      const first = view.result.current.toggleSkill("brainstorming")
      const second = view.result.current.toggleSkill("brainstorming")
      gate.resolve(ok(true))
      await Promise.all([first, second])
    })

    expect(mocks.appSetSkillEnabled).toHaveBeenCalledTimes(1)
  })

  it("toggleSkill 成功后不会被更早的 refreshAll 旧结果覆盖", async () => {
    const oldSkills = deferred<ReturnType<typeof ok>>()
    mocks.appSkills
      .mockResolvedValueOnce(
        ok([
          { name: "brainstorming", description: "Brainstorming skill", enabled: true },
          { name: "debugging", description: "Debugging skill", enabled: true },
        ]),
      )
      .mockImplementationOnce(() => oldSkills.promise)
      .mockResolvedValueOnce(
        ok([
          { name: "brainstorming", description: "Brainstorming skill", enabled: false },
          { name: "debugging", description: "Debugging skill", enabled: true },
        ]),
      )
    mocks.appSetSkillEnabled.mockResolvedValue(ok(true))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.skills.data.brainstorming?.enabled).toBe(true)
    })

    const refresh = view.result.current.refreshAll()

    await waitFor(() => {
      expect(mocks.appSkills).toHaveBeenCalledTimes(2)
    })

    await act(async () => {
      await view.result.current.toggleSkill("brainstorming")
    })
    expect(view.result.current.skills.data.brainstorming?.enabled).toBe(false)

    await act(async () => {
      oldSkills.resolve(
        ok([
          { name: "brainstorming", description: "Brainstorming skill", enabled: true },
          { name: "debugging", description: "Debugging skill", enabled: true },
        ]),
      )
      await refresh
    })

    expect(view.result.current.skills.data.brainstorming?.enabled).toBe(false)
  })

  it("toggleSkill 不会取消并发 refreshAll 的非 skills 分区提交", async () => {
    const project = deferred<ReturnType<typeof ok>>()
    const path = deferred<ReturnType<typeof ok>>()
    mocks.appSetSkillEnabled.mockResolvedValue(ok(true))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.servers.data.project).toBe("p1")
      expect(view.result.current.skills.data.brainstorming?.enabled).toBe(true)
    })

    mocks.projectCurrent.mockImplementationOnce(() => project.promise)
    mocks.pathGet.mockImplementationOnce(() => path.promise)

    const refresh = view.result.current.refreshAll()

    await waitFor(() => {
      expect(mocks.projectCurrent).toHaveBeenCalledTimes(2)
    })

    mocks.appSkills.mockResolvedValueOnce(
      ok([
        { name: "brainstorming", description: "Brainstorming skill", enabled: false },
        { name: "debugging", description: "Debugging skill", enabled: true },
      ]),
    )

    await act(async () => {
      await view.result.current.toggleSkill("brainstorming")
    })

    await act(async () => {
      project.resolve(ok({ id: "p2", worktree: "D:/repo2", time: { created: 2 } }))
      path.resolve(ok({ state: "ready", config: "cfg", worktree: "D:/repo2", directory: "D:/repo2" }))
      await refresh
    })

    expect(view.result.current.servers.data.project).toBe("p2")
    expect(view.result.current.skills.data.brainstorming?.enabled).toBe(false)
  })

  it("加载 ACP 宿主能力并根据 opencode.json 配置初始化开关状态", async () => {
    mocks.bridgeGetAcpCapabilities.mockResolvedValue({
      categories: [
        {
          id: "vscode",
          name: "VS Code",
          description: "VS Code 命令与导航",
          status: "connected",
          tools: [
            { id: "exec", name: "执行命令", description: "运行命令" },
            { id: "nav", name: "代码导航", description: "代码导航" },
          ],
        },
      ],
    })
    mocks.configGet.mockResolvedValue(
      ok({
        acp: {
          vscode: {
            enabled: true,
            tools: { exec: true, nav: false },
          },
        },
      }),
    )

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.acp.state).toBe("ready")
      expect(view.result.current.acp.data.installed).toBe(true)
      expect(view.result.current.acp.data.categories).toHaveLength(1)
    })

    const cat = view.result.current.acp.data.categories[0]
    expect(cat.name).toBe("VS Code")
    expect(cat.enabled).toBe(true)
    expect(cat.tools.find((t) => t.id === "exec")?.enabled).toBe(true)
    expect(cat.tools.find((t) => t.id === "nav")?.enabled).toBe(false)
  })

  it("扩展工具按来源拍扁为多个一级大类且开关写回原始大类", async () => {
    mocks.bridgeGetAcpCapabilities.mockResolvedValue({
      categories: [
        {
          id: "extensions",
          name: "扩展工具",
          status: "connected",
          tools: [
            { id: "open_browser_page", name: "open_browser_page", group: "browser" },
            { id: "read_page", name: "read_page", group: "browser" },
            { id: "install_python_packages", name: "install_python_packages", group: "ms-python.python" },
          ],
        },
      ],
    })
    mocks.configGet.mockResolvedValue(
      ok({
        acp: {
          platform_vscode: {
            extensions: {
              enabled: true,
              tools: { open_browser_page: true, read_page: true, install_python_packages: true },
            },
          },
        },
      }),
    )
    mocks.configUpdate.mockResolvedValue(ok({}))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.acp.data.categories).toHaveLength(2)
    })

    const browser = view.result.current.acp.data.categories.find((c) => c.id === "extensions::browser")
    expect(browser?.name).toBe("扩展工具 browser")
    expect(browser?.tools.map((t) => t.id)).toEqual(["open_browser_page", "read_page"])
    expect(view.result.current.acp.data.categories.find((c) => c.id === "extensions::ms-python.python")?.name).toBe(
      "扩展工具 ms-python.python",
    )

    await act(async () => {
      await view.result.current.toggleAllAcpTools("extensions::browser", false)
    })

    // 分组停用只写本组子工具，不写大类 enabled，避免连带其他分组
    const disablePayload = mocks.configUpdate.mock.calls.at(-1)?.[0] as any
    expect(disablePayload.body.acp.platform_vscode.extensions).toEqual({
      tools: { open_browser_page: false, read_page: false },
    })

    const browserAfter = view.result.current.acp.data.categories.find((c) => c.id === "extensions::browser")
    expect(browserAfter?.tools.every((t) => !t.enabled)).toBe(true)
    expect(browserAfter?.enabled).toBe(false)
    const pythonAfter = view.result.current.acp.data.categories.find((c) => c.id === "extensions::ms-python.python")
    expect(pythonAfter?.tools[0]?.enabled).toBe(true)

    // 分组开关之间互不影响
    await act(async () => {
      await view.result.current.toggleAcpCategory("extensions::browser")
    })

    const enablePayload = mocks.configUpdate.mock.calls.at(-1)?.[0] as any
    expect(enablePayload.body.acp.platform_vscode.extensions).toEqual({
      enabled: true,
      tools: { open_browser_page: true, read_page: true },
    })

    const browserEnabled = view.result.current.acp.data.categories.find((c) => c.id === "extensions::browser")
    expect(browserEnabled?.enabled).toBe(true)
    expect(browserEnabled?.tools.every((t) => t.enabled)).toBe(true)
    const pythonUntouched = view.result.current.acp.data.categories.find((c) => c.id === "extensions::ms-python.python")
    expect(pythonUntouched?.enabled).toBe(true)
    expect(pythonUntouched?.tools[0]?.enabled).toBe(true)
  })

  it("扩展工具分组只要有子工具启用，分组开关即与普通大类一样保持开启", async () => {
    mocks.bridgeGetAcpCapabilities.mockResolvedValue({
      categories: [
        {
          id: "extensions",
          name: "扩展工具",
          status: "connected",
          tools: [
            { id: "open_browser_page", name: "open_browser_page", group: "browser" },
            { id: "read_page", name: "read_page", group: "browser" },
            { id: "install_python_packages", name: "install_python_packages", group: "ms-python.python" },
          ],
        },
      ],
    })
    mocks.configGet.mockResolvedValue(
      ok({
        acp: {
          platform_vscode: {
            extensions: {
              enabled: true,
              tools: { open_browser_page: true, read_page: false },
            },
          },
        },
      }),
    )
    mocks.configUpdate.mockResolvedValue(ok({}))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.acp.data.categories).toHaveLength(2)
    })

    // 部分子工具启用时，分组开关也应为开启
    const partial = view.result.current.acp.data.categories.find((c) => c.id === "extensions::browser")
    expect(partial?.enabled).toBe(true)
    expect(partial?.tools.find((t) => t.id === "read_page")?.enabled).toBe(false)

    // 再停用其中一个子工具后，分组开关仍保持开启
    await act(async () => {
      await view.result.current.toggleAcpTool("extensions::browser", "open_browser_page", false)
    })
    const bothOff = view.result.current.acp.data.categories.find((c) => c.id === "extensions::browser")
    expect(bothOff?.enabled).toBe(false)

    await act(async () => {
      await view.result.current.toggleAcpTool("extensions::browser", "read_page", true)
    })
    const stillPartial = view.result.current.acp.data.categories.find((c) => c.id === "extensions::browser")
    expect(stillPartial?.enabled).toBe(true)

    // 关闭分组开关后本组工具全部停用
    await act(async () => {
      await view.result.current.toggleAcpCategory("extensions::browser")
    })
    const off = view.result.current.acp.data.categories.find((c) => c.id === "extensions::browser")
    expect(off?.enabled).toBe(false)
    expect(off?.tools.every((t) => !t.enabled)).toBe(true)
  })

  it("ACP 在独立外部浏览器模式下保持 installed: false", async () => {
    mocks.bridgeInstalled = false

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.acp.state).toBe("ready")
      expect(view.result.current.acp.data.installed).toBe(false)
      expect(view.result.current.acp.data.categories).toHaveLength(0)
    })
  })

  it("toggleAcpCategory 关闭大类时级联停用子工具并调用 config.update", async () => {
    mocks.bridgeGetAcpCapabilities.mockResolvedValue({
      categories: [
        {
          id: "vscode",
          name: "VS Code",
          status: "connected",
          tools: [
            { id: "exec", name: "执行命令" },
            { id: "nav", name: "代码导航" },
          ],
        },
      ],
    })
    mocks.configGet.mockResolvedValue(
      ok({
        acp: {
          vscode: {
            enabled: true,
            tools: { exec: true, nav: false },
          },
        },
      }),
    )
    mocks.configUpdate.mockResolvedValue(ok({}))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.acp.data.categories).toHaveLength(1)
    })

    await act(async () => {
      await view.result.current.toggleAcpCategory("vscode")
    })

    // 验证大类已禁用，子工具全部为 false
    const cat = view.result.current.acp.data.categories[0]
    expect(cat.enabled).toBe(false)
    expect(cat.tools.every((t) => !t.enabled)).toBe(true)

    expect(mocks.configUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          acp: expect.objectContaining({
            platform_vscode: expect.objectContaining({
              vscode: expect.objectContaining({
                enabled: false,
                tools: expect.objectContaining({ exec: true, nav: false }),
              }),
            }),
          }),
        }),
      }),
    )

    // 重新开启大类，验证记忆恢复模式（exec: true, nav: false）
    await act(async () => {
      await view.result.current.toggleAcpCategory("vscode")
    })

    const restoredCat = view.result.current.acp.data.categories[0]
    expect(restoredCat.enabled).toBe(true)
    expect(restoredCat.tools.find((t) => t.id === "exec")?.enabled).toBe(true)
    expect(restoredCat.tools.find((t) => t.id === "nav")?.enabled).toBe(false)
  })

  it("跨会话/重新加载后保留关闭大类的子项偏好并在开启时精准恢复", async () => {
    mocks.bridgeGetAcpCapabilities.mockResolvedValue({
      categories: [
        {
          id: "vscode",
          name: "VS Code",
          status: "connected",
          tools: [
            { id: "exec", name: "执行命令" },
            { id: "nav", name: "代码导航" },
          ],
        },
      ],
    })
    // 模拟服务端 opencode.json 中存储的状态：大类为关闭，但保留了此前定制的工具偏好 (exec: true, nav: false)
    mocks.configGet.mockResolvedValue(
      ok({
        acp: {
          vscode: {
            enabled: false,
            tools: { exec: true, nav: false },
          },
        },
      }),
    )
    mocks.configUpdate.mockResolvedValue(ok({}))

    // 重新挂载 hook
    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.acp.data.categories).toHaveLength(1)
    })

    // 初始关闭状态下，UI 上子工具由于大类关闭而显示为 false
    const initialCat = view.result.current.acp.data.categories[0]
    expect(initialCat.enabled).toBe(false)
    expect(initialCat.tools.every((t) => !t.enabled)).toBe(true)

    // 用户重新开启大类
    await act(async () => {
      await view.result.current.toggleAcpCategory("vscode")
    })

    // 验证成功从 opencode.json 恢复历史配置 (exec: true, nav: false)
    const restoredCat = view.result.current.acp.data.categories[0]
    expect(restoredCat.enabled).toBe(true)
    expect(restoredCat.tools.find((t) => t.id === "exec")?.enabled).toBe(true)
    expect(restoredCat.tools.find((t) => t.id === "nav")?.enabled).toBe(false)
  })

  it("toggleAcpTool 切换子工具状态并持久化", async () => {
    mocks.bridgeGetAcpCapabilities.mockResolvedValue({
      categories: [
        {
          id: "vscode",
          name: "VS Code",
          status: "connected",
          tools: [
            { id: "exec", name: "执行命令" },
            { id: "nav", name: "代码导航" },
          ],
        },
      ],
    })
    mocks.configGet.mockResolvedValue(ok({ acp: { platform_vscode: { vscode: { enabled: true, tools: { exec: true, nav: true } } } } }))
    mocks.configUpdate.mockResolvedValue(ok({}))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.acp.data.categories).toHaveLength(1)
    })

    await act(async () => {
      await view.result.current.toggleAcpTool("vscode", "nav", false)
    })

    const cat = view.result.current.acp.data.categories[0]
    expect(cat.tools.find((t) => t.id === "nav")?.enabled).toBe(false)

    expect(mocks.configUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          acp: expect.objectContaining({
            platform_vscode: expect.objectContaining({
              vscode: expect.objectContaining({
                enabled: true,
                tools: expect.objectContaining({ nav: false }),
              }),
            }),
          }),
        }),
      }),
    )
  })

  it("toggleAcpCategory 失败时回滚开关状态", async () => {
    mocks.bridgeGetAcpCapabilities.mockResolvedValue({
      categories: [
        {
          id: "vscode",
          name: "VS Code",
          status: "connected",
          tools: [{ id: "exec", name: "执行命令" }],
        },
      ],
    })
    mocks.configGet.mockResolvedValue(ok({ acp: { vscode: { enabled: true } } }))
    mocks.configUpdate.mockResolvedValue(fail("config write failed"))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.acp.data.categories[0]?.enabled).toBe(true)
    })

    await act(async () => {
      await view.result.current.toggleAcpCategory("vscode")
    })

    // 失败后调用 refreshAcp 回滚回原状态
    await waitFor(() => {
      expect(view.result.current.acp.data.categories[0]?.enabled).toBe(true)
    })
  })

  it("ACP 默认全量禁用（未配置时大类及子工具为 false）", async () => {
    mocks.bridgeGetAcpCapabilities.mockResolvedValue({
      categories: [
        {
          id: "vscode",
          name: "VS Code",
          status: "connected",
          tools: [
            { id: "exec", name: "执行命令" },
            { id: "nav", name: "代码导航" },
          ],
        },
      ],
    })
    mocks.configGet.mockResolvedValue(ok({}))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.acp.data.categories).toHaveLength(1)
    })

    const cat = view.result.current.acp.data.categories[0]
    expect(cat.enabled).toBe(false)
    expect(cat.tools.every((t) => t.enabled === false)).toBe(true)
  })

  it("ACP 大类关闭状态下，点击开启子工具能自动级联激活大类且仅开启该子工具", async () => {
    mocks.bridgeGetAcpCapabilities.mockResolvedValue({
      categories: [
        {
          id: "vscode",
          name: "VS Code",
          status: "connected",
          tools: [
            { id: "exec", name: "执行命令" },
            { id: "nav", name: "代码导航" },
          ],
        },
      ],
    })
    mocks.configGet.mockResolvedValue(ok({}))
    mocks.configUpdate.mockResolvedValue(ok({}))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.acp.data.categories[0]?.enabled).toBe(false)
    })

    // 在大类关闭状态下开启 nav
    await act(async () => {
      await view.result.current.toggleAcpTool("vscode", "nav", true)
    })

    const cat = view.result.current.acp.data.categories[0]
    expect(cat.enabled).toBe(true)
    expect(cat.tools.find((t) => t.id === "nav")?.enabled).toBe(true)
    expect(cat.tools.find((t) => t.id === "exec")?.enabled).toBe(false)

    expect(mocks.configUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          acp: expect.objectContaining({
            platform_vscode: expect.objectContaining({
              vscode: expect.objectContaining({
                enabled: true,
                tools: expect.objectContaining({ nav: true, exec: false }),
              }),
            }),
          }),
        }),
      }),
    )
  })

  it("ACP 关闭最后一个开启的子工具时自动联动闭合大类", async () => {
    mocks.bridgeGetAcpCapabilities.mockResolvedValue({
      categories: [
        {
          id: "vscode",
          name: "VS Code",
          status: "connected",
          tools: [
            { id: "exec", name: "执行命令" },
            { id: "nav", name: "代码导航" },
          ],
        },
      ],
    })
    mocks.configGet.mockResolvedValue(
      ok({ acp: { platform_vscode: { vscode: { enabled: true, tools: { exec: true, nav: false } } } } }),
    )
    mocks.configUpdate.mockResolvedValue(ok({}))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.acp.data.categories[0]?.enabled).toBe(true)
    })

    // 关闭仅剩的开启工具 exec
    await act(async () => {
      await view.result.current.toggleAcpTool("vscode", "exec", false)
    })

    const cat = view.result.current.acp.data.categories[0]
    expect(cat.enabled).toBe(false)
    expect(cat.tools.find((t) => t.id === "exec")?.enabled).toBe(false)

    expect(mocks.configUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          acp: expect.objectContaining({
            platform_vscode: expect.objectContaining({
              vscode: expect.objectContaining({
                enabled: false,
                tools: expect.objectContaining({ exec: false }),
              }),
            }),
          }),
        }),
      }),
    )
  })

  it("toggleAllAcpTools 一键全部启用与全部禁用", async () => {
    mocks.bridgeGetAcpCapabilities.mockResolvedValue({
      categories: [
        {
          id: "vscode",
          name: "VS Code",
          status: "connected",
          tools: [
            { id: "exec", name: "执行命令" },
            { id: "nav", name: "代码导航" },
          ],
        },
      ],
    })
    mocks.configGet.mockResolvedValue(ok({}))
    mocks.configUpdate.mockResolvedValue(ok({}))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.acp.data.categories[0]?.enabled).toBe(false)
    })

    // 全部启用
    await act(async () => {
      await view.result.current.toggleAllAcpTools("vscode", true)
    })

    let cat = view.result.current.acp.data.categories[0]
    expect(cat.enabled).toBe(true)
    expect(cat.tools.every((t) => t.enabled === true)).toBe(true)

    // 全部禁用
    await act(async () => {
      await view.result.current.toggleAllAcpTools("vscode", false)
    })

    cat = view.result.current.acp.data.categories[0]
    expect(cat.enabled).toBe(false)
    expect(cat.tools.every((t) => t.enabled === false)).toBe(true)
  })

  it("MCP Server 开启单个子工具时精准派发", async () => {
    mocks.mcpStatus.mockResolvedValue(ok({ testServer: { status: "connected" } }))
    mocks.mcpTools.mockImplementation(() =>
      ok({
        server: "testServer",
        connected: true,
        tools: [
          { id: "t1", name: "Tool 1", enabled: false },
          { id: "t2", name: "Tool 2", enabled: false },
        ],
      }),
    )
    mocks.mcpSetEnabled.mockResolvedValue(ok({}))
    mocks.mcpSetToolEnabled.mockResolvedValue(ok({}))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.mcp.data.testServer?.tools).toHaveLength(2)
    })

    await act(async () => {
      await view.result.current.toggleTool("testServer", "t1", true)
    })

    expect(mocks.mcpSetToolEnabled).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { name: "testServer", toolId: "t1" },
        body: { enabled: true },
      }),
    )
  })

  it("MCP Server 在关闭最后一个子工具时自动联动关闭 Server", async () => {
    mocks.mcpStatus.mockResolvedValue(ok({ testServer: { status: "connected" } }))
    mocks.mcpTools.mockImplementation(() =>
      ok({
        server: "testServer",
        connected: true,
        tools: [
          { id: "t1", name: "Tool 1", enabled: true },
          { id: "t2", name: "Tool 2", enabled: false },
        ],
      }),
    )
    mocks.mcpSetEnabled.mockResolvedValue(ok({}))
    mocks.mcpSetToolEnabled.mockResolvedValue(ok({}))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.mcp.data.testServer?.tools).toHaveLength(2)
    })

    await act(async () => {
      await view.result.current.toggleTool("testServer", "t1", false)
    })

    expect(mocks.mcpSetToolEnabled).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { name: "testServer", toolId: "t1" },
        body: { enabled: false },
      }),
    )
    expect(mocks.mcpSetEnabled).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { name: "testServer" },
        body: { enabled: false },
      }),
    )
  })

  it("toggleAllMcpTools 一键全部启用与全部禁用", async () => {
    mocks.mcpStatus.mockResolvedValue(ok({ testServer: { status: "connected" } }))
    mocks.mcpTools.mockImplementation(() =>
      ok({
        server: "testServer",
        connected: true,
        tools: [
          { id: "t1", name: "Tool 1", enabled: false },
          { id: "t2", name: "Tool 2", enabled: false },
        ],
      }),
    )
    mocks.mcpSetEnabled.mockResolvedValue(ok({}))
    mocks.mcpSetToolEnabled.mockResolvedValue(ok({}))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.mcp.data.testServer?.tools).toHaveLength(2)
    })

    // 全部启用
    await act(async () => {
      await view.result.current.toggleAllMcpTools("testServer", true)
    })

    expect(mocks.mcpSetToolEnabled).toHaveBeenCalledWith({
      path: { name: "testServer", toolId: "t1" },
      body: { enabled: true },
    })
    expect(mocks.mcpSetToolEnabled).toHaveBeenCalledWith({
      path: { name: "testServer", toolId: "t2" },
      body: { enabled: true },
    })

    // 全部禁用
    await act(async () => {
      await view.result.current.toggleAllMcpTools("testServer", false)
    })

    expect(mocks.mcpSetEnabled).toHaveBeenCalledWith({
      path: { name: "testServer" },
      body: { enabled: false },
    })
  })

  it("双端配置命名空间隔离与平滑向下兼容", async () => {
    // 模拟 VS Code 环境
    mocks.bridgeGetAcpCapabilities.mockResolvedValue({
      categories: [
        {
          id: "tasks_and_problems",
          name: "任务与问题",
          status: "connected",
          tools: [{ id: "executeTask", name: "运行任务" }],
        },
      ],
    })
    // 配置中同时包含 vscode 与 intellij 两个平台各自不同的配置
    mocks.configGet.mockResolvedValue(
      ok({
        acp: {
          platform_vscode: {
            tasks_and_problems: { enabled: true, tools: { executeTask: true } },
          },
          platform_intellij: {
            tasks_and_problems: { enabled: false, tools: { executeTask: false } },
          },
        },
      }),
    )

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.acp.data.categories).toHaveLength(1)
    })

    // 在 VS Code 环境下应优先解析 acp.platform_vscode
    const cat = view.result.current.acp.data.categories[0]
    expect(cat.enabled).toBe(true)
    expect(cat.tools[0].enabled).toBe(true)
  })

  it("MCP Server 断开或禁用后保留已拉取的工具清单并支持直接点击开启", async () => {
    // 首次加载 connected 并且拉取到 2 个 tools
    mocks.mcpStatus.mockResolvedValue(ok({ testServer: { status: "connected" } }))
    mocks.mcpTools.mockImplementation(() =>
      ok({
        server: "testServer",
        connected: true,
        tools: [
          { id: "t1", name: "Tool 1", enabled: true },
          { id: "t2", name: "Tool 2", enabled: false },
        ],
      }),
    )
    mocks.mcpSetEnabled.mockResolvedValue(ok({}))
    mocks.mcpSetToolEnabled.mockResolvedValue(ok({}))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.mcp.data.testServer?.tools).toHaveLength(2)
    })

    // 随后 Server 变成 disabled
    mocks.mcpStatus.mockResolvedValue(ok({ testServer: { status: "disabled" } }))
    await act(async () => {
      await view.result.current.refreshMcp()
    })

    // 验证即使 Server disabled，tools 依然保留之前拉取到的清单，且有效状态归零（0/2 启用）！
    expect(view.result.current.mcp.data.testServer?.status).toBe("disabled")
    expect(view.result.current.mcp.data.testServer?.tools).toHaveLength(2)
    expect(view.result.current.mcp.data.testServer?.tools.every((t) => t.enabled === false)).toBe(true)

    // 在 disabled 状态下直接开启 t2，自动级联调用 setEnabled 激活 Server，并将其他工具置为 false
    await act(async () => {
      await view.result.current.toggleTool("testServer", "t2", true)
    })

    expect(mocks.mcpSetEnabled).toHaveBeenCalledWith({
      path: { name: "testServer" },
      body: { enabled: true },
    })
    expect(mocks.mcpSetToolEnabled).toHaveBeenCalledWith({
      path: { name: "testServer", toolId: "t1" },
      body: { enabled: false },
    })
    expect(mocks.mcpSetToolEnabled).toHaveBeenCalledWith({
      path: { name: "testServer", toolId: "t2" },
      body: { enabled: true },
    })
  })

  it("toggleAllMcpTools 遇到部分子请求错误时正确抛错并标记错误", async () => {
    mocks.mcpStatus.mockResolvedValue(ok({ testServer: { status: "connected" } }))
    mocks.mcpTools.mockImplementation(() =>
      ok({
        server: "testServer",
        connected: true,
        tools: [
          { id: "t1", name: "Tool 1", enabled: false },
          { id: "t2", name: "Tool 2", enabled: false },
        ],
      }),
    )
    mocks.mcpSetToolEnabled.mockImplementation((opts: any) => {
      if (opts.path.toolId === "t2") {
        return Promise.resolve(fail("failed to enable tool 2"))
      }
      return Promise.resolve(ok({}))
    })

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.mcp.data.testServer?.tools).toHaveLength(2)
    })

    await act(async () => {
      await view.result.current.toggleAllMcpTools("testServer", true)
    })

    expect(view.result.current.mcp.state).toBe("stale")
  })

  it("MCP Server 级联单开时先收紧工具规则后激活 Server，消除权限暴露窗口", async () => {
    mocks.mcpStatus.mockResolvedValue(ok({ testServer: { status: "connected" } }))
    mocks.mcpTools.mockImplementation(() =>
      ok({
        server: "testServer",
        connected: true,
        tools: [
          { id: "t1", name: "Tool 1", enabled: true },
          { id: "t2", name: "Tool 2", enabled: false },
        ],
      }),
    )
    const callOrder: string[] = []
    mocks.mcpSetToolEnabled.mockImplementation((opts: any) => {
      callOrder.push(`tool:${opts.path.toolId}:${opts.body.enabled}`)
      return Promise.resolve(ok({}))
    })
    mocks.mcpSetEnabled.mockImplementation((opts: any) => {
      callOrder.push(`server:${opts.body.enabled}`)
      return Promise.resolve(ok({}))
    })

    const view = hook(true)
    await waitFor(() => {
      expect(view.result.current.mcp.data.testServer?.tools).toHaveLength(2)
    })

    // 置为 disabled
    mocks.mcpStatus.mockResolvedValue(ok({ testServer: { status: "disabled" } }))
    await act(async () => {
      await view.result.current.refreshMcp()
    })

    callOrder.length = 0
    // 在 disabled 下开启 t2
    await act(async () => {
      await view.result.current.toggleTool("testServer", "t2", true)
    })

    // 验证调用顺序：工具收紧设置必然在 server 启动之前完成，杜绝权限暴露窗口
    const serverEnableIndex = callOrder.indexOf("server:true")
    expect(serverEnableIndex).toBeGreaterThan(-1)
    expect(callOrder.indexOf("tool:t2:true")).toBeLessThan(serverEnableIndex)
    expect(callOrder.indexOf("tool:t1:false")).toBeLessThan(serverEnableIndex)
  })

  it("MCP 工具持久化缓存按项目隔离且支持冷启动直接恢复 0/N 工具", async () => {
    // 模拟持久化存储中已存在 project-A 的缓存
    localStorage.setItem(
      "opencode:mcp_tools_cache:project-A",
      JSON.stringify({
        serverA: [
          { id: "toolA1", name: "Tool A1", enabled: true },
          { id: "toolA2", name: "Tool A2", enabled: false },
        ],
      }),
    )

    // project-B 的缓存包含不同工具
    localStorage.setItem(
      "opencode:mcp_tools_cache:project-B",
      JSON.stringify({
        serverA: [
          { id: "toolB_special", name: "Tool B Special", enabled: true },
        ],
      }),
    )

    // 初始进入 project-A，serverA 为 disabled 状态（从未连接）
    mocks.projectCurrent.mockResolvedValue(ok({ id: "project-A", worktree: "/a" }))
    mocks.mcpStatus.mockResolvedValue(ok({ serverA: { status: "disabled" } }))

    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.mcp.data.serverA?.status).toBe("disabled")
      // 冷启动直接恢复了 2 个工具，并且 enabled 归零（0/2）
      expect(view.result.current.mcp.data.serverA?.tools).toHaveLength(2)
      expect(view.result.current.mcp.data.serverA?.tools[0]?.id).toBe("toolA1")
      expect(view.result.current.mcp.data.serverA?.tools[0]?.enabled).toBe(false)
    })

    // 切换到 project-B
    mocks.projectCurrent.mockResolvedValue(ok({ id: "project-B", worktree: "/b" }))
    await act(async () => {
      await view.result.current.refreshAll()
    })

    await waitFor(() => {
      // 验证 project-B 仅读取其自身的缓存（包含 toolB_special），完全不与 project-A 串号
      expect(view.result.current.mcp.data.serverA?.tools).toHaveLength(1)
      expect(view.result.current.mcp.data.serverA?.tools[0]?.id).toBe("toolB_special")
    })
  })

  it("MCP Server 级联单开遇到 catalog 漂移时自动拉取 live tools 并二次收紧非目标工具", async () => {
    // 缓存中只有 t1
    mocks.mcpStatus.mockResolvedValue(ok({ testServer: { status: "disabled" } }))
    mocks.projectCurrent.mockResolvedValue(ok({ id: "test-proj", worktree: "/p" }))
    localStorage.setItem(
      "opencode:mcp_tools_cache:test-proj",
      JSON.stringify({
        testServer: [{ id: "t1", name: "Tool 1", enabled: false }],
      }),
    )

    mocks.mcpSetEnabled.mockResolvedValue(ok({}))
    mocks.mcpSetToolEnabled.mockResolvedValue(ok({}))

    // Server 启动后返回最新实时 catalog，发现了一个未在缓存中的新工具 t_new，且其默认 enabled 为 true
    mocks.mcpTools.mockImplementation(() =>
      ok({
        server: "testServer",
        connected: true,
        tools: [
          { id: "t1", name: "Tool 1", enabled: true },
          { id: "t_new", name: "New Tool", enabled: true },
        ],
      }),
    )

    const view = hook(true)
    await waitFor(() => {
      expect(view.result.current.mcp.data.testServer?.tools).toHaveLength(1)
    })

    await act(async () => {
      await view.result.current.toggleTool("testServer", "t1", true)
    })

    // 验证新工具 t_new 被自动二次收紧禁用！
    expect(mocks.mcpSetToolEnabled).toHaveBeenCalledWith({
      path: { name: "testServer", toolId: "t_new" },
      body: { enabled: false },
    })
  })

  it("MCP Server 级联单开部分失败时回滚已修改的子工具配置", async () => {
    mocks.mcpStatus.mockResolvedValue(ok({ testServer: { status: "disabled" } }))
    mocks.projectCurrent.mockResolvedValue(ok({ id: "test-proj", worktree: "/p" }))
    localStorage.setItem(
      "opencode:mcp_tools_cache:test-proj",
      JSON.stringify({
        testServer: [
          { id: "t1", name: "Tool 1", enabled: false },
          { id: "t2", name: "Tool 2", enabled: false },
        ],
      }),
    )

    // 假设 t1 成功，但启动 server 报错
    mocks.mcpSetToolEnabled.mockResolvedValue(ok({}))
    mocks.mcpSetEnabled.mockResolvedValue(fail("server startup failed"))

    const view = hook(true)
    await waitFor(() => {
      expect(view.result.current.mcp.data.testServer?.tools).toHaveLength(2)
    })

    await act(async () => {
      await view.result.current.toggleTool("testServer", "t1", true)
    })

    // 验证失败后触发了子工具回滚恢复（t1 被回滚为 false）
    expect(mocks.mcpSetToolEnabled).toHaveBeenCalledWith({
      path: { name: "testServer", toolId: "t1" },
      body: { enabled: false },
    })
    expect(mocks.mcpSetEnabled).toHaveBeenCalledWith({
      path: { name: "testServer" },
      body: { enabled: false },
    })
  })

  it("needs_auth 与 needs_client_registration 状态下阻断子工具与批量操作", async () => {
    mocks.mcpStatus.mockResolvedValue(
      ok({
        authServer: { status: "needs_auth" },
        regServer: { status: "needs_client_registration" },
      }),
    )
    mocks.projectCurrent.mockResolvedValue(ok({ id: "test-auth", worktree: "/auth" }))
    localStorage.setItem(
      "opencode:mcp_tools_cache:test-auth",
      JSON.stringify({
        authServer: [{ id: "tool1", name: "Tool 1", enabled: false }],
        regServer: [{ id: "tool2", name: "Tool 2", enabled: false }],
      }),
    )

    const view = hook(true)
    await waitFor(() => {
      expect(view.result.current.mcp.data.authServer?.status).toBe("needs_auth")
      expect(view.result.current.mcp.data.regServer?.status).toBe("needs_client_registration")
      expect(view.result.current.mcp.data.authServer?.tools).toHaveLength(1)
      expect(view.result.current.mcp.data.regServer?.tools).toHaveLength(1)
    })

    // 尝试在 needs_auth 下切换子工具与批量操作
    const toolRes1 = await act(async () => {
      return await view.result.current.toggleTool("authServer", "tool1", true)
    })
    expect(toolRes1).toBe(false)
    await act(async () => {
      await view.result.current.toggleAllMcpTools("authServer", true)
    })

    // 尝试在 needs_client_registration 下切换子工具与批量操作
    const toolRes2 = await act(async () => {
      return await view.result.current.toggleTool("regServer", "tool2", true)
    })
    expect(toolRes2).toBe(false)
    await act(async () => {
      await view.result.current.toggleAllMcpTools("regServer", true)
    })

    expect(mocks.mcpSetToolEnabled).not.toHaveBeenCalled()
    expect(mocks.mcpSetEnabled).not.toHaveBeenCalled()
  })

  it("catalog 漂移收紧失败时必须回滚 Server 状态并报错", async () => {
    mocks.mcpStatus.mockResolvedValue(ok({ testServer: { status: "disabled" } }))
    mocks.projectCurrent.mockResolvedValue(ok({ id: "test-drift-fail", worktree: "/d" }))
    localStorage.setItem(
      "opencode:mcp_tools_cache:test-drift-fail",
      JSON.stringify({
        testServer: [{ id: "t1", name: "Tool 1", enabled: false }],
      }),
    )

    mocks.mcpSetEnabled.mockResolvedValue(ok({}))
    mocks.mcpSetToolEnabled.mockImplementation((opts: any) => {
      if (opts.path.toolId === "t_new") {
        return Promise.resolve(fail("failed to tighten drift tool"))
      }
      return Promise.resolve(ok({}))
    })

    // Server 启动后返回最新 catalog 包含 t_new
    mocks.mcpTools.mockImplementation(() =>
      ok({
        server: "testServer",
        connected: true,
        tools: [
          { id: "t1", name: "Tool 1", enabled: true },
          { id: "t_new", name: "New Tool", enabled: true },
        ],
      }),
    )

    const view = hook(true)
    await waitFor(() => {
      expect(view.result.current.mcp.data.testServer?.tools).toHaveLength(1)
    })

    await act(async () => {
      await view.result.current.toggleTool("testServer", "t1", true)
    })

    // 验证收紧失败导致触发了 Server 回滚关闭！
    expect(mocks.mcpSetEnabled).toHaveBeenCalledWith({
      path: { name: "testServer" },
      body: { enabled: false },
    })
    expect(view.result.current.mcp.state).toBe("stale")
  })

  it("toggleAllMcpTools 批量启用部分失败时事务回滚 Server 与子工具", async () => {
    mocks.mcpStatus.mockResolvedValue(ok({ testServer: { status: "disabled" } }))
    mocks.projectCurrent.mockResolvedValue(ok({ id: "test-batch-rollback", worktree: "/b" }))
    localStorage.setItem(
      "opencode:mcp_tools_cache:test-batch-rollback",
      JSON.stringify({
        testServer: [
          { id: "t1", name: "Tool 1", enabled: false },
          { id: "t2", name: "Tool 2", enabled: false },
        ],
      }),
    )

    mocks.mcpSetEnabled.mockResolvedValue(ok({}))
    mocks.mcpSetToolEnabled.mockImplementation((opts: any) => {
      if (opts.path.toolId === "t2") {
        return Promise.resolve(fail("failed to enable t2"))
      }
      return Promise.resolve(ok({}))
    })

    const view = hook(true)
    await waitFor(() => {
      expect(view.result.current.mcp.data.testServer?.tools).toHaveLength(2)
    })

    await act(async () => {
      await view.result.current.toggleAllMcpTools("testServer", true)
    })

    // 验证失败后触发了 Server 回滚为 false，且 t1 被回滚为 false
    expect(mocks.mcpSetEnabled).toHaveBeenCalledWith({
      path: { name: "testServer" },
      body: { enabled: false },
    })
    expect(mocks.mcpSetToolEnabled).toHaveBeenCalledWith({
      path: { name: "testServer", toolId: "t1" },
      body: { enabled: false },
    })
  })

  it("VS Code 与 IntelliJ 在同一 hook 生命周期内切换时 ACP 内存状态严格隔离", async () => {
    // 初始处于 VS Code 平台
    mocks.bridgeGetAcpCapabilities.mockResolvedValue({
      categories: [
        {
          id: "common_cat",
          name: "通用分类",
          status: "connected",
          tools: [{ id: "t1", name: "Tool 1" }],
        },
      ],
    })
    mocks.configGet.mockResolvedValue(ok({}))
    mocks.configUpdate.mockResolvedValue(ok({}))

    const view = hook(true)
    await waitFor(() => {
      expect(view.result.current.acp.data.categories[0]?.id).toBe("common_cat")
    })

    // 在 VS Code 平台下开启 t1
    await act(async () => {
      await view.result.current.toggleAcpTool("common_cat", "t1", true)
    })
    expect(view.result.current.acp.data.categories[0]?.tools[0]?.enabled).toBe(true)

    // 切换到 IntelliJ 平台能力返回
    mocks.bridgeGetAcpCapabilities.mockResolvedValue({
      categories: [
        {
          id: "intellij",
          name: "IntelliJ IDEA",
          status: "connected",
          tools: [],
        },
        {
          id: "common_cat",
          name: "通用分类",
          status: "connected",
          tools: [{ id: "t1", name: "Tool 1" }],
        },
      ],
    })

    await act(async () => {
      await view.result.current.refreshAcp()
    })

    await waitFor(() => {
      const ideaCat = view.result.current.acp.data.categories.find((c) => c.id === "common_cat")
      // IntelliJ 平台下 t1 初始未配置且拥有独立平台内存，绝不继承 VS Code 下开启的 true！
      expect(ideaCat?.tools[0]?.enabled).toBe(false)
    })
  })

  it("损坏或残缺的持久化缓存会被安全清洗，杜绝运行时异常", async () => {
    // 模拟恶意或残缺的缓存：缺少 name、数组中包含 null、或者格式非法
    localStorage.setItem(
      "opencode:mcp_tools_cache:corrupt-proj",
      JSON.stringify({
        badServer: [null, { id: "corrupt_tool" }, "invalid_entry"],
      }),
    )
    mocks.projectCurrent.mockResolvedValue(ok({ id: "corrupt-proj", worktree: "/c" }))
    mocks.mcpStatus.mockResolvedValue(ok({ badServer: { status: "disabled" } }))

    const view = hook(true)
    await waitFor(() => {
      // 成功恢复且安全清洗，补全 name 为 id，杜绝后续 toLowerCase 异常
      const tools = view.result.current.mcp.data.badServer?.tools
      expect(tools).toHaveLength(1)
      expect(tools?.[0]?.name).toBe("corrupt_tool")
      expect(tools?.[0]?.enabled).toBe(false)
    })
  })

  it("MCP 级联单开失败时回滚真实持久化配置（保留原本为 true 的工具）", async () => {
    // 持久化中 t1 原本为 true，t2 为 false
    localStorage.setItem(
      "opencode:mcp_tools_cache:test-proj-true",
      JSON.stringify({
        testServer: [
          { id: "t1", name: "Tool 1", enabled: true },
          { id: "t2", name: "Tool 2", enabled: false },
        ],
      }),
    )
    mocks.projectCurrent.mockResolvedValue(ok({ id: "test-proj-true", worktree: "/p" }))
    mocks.mcpStatus.mockResolvedValue(ok({ testServer: { status: "disabled" } }))

    // 禁用状态下，用户点击开启 t2，试图让它 0/2 -> 1/2
    // 在收紧阶段 t1 被临时设为 false，但 server 启动失败
    mocks.mcpSetToolEnabled.mockResolvedValue(ok({}))
    mocks.mcpSetEnabled.mockResolvedValue(fail("server start failed"))

    const view = hook(true)
    await waitFor(() => {
      // 界面投影为 0/2（因为 server disabled）
      expect(view.result.current.mcp.data.testServer?.tools).toHaveLength(2)
      expect(view.result.current.mcp.data.testServer?.tools[0]?.enabled).toBe(false)
    })

    await act(async () => {
      await view.result.current.toggleTool("testServer", "t2", true)
    })

    // 重点验证：回滚时恢复的是持久化记录里的真实状态（t1 回滚为 true，而不是被误当作 UI 投影的 false）！
    expect(mocks.mcpSetToolEnabled).toHaveBeenCalledWith({
      path: { name: "testServer", toolId: "t1" },
      body: { enabled: true },
    })
    expect(mocks.mcpSetToolEnabled).toHaveBeenCalledWith({
      path: { name: "testServer", toolId: "t2" },
      body: { enabled: false },
    })
  })

  it("全新且无持久化缓存的 disabled MCP Server 展现为空列表且安全容错", async () => {
    // 没有缓存，直接返回 disabled
    mocks.projectCurrent.mockResolvedValue(ok({ id: "fresh-empty-proj", worktree: "/fresh" }))
    mocks.mcpStatus.mockResolvedValue(ok({ freshServer: { status: "disabled" } }))

    const view = hook(true)
    await waitFor(() => {
      expect(view.result.current.mcp.data.freshServer?.status).toBe("disabled")
      expect(view.result.current.mcp.data.freshServer?.tools).toEqual([])
    })
  })

  it("关闭最后一个子工具但联动关闭 Server 失败时，子工具回滚恢复为 true", async () => {
    // 只有一个开启的子工具 t1
    mocks.mcpStatus.mockResolvedValue(ok({ testServer: { status: "connected" } }))
    mocks.projectCurrent.mockResolvedValue(ok({ id: "close-fail-proj", worktree: "/c" }))
    mocks.mcpTools.mockImplementation(() =>
      ok({
        server: "testServer",
        connected: true,
        tools: [{ id: "t1", name: "Tool 1", enabled: true }],
      }),
    )

    // 子工具设置成功，但后续联动关闭 Server 失败
    mocks.mcpSetToolEnabled.mockResolvedValue(ok({}))
    mocks.mcpSetEnabled.mockResolvedValue(fail("server close failed"))

    const view = hook(true)
    await waitFor(() => {
      expect(view.result.current.mcp.data.testServer?.tools[0]?.enabled).toBe(true)
    })

    await act(async () => {
      await view.result.current.toggleTool("testServer", "t1", false)
    })

    // 重点断言：联动关闭 Server 失败后，子工具触发了回滚恢复为 true！
    expect(mocks.mcpSetToolEnabled).toHaveBeenCalledWith({
      path: { name: "testServer", toolId: "t1" },
      body: { enabled: true },
    })
    expect(view.result.current.mcp.state).toBe("stale")
  })

  it("并发写入存在慢请求时等待所有请求结算完毕再执行回滚，杜绝迟到覆盖", async () => {
    mocks.mcpStatus.mockResolvedValue(ok({ testServer: { status: "disabled" } }))
    mocks.projectCurrent.mockResolvedValue(ok({ id: "settled-rollback-proj", worktree: "/s" }))
    localStorage.setItem(
      "opencode:mcp_tools_cache:settled-rollback-proj",
      JSON.stringify({
        testServer: [
          { id: "t1", name: "Tool 1", enabled: false },
          { id: "t2", name: "Tool 2", enabled: false },
        ],
      }),
    )

    let t2Finished = false
    mocks.mcpSetToolEnabled.mockImplementation((opts: any) => {
      if (opts.path.toolId === "t1") {
        // t1 失败
        return Promise.resolve(fail("t1 failed"))
      }
      if (opts.path.toolId === "t2") {
        // t2 是慢请求，稍后成功
        return new Promise((resolve) => {
          setTimeout(() => {
            t2Finished = true
            resolve(ok({}))
          }, 10)
        })
      }
      return Promise.resolve(ok({}))
    })

    const view = hook(true)
    await waitFor(() => {
      expect(view.result.current.mcp.data.testServer?.tools).toHaveLength(2)
    })

    await act(async () => {
      await view.result.current.toggleAllMcpTools("testServer", true)
    })

    // 重点断言：必须等待慢请求 t2 也执行结算完成后再统一回滚，t2Finished 必须为 true
    expect(t2Finished).toBe(true)
    expect(view.result.current.mcp.state).toBe("stale")
  })

  it("成功关闭最后一个工具后缓存同步更新为 false，后续级联启动失败回滚保持 false", async () => {
    // 初始状态：server connected，t1 为 true，t2 为 false
    mocks.mcpStatus.mockResolvedValue(ok({ testServer: { status: "connected" } }))
    mocks.projectCurrent.mockResolvedValue(ok({ id: "sync-cache-proj", worktree: "/sc" }))
    mocks.mcpTools.mockImplementation(() =>
      ok({
        server: "testServer",
        connected: true,
        tools: [
          { id: "t1", name: "Tool 1", enabled: true },
          { id: "t2", name: "Tool 2", enabled: false },
        ],
      }),
    )
    mocks.mcpSetToolEnabled.mockResolvedValue(ok({}))
    mocks.mcpSetEnabled.mockResolvedValue(ok({}))

    const view = hook(true)
    await waitFor(() => {
      expect(view.result.current.mcp.data.testServer?.tools[0]?.enabled).toBe(true)
    })

    // 1. 成功关闭 t1（触发联动关闭 Server）
    mocks.mcpStatus.mockResolvedValue(ok({ testServer: { status: "disabled" } }))
    await act(async () => {
      await view.result.current.toggleTool("testServer", "t1", false)
    })

    // 验证当前持久化存储中 t1 已经被同步更新为 false！
    const rawCache = JSON.parse(localStorage.getItem("opencode:mcp_tools_cache:sync-cache-proj") || "{}")
    expect(rawCache.testServer?.find((t: any) => t.id === "t1")?.enabled).toBe(false)

    // 2. 随后在 disabled 状态下尝试开启 t2，但启动 server 失败
    mocks.mcpSetEnabled.mockResolvedValueOnce(fail("startup failed"))
    await act(async () => {
      await view.result.current.toggleTool("testServer", "t2", true)
    })

    // 验证 t1 与 t2 回滚时恢复的是最新的真实值 false，绝不会错误回滚为初始的 true！
    expect(mocks.mcpSetToolEnabled).toHaveBeenCalledWith({
      path: { name: "testServer", toolId: "t2" },
      body: { enabled: false },
    })
    expect(mocks.mcpSetToolEnabled).toHaveBeenCalledWith({
      path: { name: "testServer", toolId: "t1" },
      body: { enabled: false },
    })
  })
})
