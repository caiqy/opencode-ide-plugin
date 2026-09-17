import { useCallback, useEffect, useRef, useState } from "react"
import type { ConnectionState } from "../../lib/api/events"
import { sdk } from "../../lib/api/sdkClient"
import { ideBridge } from "../../lib/ideBridge"
import type { AcpCategoryData, AcpData, AcpToolData } from "./status"

type McpState = {
  status: "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration"
  description?: string
  error?: string
  tools: McpTool[]
}

type McpTool = {
  id: string
  name: string
  description?: string
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
  backendUrl: string | null
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
  description?: string
  source?: string
}

type Data = {
  servers: Box<ServerData>
  mcp: Box<Record<string, McpState>>
  acp: Box<AcpData>
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
      description:
        typeof (item as { description?: unknown }).description === "string"
          ? (item as { description: string }).description
          : undefined,
      enabled: item.enabled,
    }))
}

function mcp(input: Record<string, { status: McpState["status"]; description?: string; error?: string }>) {
  return Object.fromEntries(
    Object.entries(input).map(([name, item]) => [
      name,
      {
        status: item.status,
        description: item.description,
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
    backendUrl:
      typeof __OPENCODE_BACKEND_URL__ === "string" && __OPENCODE_BACKEND_URL__.length > 0
        ? __OPENCODE_BACKEND_URL__
        : typeof window === "undefined"
          ? "http://localhost:4096"
          : window.location.origin,
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

export function detectAcpPlatform(categories: Array<{ id: string }>): "platform_vscode" | "platform_intellij" {
  if (categories.some((c) => c.id === "intellij")) return "platform_intellij"
  return "platform_vscode"
}

export const ACP_SPLIT_SEPARATOR = "::"

export function acpBaseCategoryId(catId: string) {
  const index = catId.indexOf(ACP_SPLIT_SEPARATOR)
  return index > 0 ? catId.slice(0, index) : catId
}

export function isAcpSplitCategory(catId: string) {
  return catId.includes(ACP_SPLIT_SEPARATOR)
}

// 扩展工具按来源（fullReferenceName 前缀）拍扁成多个一级大类，配置仍写在原始大类 id 下。
export function splitAcpCategories(categories: AcpCategoryData[]): AcpCategoryData[] {
  return categories.flatMap((cat) => {
    const groups = new Map<string, AcpToolData[]>()
    for (const tool of cat.tools) {
      const label = tool.group || "其他"
      const list = groups.get(label)
      if (list) list.push(tool)
      else groups.set(label, [tool])
    }
    if (groups.size < 2) return [cat]
    return [...groups].map(([label, tools]) => ({
      ...cat,
      id: `${cat.id}${ACP_SPLIT_SEPARATOR}${label}`,
      name: `${cat.name} ${label}`,
      // 分组卡片的开关与普通大类一致：本组只要有工具启用即为开，而不是共享的大类开关
      enabled: tools.some((t) => t.enabled),
      tools,
    }))
  })
}

function getPersistedMcpTools(projectId?: string | null): Record<string, McpTool[]> {
  try {
    if (typeof localStorage === "undefined") return {}
    const key = `opencode:mcp_tools_cache:${projectId || "default"}`
    const raw = localStorage.getItem(key)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const clean: Record<string, McpTool[]> = {}
    for (const [serverName, toolList] of Object.entries(parsed)) {
      if (Array.isArray(toolList)) {
        clean[serverName] = toolList
          .filter((t): t is Record<string, any> => Boolean(t && typeof t.id === "string"))
          .map((t) => ({
            id: t.id,
            name: typeof t.name === "string" ? t.name : t.id,
            enabled: typeof t.enabled === "boolean" ? t.enabled : false,
            description: typeof t.description === "string" ? t.description : undefined,
          }))
      }
    }
    return clean
  } catch {
    return {}
  }
}

function persistMcpTools(cache: Record<string, McpTool[]>, projectId?: string | null) {
  try {
    if (typeof localStorage === "undefined") return
    const key = `opencode:mcp_tools_cache:${projectId || "default"}`
    localStorage.setItem(key, JSON.stringify(cache))
  } catch {
    // ignore
  }
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
    acp: box({ installed: ideBridge.isInstalled(), categories: [] }, "empty", null, null),
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

  const acpLock = useRef<Record<string, boolean>>({})
  const acpToolLock = useRef<Record<string, Record<string, boolean>>>({})
  const [acpBusy, setAcpBusy] = useState<Record<string, boolean>>({})
  const [acpToolBusy, setAcpToolBusy] = useState<Record<string, Record<string, boolean>>>({})
  const acpMemoryRef = useRef<Record<string, Record<string, Record<string, boolean>>>>({})
  const currentProjectRef = useRef<string | null>(null)
  const mcpToolsMemoryRef = useRef<Record<string, McpTool[]>>({})
  const acpSeq = useRef(0)

  // 初始化或项目变更时从对应项目作用域的持久化存储中读取工具列表
  const activeProjectId = data.servers.data.project
  if (activeProjectId !== currentProjectRef.current) {
    currentProjectRef.current = activeProjectId
    mcpToolsMemoryRef.current = getPersistedMcpTools(activeProjectId)
  }

  const loadMcp = useCallback(
    async (projectId?: string | null) => {
      try {
        const projId = projectId ?? currentProjectRef.current ?? data.servers.data.project
        if (projId && projId !== currentProjectRef.current) {
          currentProjectRef.current = projId
          mcpToolsMemoryRef.current = getPersistedMcpTools(projId)
        }
        const res = await sdk.mcp.status()
      if (res.error || !res.data) {
        return {
          data: null,
          error: text(res.error, "Failed to load MCP status"),
        }
      }

      const next = mcp(res.data as Record<string, { status: McpState["status"]; error?: string }>)
      const list = Object.entries(next).flatMap(([name, item]) => (item.status === "connected" ? [name] : []))
      if (list.length === 0) {
        for (const [name, item] of Object.entries(next)) {
          if (mcpToolsMemoryRef.current[name]) {
            item.tools = mcpToolsMemoryRef.current[name].map((t) => ({
              ...t,
              enabled: item.status === "connected" ? t.enabled : false,
            }))
          }
        }
        return { data: next, error: null }
      }

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

      const requestProjId = projId
      const row = all.map((item, idx) => {
        if (item.status !== "fulfilled" || !item.value.data) return [list[idx], [] as McpTool[]] as const
        const parsedTools = tools(item.value.data)
        return [list[idx], parsedTools] as const
      })

      // 若在请求期间项目发生了切换，将结果保存到发起请求的项目存储中，避免污染新项目
      if (currentProjectRef.current !== requestProjId) {
        const cached = getPersistedMcpTools(requestProjId)
        for (const [name, toolList] of row) {
          cached[name] = toolList
        }
        persistMcpTools(cached, requestProjId)
        return { data: null, error: null }
      }

      for (const [name, toolList] of row) {
        mcpToolsMemoryRef.current[name] = toolList
      }
      persistMcpTools(mcpToolsMemoryRef.current, requestProjId)
      const mcpData = row.reduce<Record<string, McpState>>((acc, item) => {
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

      for (const [name, item] of Object.entries(mcpData)) {
        if (item.tools.length === 0 && mcpToolsMemoryRef.current[name]) {
          item.tools = mcpToolsMemoryRef.current[name].map((t) => ({
            ...t,
            enabled: item.status === "connected" ? t.enabled : false,
          }))
        }
      }

      return { data: mcpData, error: null }
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
        const source =
          (item as any).source ??
          (item.location
            ? item.location.startsWith("<built-in>")
              ? "Built-in"
              : item.location.includes(".config")
                ? "Global"
                : "Project"
            : undefined)
        result[item.name] = {
          enabled: item.enabled,
          description: item.description,
          source,
        }
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
      const res = await loadMcp(currentProjectRef.current || data.servers.data.project)
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

  const loadAcp = useCallback(async (cfgData?: any) => {
    if (!ideBridge.isInstalled()) {
      return {
        data: { installed: false, categories: [] as AcpCategoryData[] },
        error: null,
      }
    }

    try {
      const capabilities = await ideBridge.getAcpCapabilities()
      if (!capabilities || !Array.isArray(capabilities.categories)) {
        return {
          data: { installed: true, categories: [] as AcpCategoryData[] },
          error: null,
        }
      }

      let configAcp = cfgData !== undefined ? (cfgData as any)?.acp : undefined
      if (cfgData === undefined) {
        try {
          const cfgRes = await sdk.config.get()
          configAcp = (cfgRes.data as any)?.acp
        } catch {
          // ignore
        }
      }

      const platform = detectAcpPlatform(capabilities.categories)
      const platformCfg = configAcp?.[platform]
      const scopeKey = `${platform}:${currentProjectRef.current || data.servers.data.project || "default"}`
      if (!acpMemoryRef.current[scopeKey]) {
        acpMemoryRef.current[scopeKey] = {}
      }
      const scopeMemory = acpMemoryRef.current[scopeKey]

      const categories: AcpCategoryData[] = capabilities.categories.map((cat) => {
        // 优先读取当前平台命名空间下的配置，没有则回退兼容旧版扁平配置
        const catCfg = platformCfg?.[cat.id] ?? configAcp?.[cat.id]
        // 默认禁用所有 ACP（未配置时默认 false）
        const enabled = catCfg?.enabled !== undefined ? Boolean(catCfg.enabled) : false

        if (!scopeMemory[cat.id]) {
          scopeMemory[cat.id] = {}
        }

        const tools: AcpToolData[] = (cat.tools || []).map((t) => {
          const toolCfg = catCfg?.tools?.[t.id]
          const remembered = scopeMemory[cat.id]?.[t.id]
          // 默认禁用所有子工具（未配置时默认 false）
          const defaultEnabled = toolCfg !== undefined ? Boolean(toolCfg) : remembered !== undefined ? remembered : false
          scopeMemory[cat.id][t.id] = defaultEnabled

          return {
            id: t.id,
            name: t.name,
            description: t.description,
            group: t.group,
            enabled: enabled ? defaultEnabled : false,
          }
        })

        return {
          id: cat.id,
          name: cat.name,
          description: cat.description,
          status: (cat.status as any) || "connected",
          enabled,
          tools,
        }
      })

      return {
        data: { installed: true, categories: splitAcpCategories(categories) },
        error: null,
      }
    } catch (err) {
      return {
        data: null,
        error: text(err, "Failed to load ACP capabilities"),
      }
    }
  }, [])

  const refreshAcp = useCallback(async () => {
    const id = ++acpSeq.current
    try {
      const res = await loadAcp()
      setData((prev) => {
        if (id !== acpSeq.current) return prev
        if (res.error || !res.data) {
          const err = text(res.error, "Failed to load ACP capabilities")
          return { ...prev, acp: failed(prev.acp, { installed: ideBridge.isInstalled(), categories: [] }, err) }
        }
        const state = !res.data.installed || res.data.categories.length > 0 ? "ready" : "empty"
        return { ...prev, acp: box(res.data, state, null, now()) }
      })
    } catch (err) {
      setData((prev) => {
        if (id !== acpSeq.current) return prev
        return {
          ...prev,
          acp: failed(
            prev.acp,
            { installed: ideBridge.isInstalled(), categories: [] },
            text(err, "Failed to load ACP capabilities"),
          ),
        }
      })
    }
  }, [loadAcp])

  const toggleAcpGroup = useCallback(
    async (catId: string, enabled: boolean) => {
      const currentCat = data.acp.data.categories.find((c) => c.id === catId)
      if (!currentCat || acpLock.current[catId]) return

      const baseId = acpBaseCategoryId(catId)
      const platform = detectAcpPlatform(data.acp.data.categories)
      const nextToolsRecord: Record<string, boolean> = {}
      for (const t of currentCat.tools) {
        nextToolsRecord[t.id] = enabled
      }

      acpLock.current[catId] = true
      setAcpBusy((prev) => ({ ...prev, [catId]: true }))

      // Optimistic update
      setData((prev) => {
        const nextCategories = prev.acp.data.categories.map((c) => {
          if (c.id !== catId) return c
          const tools = c.tools.map((t) => ({ ...t, enabled }))
          return { ...c, enabled: tools.some((t) => t.enabled), tools }
        })
        return {
          ...prev,
          acp: box({ ...prev.acp.data, categories: nextCategories }, "ready", null, now()),
        }
      })

      try {
        // 分组开关只写本组子工具；仅在启用时确保大类打开，停用不写 enabled，避免连带其他分组
        const payload = {
          acp: {
            [platform]: {
              [baseId]: {
                ...(enabled ? { enabled: true } : {}),
                tools: nextToolsRecord,
              },
            },
          },
        }
        const res = await sdk.config.update({
          config: payload,
          body: payload,
        } as any)
        if (res.error) throw res.error
      } catch (err) {
        console.warn("[useStatusPopoverData] Failed to toggle ACP group:", err)
        await refreshAcp()
      } finally {
        delete acpLock.current[catId]
        setAcpBusy((prev) => {
          const next = { ...prev }
          delete next[catId]
          return next
        })
      }
    },
    [data.acp.data.categories, refreshAcp],
  )

  const toggleAcpCategory = useCallback(
    async (catId: string) => {
      const currentCat = data.acp.data.categories.find((c) => c.id === catId)
      if (!currentCat || acpLock.current[catId]) return
      // 拆分出来的扩展工具分组：按分组开关处理，不触碰共享的大类开关
      if (isAcpSplitCategory(catId)) return toggleAcpGroup(catId, !currentCat.enabled)

      const baseId = acpBaseCategoryId(catId)
      const platform = detectAcpPlatform(data.acp.data.categories)
      const scopeKey = `${platform}:${currentProjectRef.current || data.servers.data.project || "default"}`
      if (!acpMemoryRef.current[scopeKey]) {
        acpMemoryRef.current[scopeKey] = {}
      }
      const scopeMemory = acpMemoryRef.current[scopeKey]

      const backupMemory = { ...(scopeMemory[baseId] || {}) }
      const nextEnabled = !currentCat.enabled
      acpLock.current[catId] = true
      setAcpBusy((prev) => ({ ...prev, [catId]: true }))

      // Optimistic update
      setData((prev) => {
        const nextCategories = prev.acp.data.categories.map((c) => {
          if (acpBaseCategoryId(c.id) !== baseId) return c
          const tools = c.tools.map((t) => {
            const remembered = scopeMemory[baseId]?.[t.id] ?? false
            return {
              ...t,
              enabled: nextEnabled ? remembered : false,
            }
          })
          return {
            ...c,
            enabled: nextEnabled,
            tools,
          }
        })
        return {
          ...prev,
          acp: box({ ...prev.acp.data, categories: nextCategories }, "ready", null, now()),
        }
      })

      try {
        const rememberedTools = scopeMemory[baseId] || {}
        const payload = {
          acp: {
            [platform]: {
              [baseId]: {
                enabled: nextEnabled,
                tools: rememberedTools,
              },
            },
          },
        }
        const res = await sdk.config.update({
          config: payload,
          body: payload,
        } as any)
        if (res.error) throw res.error
      } catch (err) {
        scopeMemory[baseId] = backupMemory
        console.warn("[useStatusPopoverData] Failed to toggle ACP category:", err)
        await refreshAcp()
      } finally {
        delete acpLock.current[catId]
        setAcpBusy((prev) => {
          const next = { ...prev }
          delete next[catId]
          return next
        })
      }
    },
    [data.acp.data.categories, refreshAcp, toggleAcpGroup],
  )

  const toggleAcpTool = useCallback(
    async (catId: string, toolId: string, enabled: boolean) => {
      if (acpLock.current[catId]) return

      const currentCat = data.acp.data.categories.find((c) => c.id === catId)
      if (!currentCat) return

      const baseId = acpBaseCategoryId(catId)
      const platform = detectAcpPlatform(data.acp.data.categories)

      if (isAcpSplitCategory(catId)) {
        if (acpToolLock.current[catId]?.[toolId]) return

        acpLock.current[catId] = true
        if (!acpToolLock.current[catId]) acpToolLock.current[catId] = {}
        acpToolLock.current[catId][toolId] = true
        setAcpToolBusy((prev) => ({
          ...prev,
          [catId]: { ...(prev[catId] ?? {}), [toolId]: true },
        }))

        // Optimistic update
        setData((prev) => {
          const nextCategories = prev.acp.data.categories.map((c) => {
            if (c.id !== catId) return c
            const tools = c.tools.map((t) => (t.id === toolId ? { ...t, enabled } : t))
            return { ...c, enabled: tools.some((t) => t.enabled), tools }
          })
          return {
            ...prev,
            acp: box({ ...prev.acp.data, categories: nextCategories }, "ready", null, now()),
          }
        })

        try {
          const payload = {
            acp: {
              [platform]: {
                [baseId]: {
                  ...(enabled ? { enabled: true } : {}),
                  tools: { [toolId]: enabled },
                },
              },
            },
          }
          const res = await sdk.config.update({
            config: payload,
            body: payload,
          } as any)
          if (res.error) throw res.error
        } catch (err) {
          console.warn("[useStatusPopoverData] Failed to toggle ACP tool:", err)
          await refreshAcp()
        } finally {
          delete acpLock.current[catId]
          setAcpBusy((prev) => {
            const next = { ...prev }
            delete next[catId]
            return next
          })
          if (acpToolLock.current[catId]) {
            delete acpToolLock.current[catId][toolId]
            if (Object.keys(acpToolLock.current[catId]).length === 0) delete acpToolLock.current[catId]
          }
          setAcpToolBusy((prev) => {
            const next = { ...prev }
            if (next[catId]) {
              const catBusy = { ...next[catId] }
              delete catBusy[toolId]
              next[catId] = catBusy
            }
            return next
          })
        }
        return
      }

      const scopeKey = `${platform}:${currentProjectRef.current || data.servers.data.project || "default"}`
      if (!acpMemoryRef.current[scopeKey]) {
        acpMemoryRef.current[scopeKey] = {}
      }
      const scopeMemory = acpMemoryRef.current[scopeKey]

      const backupMemory = { ...(scopeMemory[baseId] || {}) }
      let nextCatEnabled = currentCat.enabled
      const nextToolsRecord: Record<string, boolean> = { ...backupMemory }

      if (enabled) {
        if (!currentCat.enabled) {
          nextCatEnabled = true
          for (const t of currentCat.tools) {
            nextToolsRecord[t.id] = t.id === toolId
          }
        } else {
          nextToolsRecord[toolId] = true
        }
      } else {
        nextToolsRecord[toolId] = false
        const anyActive = currentCat.tools.some((t) => (t.id === toolId ? false : Boolean(nextToolsRecord[t.id])))
        if (!anyActive) {
          nextCatEnabled = false
        }
      }

      acpLock.current[catId] = true
      if (!acpToolLock.current[catId]) acpToolLock.current[catId] = {}
      acpToolLock.current[catId][toolId] = true
      setAcpToolBusy((prev) => ({
        ...prev,
        [catId]: { ...(prev[catId] ?? {}), [toolId]: true },
      }))

      scopeMemory[baseId] = nextToolsRecord

      // Optimistic update
      setData((prev) => {
        const nextCategories = prev.acp.data.categories.map((c) => {
          if (c.id !== catId) return c
          const tools = c.tools.map((t) => ({
            ...t,
            enabled: nextCatEnabled ? Boolean(nextToolsRecord[t.id]) : false,
          }))
          return {
            ...c,
            enabled: nextCatEnabled,
            tools,
          }
        })
        return {
          ...prev,
          acp: box({ ...prev.acp.data, categories: nextCategories }, "ready", null, now()),
        }
      })

      try {
        const payload = {
          acp: {
            [platform]: {
              [baseId]: {
                enabled: nextCatEnabled,
                tools: nextToolsRecord,
              },
            },
          },
        }
        const res = await sdk.config.update({
          config: payload,
          body: payload,
        } as any)
        if (res.error) throw res.error
      } catch (err) {
        scopeMemory[baseId] = backupMemory
        console.warn("[useStatusPopoverData] Failed to toggle ACP tool:", err)
        await refreshAcp()
      } finally {
        delete acpLock.current[catId]
        setAcpBusy((prev) => {
          const next = { ...prev }
          delete next[catId]
          return next
        })
        if (acpToolLock.current[catId]) {
          delete acpToolLock.current[catId][toolId]
          if (Object.keys(acpToolLock.current[catId]).length === 0) delete acpToolLock.current[catId]
        }
        setAcpToolBusy((prev) => {
          const next = { ...prev }
          if (next[catId]) {
            const catBusy = { ...next[catId] }
            delete catBusy[toolId]
            next[catId] = catBusy
          }
          return next
        })
      }
    },
    [data.acp.data.categories, refreshAcp],
  )

  const toggleAllAcpTools = useCallback(
    async (catId: string, enabled: boolean) => {
      const currentCat = data.acp.data.categories.find((c) => c.id === catId)
      if (
        !currentCat ||
        acpLock.current[catId] ||
        (acpToolLock.current[catId] && Object.keys(acpToolLock.current[catId]).length > 0)
      )
        return
      // 拆分出来的扩展工具分组：批量开关只作用于本组
      if (isAcpSplitCategory(catId)) return toggleAcpGroup(catId, enabled)

      const baseId = acpBaseCategoryId(catId)
      const platform = detectAcpPlatform(data.acp.data.categories)
      const scopeKey = `${platform}:${currentProjectRef.current || data.servers.data.project || "default"}`
      if (!acpMemoryRef.current[scopeKey]) {
        acpMemoryRef.current[scopeKey] = {}
      }
      const scopeMemory = acpMemoryRef.current[scopeKey]

      const backupMemory = { ...(scopeMemory[baseId] || {}) }
      acpLock.current[catId] = true
      setAcpBusy((prev) => ({ ...prev, [catId]: true }))

      const nextToolsRecord: Record<string, boolean> = {}
      for (const t of currentCat.tools) {
        nextToolsRecord[t.id] = enabled
      }
      scopeMemory[baseId] = nextToolsRecord

      // Optimistic update
      setData((prev) => {
        const nextCategories = prev.acp.data.categories.map((c) => {
          if (c.id !== catId) return c
          const tools = c.tools.map((t) => ({ ...t, enabled }))
          return {
            ...c,
            enabled,
            tools,
          }
        })
        return {
          ...prev,
          acp: box({ ...prev.acp.data, categories: nextCategories }, "ready", null, now()),
        }
      })

      try {
        const payload = {
          acp: {
            [platform]: {
              [baseId]: {
                enabled,
                tools: nextToolsRecord,
              },
            },
          },
        }
        const res = await sdk.config.update({
          config: payload,
          body: payload,
        } as any)
        if (res.error) throw res.error
      } catch (err) {
        scopeMemory[baseId] = backupMemory
        console.warn("[useStatusPopoverData] Failed to toggle all ACP tools:", err)
        await refreshAcp()
      } finally {
        delete acpLock.current[catId]
        setAcpBusy((prev) => {
          const next = { ...prev }
          delete next[catId]
          return next
        })
      }
    },
    [data.acp.data.categories, refreshAcp, toggleAcpGroup],
  )

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
      if (lock.current[name] || tlock.current[name]?.[tool]) return false
      const currentMcp = data.mcp.data[name]
      if (!currentMcp || currentMcp.status === "needs_auth" || currentMcp.status === "needs_client_registration") return false

      lock.current[name] = true
      tlock.current[name] = {
        ...(tlock.current[name] ?? {}),
        [tool]: true,
      }
      setBusy({ ...lock.current })
      setTBusy({ ...tlock.current })
      const modifiedTools: Array<{ id: string; prevEnabled: boolean }> = []
      const getActualPrev = (tId: string, fallback: boolean) => {
        const raw = mcpToolsMemoryRef.current[name]?.find((t) => t.id === tId)
        return raw ? Boolean(raw.enabled) : fallback
      }
      try {
        if (enabled && currentMcp.status !== "connected") {
          // 安全优先：先收紧工具配置，消除权限暴露窗口
          // 1. 先将当前被点击的目标工具设为 enabled: true
          const enableTargetRes = await api.setToolEnabled({
            path: { name, toolId: tool },
            body: { enabled: true },
          })
          if (enableTargetRes.error) throw enableTargetRes.error
          modifiedTools.push({ id: tool, prevEnabled: getActualPrev(tool, false) })

          // 2. 将其余所有已知工具显式设为 enabled: false，确保 0/N -> 1/N
          const disableSettled = await Promise.allSettled(
            currentMcp.tools
              .filter((t) => t.id !== tool)
              .map(async (t) => {
                const res = await api.setToolEnabled({
                  path: { name, toolId: t.id },
                  body: { enabled: false },
                })
                if (!res.error) {
                  modifiedTools.push({ id: t.id, prevEnabled: getActualPrev(t.id, t.enabled) })
                }
                return res
              }),
          )
          for (const r of disableSettled) {
            if (r.status === "rejected") throw r.reason
            if (r.value?.error) throw r.value.error
          }

          // 3. 所有子工具权限收紧锁定后，最后才级联激活 Server
          const setRes = await api.setEnabled({
            path: { name },
            body: { enabled: true },
          })
          if (setRes.error) throw setRes.error

          // 4. Server 启动后立即拉取实时最新工具目录，防范 Server 新增工具（catalog 漂移）导致非目标工具默认开启
          const liveToolsRes = await api.tools({ path: { name } })
          if (liveToolsRes.error) throw liveToolsRes.error
          if (liveToolsRes.data) {
            const liveParsed = tools(liveToolsRes.data)
            const driftDisables = liveParsed
              .filter((t) => t.id !== tool && t.enabled)
              .map(async (t) => {
                const res = await api.setToolEnabled({
                  path: { name, toolId: t.id },
                  body: { enabled: false },
                })
                if (!res.error) {
                  modifiedTools.push({ id: t.id, prevEnabled: true })
                }
                return res
              })
            const driftSettled = await Promise.allSettled(driftDisables)
            for (const r of driftSettled) {
              if (r.status === "rejected") throw r.reason
              if (r.value?.error) throw r.value.error
            }
          }
        } else {
          const prevToolEnabled = getActualPrev(tool, !enabled)
          const res = await api.setToolEnabled({
            path: { name, toolId: tool },
            body: { enabled },
          })
          if (res.error) throw res.error
          modifiedTools.push({ id: tool, prevEnabled: prevToolEnabled })

          // 如果用户关闭子工具，检查关闭后是否还有其他已开启的子工具
          if (!enabled) {
            const remainingActive = currentMcp.tools.some((t) => (t.id === tool ? false : t.enabled))
            if (!remainingActive && currentMcp.status === "connected") {
              // 若全部关闭，自动联动闭合该 MCP Server
              const closeRes = await api.setEnabled({
                path: { name },
                body: { enabled: false },
              })
              if (closeRes.error) throw closeRes.error
            }
          }
        }

        if (mcpToolsMemoryRef.current[name]) {
          mcpToolsMemoryRef.current[name] = mcpToolsMemoryRef.current[name].map((t) =>
            t.id === tool ? { ...t, enabled } : t,
          )
          persistMcpTools(mcpToolsMemoryRef.current, currentProjectRef.current)
        }

        await refreshMcp()
        return true
      } catch (err) {
        if (enabled && currentMcp.status !== "connected") {
          try {
            const rollback = await api.setEnabled({ path: { name }, body: { enabled: false } })
            if (rollback.error) {
              console.error("[useStatusPopoverData] Failed to rollback MCP server enable state:", rollback.error)
            }
          } catch (rollbackErr) {
            console.error("[useStatusPopoverData] Exception during MCP rollback:", rollbackErr)
          }
        }

        // 回滚已修改的子工具配置，确保配置事务一致性（开启与关闭路径均完整适用）
        if (modifiedTools.length > 0) {
          const rollbackResults = await Promise.allSettled(
            modifiedTools.map((t) =>
              api.setToolEnabled({
                path: { name, toolId: t.id },
                body: { enabled: t.prevEnabled },
              }),
            ),
          )
          for (const r of rollbackResults) {
            if (r.status === "rejected") {
              console.error("[useStatusPopoverData] MCP tool rollback rejected:", r.reason)
            } else if (r.value?.error) {
              console.error("[useStatusPopoverData] MCP tool rollback returned error:", r.value.error)
            }
          }
        }
        await refreshMcp().catch(() => {})
        setData((prev) => ({
          ...prev,
          mcp: failed(prev.mcp, prev.mcp.data, text(err, "Failed to toggle MCP tool")),
        }))
        return false
      } finally {
        delete lock.current[name]
        setBusy({ ...lock.current })
        if (tlock.current[name]) {
          delete tlock.current[name][tool]
          if (Object.keys(tlock.current[name]).length === 0) delete tlock.current[name]
        }
        setTBusy({ ...tlock.current })
      }
    },
    [api, data.mcp.data, refreshMcp],
  )

  const toggleAllMcpTools = useCallback(
    async (name: string, enabled: boolean) => {
      const currentMcp = data.mcp.data[name]
      if (
        !currentMcp ||
        currentMcp.status === "needs_auth" ||
        currentMcp.status === "needs_client_registration" ||
        lock.current[name] ||
        (tlock.current[name] && Object.keys(tlock.current[name]).length > 0)
      )
        return

      lock.current[name] = true
      setBusy({ ...lock.current })

      const modifiedTools: Array<{ id: string; prevEnabled: boolean }> = []
      let serverWasStarted = false
      const getActualPrev = (tId: string, fallback: boolean) => {
        const raw = mcpToolsMemoryRef.current[name]?.find((t) => t.id === tId)
        return raw ? Boolean(raw.enabled) : fallback
      }
      try {
        if (enabled) {
          if (currentMcp.status !== "connected") {
            const setRes = await api.setEnabled({
              path: { name },
              body: { enabled: true },
            })
            if (setRes.error) throw setRes.error
            serverWasStarted = true
          }
          const results = await Promise.allSettled(
            currentMcp.tools.map(async (t) => {
              const res = await api.setToolEnabled({
                path: { name, toolId: t.id },
                body: { enabled: true },
              })
              if (!res.error) {
                modifiedTools.push({ id: t.id, prevEnabled: getActualPrev(t.id, t.enabled) })
              }
              return res
            }),
          )
          for (const r of results) {
            if (r.status === "rejected") throw r.reason
            if (r.value?.error) throw r.value.error
          }
        } else {
          const results = await Promise.allSettled(
            currentMcp.tools.map(async (t) => {
              const res = await api.setToolEnabled({
                path: { name, toolId: t.id },
                body: { enabled: false },
              })
              if (!res.error) {
                modifiedTools.push({ id: t.id, prevEnabled: getActualPrev(t.id, t.enabled) })
              }
              return res
            }),
          )
          for (const r of results) {
            if (r.status === "rejected") throw r.reason
            if (r.value?.error) throw r.value.error
          }
          const closeRes = await api.setEnabled({
            path: { name },
            body: { enabled: false },
          })
          if (closeRes.error) throw closeRes.error
        }
        if (mcpToolsMemoryRef.current[name]) {
          mcpToolsMemoryRef.current[name] = mcpToolsMemoryRef.current[name].map((t) => ({
            ...t,
            enabled,
          }))
          persistMcpTools(mcpToolsMemoryRef.current, currentProjectRef.current)
        }
        await refreshMcp()
      } catch (err) {
        console.warn("[useStatusPopoverData] Failed to toggle all MCP tools:", err)
        if (serverWasStarted) {
          try {
            const rollback = await api.setEnabled({ path: { name }, body: { enabled: false } })
            if (rollback.error) {
              console.error("[useStatusPopoverData] Failed to rollback MCP server in batch:", rollback.error)
            }
          } catch (rollbackErr) {
            console.error("[useStatusPopoverData] Exception during MCP server batch rollback:", rollbackErr)
          }
        }
        if (modifiedTools.length > 0) {
          const rollbackResults = await Promise.allSettled(
            modifiedTools.map((t) =>
              api.setToolEnabled({
                path: { name, toolId: t.id },
                body: { enabled: t.prevEnabled },
              }),
            ),
          )
          for (const r of rollbackResults) {
            if (r.status === "rejected") {
              console.error("[useStatusPopoverData] Batch MCP tool rollback rejected:", r.reason)
            } else if (r.value?.error) {
              console.error("[useStatusPopoverData] Batch MCP tool rollback returned error:", r.value.error)
            }
          }
        }
        await refreshMcp().catch(() => {})
        setData((prev) => ({
          ...prev,
          mcp: failed(prev.mcp, prev.mcp.data, text(err, "Failed to toggle all MCP tools")),
        }))
      } finally {
        delete lock.current[name]
        setBusy({ ...lock.current })
      }
    },
    [api, data.mcp.data, refreshMcp],
  )

  const toggleMcp = useCallback(
    async (name: string) => {
      const status = data.mcp.data[name]?.status
      if (
        status === "needs_auth" ||
        status === "needs_client_registration" ||
        lock.current[name] ||
        (tlock.current[name] && Object.keys(tlock.current[name]).length > 0)
      )
        return
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

    const [projectResSettled, pathRes, lspRes] = await Promise.allSettled([
      sdk.project.current(),
      sdk.path.get(),
      sdk.lsp.status(),
    ])
    const projectRes = projectResSettled
    const projId =
      projectRes.status === "fulfilled" && projectRes.value.data
        ? projectRes.value.data.id
        : data.servers.data.project
    if (projId && projId !== currentProjectRef.current) {
      currentProjectRef.current = projId
      mcpToolsMemoryRef.current = getPersistedMcpTools(projId)
    }

    const mcpRes = await (async () => {
      try {
        const res = await loadMcp(projId)
        return { status: "fulfilled" as const, value: res }
      } catch (err) {
        return { status: "rejected" as const, reason: err }
      }
    })()
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

      return { servers, mcp, lsp, plugins: prev.plugins, skills: prev.skills, acp: prev.acp }
    })

    const configPromise = sdk.config.get().then(
      (v) => ({ status: "fulfilled" as const, value: v }),
      (e) => ({ status: "rejected" as const, reason: e }),
    )
    const skillsPromise = loadSkills().then(
      (v) => ({ status: "fulfilled" as const, value: v }),
      (e) => ({ status: "rejected" as const, reason: e }),
    )
    await Promise.all([
      configPromise.then(async (configRes) => {
        const configData = configRes.status === "fulfilled" && configRes.value.data ? configRes.value.data : null
        const acpRes = await loadAcp(configData)
        setData((prev) => {
          if (id !== seq.current) return prev
          const stamp = now()
          const plugins = (() => {
            if (configRes.status === "rejected") {
              const err = text(configRes.reason, "Failed to load plugin config")
              return failed(prev.plugins, [], err)
            }
            if (configRes.value.error || !configRes.value.data) {
              const err = text(configRes.value.error, "Failed to load plugin config")
              return failed(prev.plugins, [], err)
            }
            const next = Array.isArray(configRes.value.data.plugin)
              ? configRes.value.data.plugin.filter((item): item is string => typeof item === "string")
              : []
            return box(next, next.length > 0 ? "ready" : "empty", null, stamp)
          })()

          const acp = (() => {
            if (acpRes.error || !acpRes.data) {
              const err = text(acpRes.error, "Failed to load ACP capabilities")
              return failed(prev.acp, { installed: ideBridge.isInstalled(), categories: [] }, err)
            }
            const state = !acpRes.data.installed || acpRes.data.categories.length > 0 ? "ready" : "empty"
            return box(acpRes.data, state, null, stamp)
          })()

          const mcpConfig = (configData as any)?.mcp || {}
          const nextMcpData = Object.fromEntries(
            Object.entries(prev.mcp.data).map(([name, item]) => [
              name,
              {
                ...item,
                description: (mcpConfig[name] as any)?.description ?? item.description,
              },
            ]),
          )
          const mcp = {
            ...prev.mcp,
            data: nextMcpData,
          }

          return { ...prev, plugins, acp, mcp }
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
  }, [loadMcp, loadSkills, loadAcp])

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
    acp: data.acp,
    lsp: data.lsp,
    plugins: data.plugins,
    skills: data.skills,
    refreshAll,
    refreshMcp,
    refreshAcp,
    toggleMcp,
    toggleTool,
    toggleAllMcpTools,
    toggleAcpCategory,
    toggleAcpTool,
    toggleAllAcpTools,
    toggleSkill,
    mcpBusy: busy,
    mcpToolBusy: tbusy,
    mcpRefreshing: refreshing,
    acpBusy,
    acpToolBusy,
    skillBusy: sbusy,
  }
}
