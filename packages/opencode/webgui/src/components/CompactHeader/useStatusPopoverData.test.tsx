import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ConnectionState } from "../../lib/api/events"

const mocks = vi.hoisted(() => ({
  mcpStatus: vi.fn(),
  mcpConnect: vi.fn(),
  mcpDisconnect: vi.fn(),
  lspStatus: vi.fn(),
  configGet: vi.fn(),
  projectCurrent: vi.fn(),
  pathGet: vi.fn(),
  bridgeInstalled: true,
  bridgeReady: true,
  bridgeCustomApi: true,
  bridgeRestartMode: "window" as "window" | "ide" | null,
}))

vi.mock("../../lib/api/sdkClient", () => ({
  sdk: {
    mcp: {
      status: (...args: unknown[]) => mocks.mcpStatus(...args),
      connect: (...args: unknown[]) => mocks.mcpConnect(...args),
      disconnect: (...args: unknown[]) => mocks.mcpDisconnect(...args),
    },
    lsp: {
      status: (...args: unknown[]) => mocks.lspStatus(...args),
    },
    config: {
      get: (...args: unknown[]) => mocks.configGet(...args),
    },
    project: {
      current: (...args: unknown[]) => mocks.projectCurrent(...args),
    },
    path: {
      get: (...args: unknown[]) => mocks.pathGet(...args),
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
    mocks.mcpStatus.mockReset()
    mocks.mcpConnect.mockReset()
    mocks.mcpDisconnect.mockReset()
    mocks.lspStatus.mockReset()
    mocks.configGet.mockReset()
    mocks.projectCurrent.mockReset()
    mocks.pathGet.mockReset()
    mocks.bridgeInstalled = true
    mocks.bridgeReady = true
    mocks.bridgeCustomApi = true
    mocks.bridgeRestartMode = "window"

    mocks.mcpStatus.mockResolvedValue(ok({ alpha: { status: "connected" } }))
    mocks.mcpConnect.mockResolvedValue(ok({}))
    mocks.mcpDisconnect.mockResolvedValue(ok({}))
    mocks.lspStatus.mockResolvedValue(ok([{ id: "ts", name: "TypeScript", root: "D:/repo", status: "connected" }]))
    mocks.configGet.mockResolvedValue(ok({ plugin: ["foo", "bar"] }))
    mocks.projectCurrent.mockResolvedValue(ok({ id: "p1", worktree: "D:/repo", time: { created: 1 } }))
    mocks.pathGet.mockResolvedValue(ok({ state: "ready", config: "cfg", worktree: "D:/repo", directory: "D:/repo" }))
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
    expect(view.result.current.servers.data.project).toBe("p1")
    expect(view.result.current.servers.data.directory).toBe("D:/repo")
    expect(view.result.current.servers.data.bridge.ready).toBe(true)
    expect(view.result.current.plugins.state).toBe("ready")
    expect(view.result.current.plugins.data).toEqual(["foo", "bar"])
    expect(view.result.current.lsp.state).toBe("ready")
    expect(view.result.current.mcp.state).toBe("ready")
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

    mocks.mcpStatus.mockResolvedValueOnce(ok({ alpha: { status: "disabled" } }))

    await act(async () => {
      await view.result.current.toggleMcp("alpha")
    })

    expect(mocks.mcpDisconnect).toHaveBeenCalledWith({ path: { name: "alpha" }, query: { directory: "D:/repo" } })
    expect(mocks.mcpStatus).toHaveBeenCalledTimes(2)
    expect(view.result.current.mcp.data.alpha?.status).toBe("disabled")
  })

  it("toggleMcp reject 时保留旧快照并标记 stale", async () => {
    const view = hook(true)

    await waitFor(() => {
      expect(view.result.current.mcp.state).toBe("ready")
    })

    mocks.mcpDisconnect.mockRejectedValueOnce(new Error("toggle boom"))

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

    mocks.mcpDisconnect.mockResolvedValueOnce(fail("toggle error"))

    await act(async () => {
      await view.result.current.toggleMcp("alpha")
    })

    expect(view.result.current.mcp.state).toBe("stale")
    expect(view.result.current.mcp.error).toContain("toggle error")
    expect(mocks.mcpStatus).toHaveBeenCalledTimes(1)
  })

  it("连接状态变化时会重拉并忽略旧请求结果", async () => {
    const project = deferred<ReturnType<typeof ok>>()
    const path = deferred<ReturnType<typeof ok>>()
    const mcp = deferred<ReturnType<typeof ok>>()
    const lsp = deferred<ReturnType<typeof ok>>()
    const cfg = deferred<ReturnType<typeof ok>>()

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
    mocks.configGet.mockImplementationOnce(() => cfg.promise).mockResolvedValueOnce(ok({ plugin: ["bar"] }))

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
    cfg.resolve(ok({ plugin: ["foo"] }))
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

    expect(mocks.mcpDisconnect).toHaveBeenCalledTimes(1)

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
})
