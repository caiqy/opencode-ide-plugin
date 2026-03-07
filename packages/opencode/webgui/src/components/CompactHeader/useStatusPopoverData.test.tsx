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
  fetch: vi.fn(),
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
    mocks.fetch.mockReset()
    mocks.bridgeInstalled = true
    mocks.bridgeReady = true
    mocks.bridgeCustomApi = true
    mocks.bridgeRestartMode = "window"

    mocks.mcpStatus.mockResolvedValue(ok({ alpha: { status: "connected" } }))
    mocks.lspStatus.mockResolvedValue(ok([{ id: "ts", name: "TypeScript", root: "D:/repo", status: "connected" }]))
    mocks.configGet.mockResolvedValue(ok({ plugin: ["foo", "bar"] }))
    mocks.projectCurrent.mockResolvedValue(ok({ id: "p1", worktree: "D:/repo", time: { created: 1 } }))
    mocks.pathGet.mockResolvedValue(ok({ state: "ready", config: "cfg", worktree: "D:/repo", directory: "D:/repo" }))
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ healthy: true, version: "1.0.0" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
    vi.stubGlobal("fetch", mocks.fetch)
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
      expect(mocks.fetch).toHaveBeenCalledWith("/global/health")
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
})
