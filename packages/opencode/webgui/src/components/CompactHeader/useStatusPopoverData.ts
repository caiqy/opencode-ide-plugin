import { useCallback, useEffect, useRef, useState } from "react"
import type { ConnectionState } from "../../lib/api/events"
import { sdk } from "../../lib/api/sdkClient"
import { ideBridge } from "../../lib/ideBridge"

type McpState = {
  status: "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration"
  error?: string
  tools: McpTool[]
}

type McpTool = {
  id: string
  name: string
  enabled: boolean
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

type SkillState = {
  enabled: boolean
}

type Data = {
  servers: Box<ServerData>
  mcp: Box<Record<string, McpState>>
  lsp: Box<LspState[]>
  plugins: Box<string[]>
  skills: Box<Record<string, SkillState>>
}

type Props = {
  open: boolean
  connectionState: ConnectionState
}

const now = () => Date.now()

function text(err: unknown, fallback: string) {
  if (typeof err === "string" && err) return err
  if (!err || typeof err !== "object") return fallback
  if ("message" in err && typeof err.message === "string" && err.message) return err.message
  const data = err as { error?: { message?: unknown } }
  if (typeof data.error?.message === "string" && data.error.message) return data.error.message
  return fallback
}

function box<T>(data: T, state: State, error: string | null, updatedAt: number | null): Box<T> {
  return { data, state, error, updatedAt }
}

function tools(input: unknown) {
  if (!input || typeof input !== "object") return []
  const data = (input as { tools?: unknown }).tools
  if (!Array.isArray(data)) return []
  return data
    .filter(
      (item): item is McpTool =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as { id?: unknown }).id === "string" &&
        typeof (item as { name?: unknown }).name === "string" &&
        typeof (item as { enabled?: unknown }).enabled === "boolean",
    )
    .map((item) => ({
      id: item.id,
      name: item.name,
      enabled: item.enabled,
    }))
}

function mcp(input: Record<string, { status: McpState["status"]; error?: string }>) {
  return Object.fromEntries(
    Object.entries(input).map(([name, item]) => [
      name,
      {
        status: item.status,
        error: item.error,
        tools: [],
      },
    ]),
  ) as Record<string, McpState>
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
  const tlock = useRef<Record<string, Record<string, boolean>>>({})
  const [data, setData] = useState<Data>({
    servers: box(server(connectionState, null, null, null), "empty", null, null),
    mcp: box({}, "empty", null, null),
    lsp: box([], "empty", null, null),
    plugins: box([], "empty", null, null),
    skills: box({}, "empty", null, null),
  })
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [tbusy, setTBusy] = useState<Record<string, Record<string, boolean>>>({})
  const [refreshing, setRefreshing] = useState(false)
  const slock = useRef<Record<string, boolean>>({})
  const [sbusy, setSBusy] = useState<Record<string, boolean>>({})
  const sseq = useRef(0)

  const loadMcp = useCallback(async () => {
    try {
      const res = await sdk.mcp.status()
      if (res.error || !res.data) {
        return {
          data: null,
          error: text(res.error, "Failed to load MCP status"),
        }
      }

      const next = mcp(res.data as Record<string, { status: McpState["status"]; error?: string }>)
      const list = Object.entries(next).flatMap(([name, item]) => (item.status === "connected" ? [name] : []))
      if (list.length === 0) return { data: next, error: null }

      const api = sdk.mcp as typeof sdk.mcp & {
        tools: (input: { path: { name: string } }) => Promise<{ data: unknown; error: unknown }>
      }
      const all = await Promise.allSettled(list.map((name) => api.tools({ path: { name } })))
      const bad = all.findIndex((item) => item.status === "rejected" || item.value.error || !item.value.data)
      if (bad > -1) {
        const item = all[bad]
        if (item.status === "rejected") {
          return {
            data: null,
            error: text(item.reason, "Failed to load MCP tools"),
          }
        }
        return {
          data: null,
          error: text(item.value.error, "Failed to load MCP tools"),
        }
      }

      const row = all.map((item, idx) => {
        if (item.status !== "fulfilled" || !item.value.data) return [list[idx], [] as McpTool[]] as const
        return [list[idx], tools(item.value.data)] as const
      })
      const data = row.reduce<Record<string, McpState>>((acc, item) => {
        const name = item[0]
        if (!acc[name]) return acc
        return {
          ...acc,
          [name]: {
            ...acc[name],
            tools: item[1],
          },
        }
      }, next)

      return { data, error: null }
    } catch (err) {
      return {
        data: null,
        error: text(err, "Failed to load MCP status"),
      }
    }
  }, [])

  const loadSkills = useCallback(async () => {
    try {
      const skillsRes = await sdk.app.skills()
      if (skillsRes.error || !skillsRes.data) {
        return { data: null, error: text(skillsRes.error, "Failed to load skills") }
      }
      const result: Record<string, SkillState> = {}
      for (const item of skillsRes.data) {
        result[item.name] = { enabled: item.enabled }
      }
      return { data: result, error: null }
    } catch (err) {
      return { data: null, error: text(err, "Failed to load skills") }
    }
  }, [])

  const refreshMcp = useCallback(async () => {
    pull.current += 1
    setRefreshing(true)
    const id = ++mseq.current
    try {
      const res = await loadMcp()
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
  }, [loadMcp])

  const api = sdk.mcp as typeof sdk.mcp & {
    tools: (input: { path: { name: string } }) => Promise<{ data: unknown; error: unknown }>
    setEnabled: (input: {
      path: { name: string }
      body: { enabled: boolean }
    }) => Promise<{ data: unknown; error: unknown }>
    setToolEnabled: (input: {
      path: { name: string; toolId: string }
      body: { enabled: boolean }
    }) => Promise<{ data: unknown; error: unknown }>
  }

  const toggleTool = useCallback(
    async (name: string, tool: string, enabled: boolean) => {
      if (tlock.current[name]?.[tool]) return false
      tlock.current[name] = {
        ...(tlock.current[name] ?? {}),
        [tool]: true,
      }
      setTBusy({ ...tlock.current })
      try {
        const res = await api.setToolEnabled({
          path: { name, toolId: tool },
          body: { enabled },
        })
        if (res.error) throw res.error
        await refreshMcp()
        return true
      } catch (err) {
        setData((prev) => ({
          ...prev,
          mcp: failed(prev.mcp, prev.mcp.data, text(err, "Failed to toggle MCP tool")),
        }))
        return false
      } finally {
        if (tlock.current[name]) {
          delete tlock.current[name][tool]
          if (Object.keys(tlock.current[name]).length === 0) delete tlock.current[name]
        }
        setTBusy({ ...tlock.current })
      }
    },
    [api, refreshMcp],
  )

  const toggleMcp = useCallback(
    async (name: string) => {
      const status = data.mcp.data[name]?.status
      if (status === "needs_auth" || status === "needs_client_registration" || lock.current[name]) return
      lock.current[name] = true
      setBusy({ ...lock.current })
      try {
        const res = await api.setEnabled({
          path: { name },
          body: { enabled: status !== "connected" },
        })
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
    [api, data.mcp.data, refreshMcp],
  )

  const refreshAll = useCallback(async () => {
    const id = ++seq.current
    const mid = ++mseq.current
    const sid = sseq.current
    const state = conn.current
    const [projectRes, pathRes, mcpRes, lspRes] = await Promise.allSettled([
      sdk.project.current(),
      sdk.path.get(),
      loadMcp(),
      sdk.lsp.status(),
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

      return { servers, mcp, lsp, plugins: prev.plugins, skills: prev.skills }
    })

    const pluginPromise = sdk.config.get().then(
      (v) => ({ status: "fulfilled" as const, value: v }),
      (e) => ({ status: "rejected" as const, reason: e }),
    )
    const skillsPromise = loadSkills().then(
      (v) => ({ status: "fulfilled" as const, value: v }),
      (e) => ({ status: "rejected" as const, reason: e }),
    )
    await Promise.all([
      pluginPromise.then((pluginRes) => {
        setData((prev) => {
          if (id !== seq.current) return prev
          const stamp = now()
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
          return { ...prev, plugins }
        })
      }),
      skillsPromise.then((skillsRes) => {
        setData((prev) => {
          if (id !== seq.current || sid !== sseq.current) return prev
          const stamp = now()
          if (skillsRes.status === "rejected") {
            const err = text(skillsRes.reason, "Failed to load skills")
            return { ...prev, skills: failed(prev.skills, {}, err) }
          }
          if (skillsRes.value.error || !skillsRes.value.data) {
            const err = text(skillsRes.value.error, "Failed to load skills")
            return { ...prev, skills: failed(prev.skills, {}, err) }
          }
          const next = skillsRes.value.data as Record<string, SkillState>
          return { ...prev, skills: box(next, Object.keys(next).length > 0 ? "ready" : "empty", null, stamp) }
        })
      }),
    ])
  }, [loadMcp, loadSkills])

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

  const toggleSkill = useCallback(
    async (name: string) => {
      if (slock.current[name]) return
      slock.current[name] = true
      setSBusy({ ...slock.current })
      try {
        const enabled = data.skills.data[name]?.enabled
        const res = await sdk.app.setSkillEnabled({
          path: { name },
          body: { enabled: !enabled },
        })
        if (res.error) throw res.error
        const id = ++sseq.current
        const fresh = await loadSkills()
        setData((prev) => {
          if (id !== sseq.current) return prev
          if (fresh.error || !fresh.data) {
            return {
              ...prev,
              skills: failed(prev.skills, prev.skills.data, text(fresh.error, "Failed to load skills")),
            }
          }
          const state = Object.keys(fresh.data).length > 0 ? "ready" : "empty"
          return { ...prev, skills: box(fresh.data, state, null, now()) }
        })
      } catch (err) {
        setData((prev) => ({
          ...prev,
          skills: failed(prev.skills, prev.skills.data, text(err, "Failed to toggle skill")),
        }))
      } finally {
        delete slock.current[name]
        setSBusy({ ...slock.current })
      }
    },
    [data.skills.data, loadSkills],
  )

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
    skills: data.skills,
    refreshAll,
    refreshMcp,
    toggleMcp,
    toggleTool,
    toggleSkill,
    mcpBusy: busy,
    mcpToolBusy: tbusy,
    mcpRefreshing: refreshing,
    skillBusy: sbusy,
  }
}
