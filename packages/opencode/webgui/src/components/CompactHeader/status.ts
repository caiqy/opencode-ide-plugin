export type Tab = "servers" | "mcp" | "acp" | "lsp" | "plugins" | "skills"

export type State = "ready" | "empty" | "failed" | "stale"

export type Box<T> = {
  state: State
  data: T
  error: string | null
  updatedAt: number | null
}

export type ServerData = {
  connectionState: "connecting" | "connected" | "disconnected" | "error"
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

export type McpData = {
  status: "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration"
  description?: string
  error?: string
  tools?: Array<{
    id: string
    name: string
    description?: string
    enabled: boolean
  }>
}

export type AcpToolData = {
  id: string
  name: string
  description?: string
  group?: string
  enabled: boolean
}

export type AcpCategoryData = {
  id: string
  name: string
  description?: string
  status: "connected" | "disabled" | "unavailable"
  enabled: boolean
  tools: AcpToolData[]
}

export type AcpData = {
  installed: boolean
  categories: AcpCategoryData[]
}

export type LspData = {
  id: string
  name: string
  root: string
  status: "connected" | "error"
}

export const DEFAULT_STATUS_TAB: Tab = "servers"

export const STATUS_TABS: Array<{ id: Tab; label: string }> = [
  { id: "servers", label: "Server" },
  { id: "mcp", label: "MCP" },
  { id: "acp", label: "ACP" },
  { id: "lsp", label: "LSP" },
  { id: "plugins", label: "Plugins" },
  { id: "skills", label: "Skills" },
]

export function buildServerView(input: Box<ServerData>) {
  return {
    state: input.state,
    error: input.error,
    updatedAt: input.updatedAt,
    summary: {
      connection: input.data.connectionState,
      backendUrl: input.data.backendUrl,
      project: input.data.project,
      worktree: input.data.worktree,
      directory: input.data.directory,
      bridge: input.data.bridge,
    },
    note: "首版仅展示当前连接、IDE bridge 与项目路径摘要，不提供多 server 管理。",
  }
}

export function buildPluginView(input: Box<string[]>) {
  return {
    state: input.state,
    error: input.error,
    updatedAt: input.updatedAt,
    items: input.data,
    empty: "当前实例中未配置已配置插件。",
  }
}

export function buildLspView(input: Box<LspData[]>) {
  return {
    state: input.state,
    error: input.error,
    updatedAt: input.updatedAt,
    items: input.data,
  }
}

export function buildMcpView(input: Box<Record<string, McpData>>) {
  return {
    state: input.state,
    error: input.error,
    updatedAt: input.updatedAt,
    refreshLabel: "手动刷新",
    items: Object.entries(input.data).map(([name, item]) => ({
      name,
      description: item.description,
      status: item.status,
      enabled: item.status === "connected",
      error: item.error,
      tools: Array.isArray(item.tools) ? item.tools : [],
      disabled: item.status === "needs_auth" || item.status === "needs_client_registration",
      reason:
        item.status === "needs_auth"
          ? "需要认证"
          : item.status === "failed"
            ? item.error
            : item.status === "needs_client_registration"
              ? (item.error ?? "需要客户端注册")
              : undefined,
    })),
  }
}

export function buildAcpView(input: Box<AcpData>) {
  return {
    state: input.state,
    error: input.error,
    updatedAt: input.updatedAt,
    installed: input.data.installed,
    categories: input.data.categories,
    fallbackNote: "当前运行在独立浏览器模式，未连接 IDE 宿主，ACP 能力不可用。",
  }
}

export type SkillState = {
  enabled: boolean
  description?: string
  source?: string
}

export function buildSkillView(input: Box<Record<string, SkillState>>) {
  return {
    state: input.state,
    error: input.error,
    updatedAt: input.updatedAt,
    items: Object.entries(input.data)
      .map(([name, item]) => ({
        name,
        enabled: item.enabled,
        description: item.description,
        source: item.source,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}
