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

function merge(input: Array<string | null>) {
  const list = input.filter((item): item is string => Boolean(item))
  return list.length > 0 ? list.join("; ") : null
}

function server(
  connectionState: ConnectionState,
  project: string | null,
  worktree: string | null,
  directory: string | null,
): ServerData {
  return {
    connectionState,
    project,
    worktree,
    directory,
    bridge: {
      installed: ideBridge.isInstalled(),
      ready: ideBridge.ready,
      customApi: ideBridge.customApi,
      restartMode: ideBridge.restartMode,
    },
  }
}

function failed<T>(prev: Box<T>, fallback: T, err: string | null) {
  if (prev.updatedAt && err) return box(prev.data, "stale", err, prev.updatedAt)
  return box(prev.updatedAt ? prev.data : fallback, prev.updatedAt ? "stale" : "failed", err, prev.updatedAt)
}

export function useStatusPopoverData({ open, connectionState }: Props) {
  const prev = useRef(false)
  const conn = useRef(connectionState)
  const last = useRef(connectionState)
  const seq = useRef(0)
  const mseq = useRef(0)
  const pull = useRef(0)
  const lock = useRef<Record<string, boolean>>({})
  const [data, setData] = useState<Data>({
    servers: box(server(connectionState, null, null, null), "empty", null, null),
    mcp: box({}, "empty", null, null),
    lsp: box([], "empty", null, null),
    plugins: box([], "empty", null, null),
  })
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [refreshing, setRefreshing] = useState(false)

  const refreshMcp = useCallback(async () => {
    pull.current += 1
    setRefreshing(true)
    const id = ++mseq.current
    try {
      const res = await sdk.mcp.status()
      setData((prev) => {
        if (id !== mseq.current) return prev
        if (res.error || !res.data) {
          const err = text(res.error, "Failed to load MCP status")
          return { ...prev, mcp: failed(prev.mcp, {}, err) }
        }
        const next = res.data as Record<string, McpState>
        const state = Object.keys(next).length > 0 ? "ready" : "empty"
        return { ...prev, mcp: box(next, state, null, now()) }
      })
    } catch (err) {
      setData((prev) => {
        if (id !== mseq.current) return prev
        return {
          ...prev,
          mcp: failed(prev.mcp, {}, text(err, "Failed to load MCP status")),
        }
      })
    } finally {
      pull.current = Math.max(0, pull.current - 1)
      if (pull.current === 0) setRefreshing(false)
    }
  }, [])

  const toggleMcp = useCallback(
    async (name: string) => {
      const status = data.mcp.data[name]?.status
      if (status === "needs_auth" || status === "needs_client_registration" || lock.current[name]) return
      lock.current[name] = true
      setBusy({ ...lock.current })
      const query = data.servers.data.directory ? { directory: data.servers.data.directory } : undefined
      try {
        const res =
          status === "connected"
            ? await sdk.mcp.disconnect({ path: { name }, query })
            : await sdk.mcp.connect({ path: { name }, query })
        if (res.error) throw res.error
        await refreshMcp()
      } catch (err) {
        setData((prev) => ({
          ...prev,
          mcp: failed(prev.mcp, prev.mcp.data, text(err, "Failed to toggle MCP")),
        }))
      } finally {
        delete lock.current[name]
        setBusy({ ...lock.current })
      }
    },
    [data.mcp.data, data.servers.data.directory, refreshMcp],
  )

  const refreshAll = useCallback(async () => {
    const id = ++seq.current
    const mid = ++mseq.current
    const state = conn.current
    const [projectRes, pathRes, mcpRes, lspRes, pluginRes] = await Promise.allSettled([
      sdk.project.current(),
      sdk.path.get(),
      sdk.mcp.status(),
      sdk.lsp.status(),
      sdk.config.get(),
    ])

    setData((prev) => {
      if (id !== seq.current) return prev
      const stamp = now()
      const serverErr = merge([
        projectRes.status === "rejected"
          ? text(projectRes.reason, "Failed to load project")
          : projectRes.value.error
            ? text(projectRes.value.error, "Failed to load project")
            : null,
        pathRes.status === "rejected"
          ? text(pathRes.reason, "Failed to load path")
          : pathRes.value.error
            ? text(pathRes.value.error, "Failed to load path")
            : null,
      ])
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
      const nextServer = server(state, project, worktree, directory)
      const servers = serverErr ? failed(prev.servers, nextServer, serverErr) : box(nextServer, "ready", null, stamp)

      const mcp = (() => {
        if (mid !== mseq.current) return prev.mcp
        if (mcpRes.status === "rejected") {
          const err = text(mcpRes.reason, "Failed to load MCP status")
          return failed(prev.mcp, {}, err)
        }
        if (mcpRes.value.error || !mcpRes.value.data) {
          const err = text(mcpRes.value.error, "Failed to load MCP status")
          return failed(prev.mcp, {}, err)
        }
        const next = mcpRes.value.data as Record<string, McpState>
        return box(next, Object.keys(next).length > 0 ? "ready" : "empty", null, stamp)
      })()

      const lsp = (() => {
        if (lspRes.status === "rejected") {
          const err = text(lspRes.reason, "Failed to load LSP status")
          return failed(prev.lsp, [], err)
        }
        if (lspRes.value.error || !lspRes.value.data) {
          const err = text(lspRes.value.error, "Failed to load LSP status")
          return failed(prev.lsp, [], err)
        }
        const next = lspRes.value.data as LspState[]
        return box(next, next.length > 0 ? "ready" : "empty", null, stamp)
      })()

      const plugins = (() => {
        if (pluginRes.status === "rejected") {
          const err = text(pluginRes.reason, "Failed to load plugin config")
          return failed(prev.plugins, [], err)
        }
        if (pluginRes.value.error || !pluginRes.value.data) {
          const err = text(pluginRes.value.error, "Failed to load plugin config")
          return failed(prev.plugins, [], err)
        }
        const next = Array.isArray(pluginRes.value.data.plugin)
          ? pluginRes.value.data.plugin.filter((item): item is string => typeof item === "string")
          : []
        return box(next, next.length > 0 ? "ready" : "empty", null, stamp)
      })()

      return { servers, mcp, lsp, plugins }
    })
  }, [])

  useEffect(() => {
    if (open && !prev.current) void refreshAll()
    prev.current = open
  }, [open, refreshAll])

  useEffect(() => {
    conn.current = connectionState
    if (!open) {
      last.current = connectionState
      return
    }
    if (last.current === connectionState) return
    last.current = connectionState
    void refreshAll()
  }, [connectionState, open, refreshAll])

  return {
    connectionState,
    servers: {
      ...data.servers,
      data: {
        ...data.servers.data,
        connectionState,
      },
    },
    mcp: data.mcp,
    lsp: data.lsp,
    plugins: data.plugins,
    refreshAll,
    refreshMcp,
    toggleMcp,
    mcpBusy: busy,
    mcpRefreshing: refreshing,
  }
}
