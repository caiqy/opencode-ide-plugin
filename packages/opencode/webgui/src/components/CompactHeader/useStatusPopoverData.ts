import { useCallback, useEffect, useRef, useState } from "react"
import type { ConnectionState } from "../../lib/api/events"
import { sdk } from "../../lib/api/sdkClient"
import { ideBridge } from "../../lib/ideBridge"

type McpState = {
  status: "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration"
  error?: string
}

type LspState = {
  id: string
  name: string
  root: string
  status: "connected" | "error"
}

type ServerData = {
  connectionState: ConnectionState
  project: string | null
  worktree: string | null
  directory: string | null
  health: boolean | null
  bridge: {
    installed: boolean
    ready: boolean
    customApi: boolean
    restartMode: "window" | "ide" | null
  }
}

type State = "ready" | "empty" | "failed" | "stale"

type Box<T> = {
  state: State
  data: T
  error: string | null
  updatedAt: number | null
}

type Data = {
  servers: Box<ServerData>
  mcp: Box<Record<string, McpState>>
  lsp: Box<LspState[]>
  plugins: Box<string[]>
}

type Props = {
  open: boolean
  connectionState: ConnectionState
}

const now = () => Date.now()

function text(err: unknown, fallback: string) {
  if (!err || typeof err !== "object") return fallback
  if ("message" in err && typeof err.message === "string" && err.message) return err.message
  const data = err as { error?: { message?: unknown } }
  if (typeof data.error?.message === "string" && data.error.message) return data.error.message
  return fallback
}

function box<T>(data: T, state: State, error: string | null, updatedAt: number | null): Box<T> {
  return { data, state, error, updatedAt }
}

function server(
  connectionState: ConnectionState,
  health: boolean | null,
  project: string | null,
  worktree: string | null,
  directory: string | null,
): ServerData {
  return {
    connectionState,
    project,
    worktree,
    directory,
    health,
    bridge: {
      installed: ideBridge.isInstalled(),
      ready: ideBridge.ready,
      customApi: ideBridge.customApi,
      restartMode: ideBridge.restartMode,
    },
  }
}

async function healthy(connectionState: ConnectionState) {
  if (connectionState !== "connected") return null
  const res = await fetch("/global/health")
  if (!res.ok) throw new Error("Failed to fetch health")
  const data = (await res.json()) as { healthy?: boolean }
  return data.healthy === true ? true : data.healthy === false ? false : null
}

export function useStatusPopoverData({ open, connectionState }: Props) {
  const prev = useRef(false)
  const [data, setData] = useState<Data>({
    servers: box(server(connectionState, null, null, null, null), "empty", null, null),
    mcp: box({}, "empty", null, null),
    lsp: box([], "empty", null, null),
    plugins: box([], "empty", null, null),
  })

  const refreshMcp = useCallback(async () => {
    const res = await sdk.mcp.status()
    setData((prev) => {
      if (res.error || !res.data) {
        const err = text(res.error, "Failed to load MCP status")
        if (Object.keys(prev.mcp.data).length > 0)
          return { ...prev, mcp: box(prev.mcp.data, "stale", err, prev.mcp.updatedAt) }
        return { ...prev, mcp: box({}, "failed", err, prev.mcp.updatedAt) }
      }
      const next = res.data as Record<string, McpState>
      const state = Object.keys(next).length > 0 ? "ready" : "empty"
      return { ...prev, mcp: box(next, state, null, now()) }
    })
  }, [])

  const toggleMcp = useCallback(
    async (name: string) => {
      const status = data.mcp.data[name]?.status
      const query = data.servers.data.directory ? { directory: data.servers.data.directory } : undefined
      if (status === "connected") await sdk.mcp.disconnect({ path: { name }, query })
      if (status !== "connected") await sdk.mcp.connect({ path: { name }, query })
      await refreshMcp()
    },
    [data.mcp.data, refreshMcp],
  )

  const refreshAll = useCallback(async () => {
    const [projectRes, pathRes, healthRes, mcpRes, lspRes, pluginRes] = await Promise.allSettled([
      sdk.project.current(),
      sdk.path.get(),
      healthy(connectionState),
      sdk.mcp.status(),
      sdk.lsp.status(),
      sdk.config.get(),
    ])

    setData((prev) => {
      const stamp = now()
      const project =
        projectRes.status === "fulfilled" && projectRes.value.data
          ? projectRes.value.data.id
          : prev.servers.data.project
      const worktree =
        pathRes.status === "fulfilled" && pathRes.value.data
          ? pathRes.value.data.worktree
          : projectRes.status === "fulfilled" && projectRes.value.data
            ? projectRes.value.data.worktree
            : prev.servers.data.worktree
      const directory =
        pathRes.status === "fulfilled" && pathRes.value.data
          ? pathRes.value.data.directory
          : prev.servers.data.directory
      const health = healthRes.status === "fulfilled" ? healthRes.value : prev.servers.data.health
      const servers = box(server(connectionState, health, project, worktree, directory), "ready", null, stamp)

      const mcp = (() => {
        if (mcpRes.status === "rejected") {
          const err = text(mcpRes.reason, "Failed to load MCP status")
          if (Object.keys(prev.mcp.data).length > 0) return box(prev.mcp.data, "stale", err, prev.mcp.updatedAt)
          return box({}, "failed", err, prev.mcp.updatedAt)
        }
        if (mcpRes.value.error || !mcpRes.value.data) {
          const err = text(mcpRes.value.error, "Failed to load MCP status")
          if (Object.keys(prev.mcp.data).length > 0) return box(prev.mcp.data, "stale", err, prev.mcp.updatedAt)
          return box({}, "failed", err, prev.mcp.updatedAt)
        }
        const next = mcpRes.value.data as Record<string, McpState>
        return box(next, Object.keys(next).length > 0 ? "ready" : "empty", null, stamp)
      })()

      const lsp = (() => {
        if (lspRes.status === "rejected") {
          const err = text(lspRes.reason, "Failed to load LSP status")
          if (prev.lsp.data.length > 0) return box(prev.lsp.data, "stale", err, prev.lsp.updatedAt)
          return box([], "failed", err, prev.lsp.updatedAt)
        }
        if (lspRes.value.error || !lspRes.value.data) {
          const err = text(lspRes.value.error, "Failed to load LSP status")
          if (prev.lsp.data.length > 0) return box(prev.lsp.data, "stale", err, prev.lsp.updatedAt)
          return box([], "failed", err, prev.lsp.updatedAt)
        }
        const next = lspRes.value.data as LspState[]
        return box(next, next.length > 0 ? "ready" : "empty", null, stamp)
      })()

      const plugins = (() => {
        if (pluginRes.status === "rejected") {
          const err = text(pluginRes.reason, "Failed to load plugin config")
          if (prev.plugins.data.length > 0) return box(prev.plugins.data, "stale", err, prev.plugins.updatedAt)
          return box([], "failed", err, prev.plugins.updatedAt)
        }
        if (pluginRes.value.error || !pluginRes.value.data) {
          const err = text(pluginRes.value.error, "Failed to load plugin config")
          if (prev.plugins.data.length > 0) return box(prev.plugins.data, "stale", err, prev.plugins.updatedAt)
          return box([], "failed", err, prev.plugins.updatedAt)
        }
        const next = Array.isArray(pluginRes.value.data.plugin)
          ? pluginRes.value.data.plugin.filter((item): item is string => typeof item === "string")
          : []
        return box(next, next.length > 0 ? "ready" : "empty", null, stamp)
      })()

      return { servers, mcp, lsp, plugins }
    })
  }, [connectionState])

  useEffect(() => {
    if (open && !prev.current) void refreshAll()
    prev.current = open
  }, [open, refreshAll])

  useEffect(() => {
    setData((prev) => ({
      ...prev,
      servers: {
        ...prev.servers,
        data: {
          ...prev.servers.data,
          connectionState,
        },
      },
    }))
  }, [connectionState])

  return {
    connectionState,
    servers: data.servers,
    mcp: data.mcp,
    lsp: data.lsp,
    plugins: data.plugins,
    refreshAll,
    refreshMcp,
    toggleMcp,
  }
}
