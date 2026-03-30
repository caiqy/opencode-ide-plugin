type Tab = "servers" | "mcp" | "lsp" | "plugins" | "skills"

type State = "ready" | "empty" | "failed" | "stale"

type Box<T> = {
  state: State
  data: T
  error: string | null
  updatedAt: number | null
}

type ServerData = {
  connectionState: "connecting" | "connected" | "disconnected" | "error"
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

type McpData = {
  status: "connected" | "disabled" | "failed" | "needs_auth" | "needs_client_registration"
  error?: string
  tools?: Array<{
    id: string
    name: string
    enabled: boolean
  }>
}

type LspData = {
  id: string
  name: string
  root: string
  status: "connected" | "error"
}

export const DEFAULT_STATUS_TAB: Tab = "servers"

export const STATUS_TABS: Array<{ id: Tab; label: string }> = [
  { id: "servers", label: "Server" },
  { id: "mcp", label: "MCP" },
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

type SkillState = {
  enabled: boolean
}

export function buildSkillView(input: Box<Record<string, SkillState>>) {
  return {
    state: input.state,
    error: input.error,
    updatedAt: input.updatedAt,
    items: Object.entries(input.data)
      .map(([name, item]) => ({ name, enabled: item.enabled }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}
