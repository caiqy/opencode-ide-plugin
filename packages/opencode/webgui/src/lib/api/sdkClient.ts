/**
 * OpenCode SDK client instance
 * Configured to connect to the OpenCode server at the default location
 */

import { createOpencodeClient, type Config, type Part, type Provider, type Session } from "@opencode-ai/sdk/client"
import type { PermissionRequest, QuestionRequest, UserMessage } from "@opencode-ai/sdk/v2/client"

// Create a single SDK client instance on current origin
const baseClient = createOpencodeClient({
  baseUrl: typeof window === "undefined" ? "http://localhost:4096" : window.location.origin,
})

type AuthMethod = {
  label: string
  type: "oauth" | "api"
}

type OAuthStatus = {
  status: "pending" | "success" | "failed"
  result?: {
    message?: string
  }
}

const oauth = new Map<
  string,
  {
    provider: string
    method: number
    status: OAuthStatus
  }
>()

function oauthID() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `oauth-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function errorMessage(input: unknown, fallback: string) {
  if (!input || typeof input !== "object") return fallback
  const msg = (input as { message?: unknown }).message
  if (typeof msg === "string" && msg.length > 0) return msg
  const data = (input as { data?: { message?: unknown } }).data
  if (typeof data?.message === "string" && data.message.length > 0) return data.message
  return fallback
}

interface ProvidersResponse {
  providers: Provider[]
  default: Record<string, string>
}

type ProviderCatalogModel = {
  id: string
  name: string
  status: string
}

type ProviderCatalogModelsResult = {
  providerID: string
  models: ProviderCatalogModel[]
}

interface SkillsResponse {
  name: string
  description: string
  enabled: boolean
}

interface PathResponse {
  state: string
  config: string
  configFile: string
  worktree: string
  directory: string
}

type ApiResult<T> = {
  data: T | null
  error: { message: string; status?: number } | null
}

type SessionListOptions = {
  limit?: number
  directory?: string
  roots?: boolean
}

async function pendingList<T>(url: string, fallback: string): Promise<ApiResult<T[]>> {
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    })
    if (!response.ok) return { data: null, error: { message: fallback, status: response.status } }
    const data = await response.json()
    if (!Array.isArray(data)) return { data: null, error: { message: fallback } }
    return { data: data as T[], error: null }
  } catch (error) {
    return { data: null, error: { message: error instanceof Error ? error.message : fallback } }
  }
}

function retryParts(input: Part[]) {
  return input
    .filter(
      (part): part is Extract<Part, { type: "text" | "file" | "agent" | "subtask" }> =>
        ["text", "file", "agent", "subtask"].includes(part.type),
    )
    .map((part) => {
      const { id, sessionID, messageID, ...rest } = part
      void id
      void sessionID
      void messageID
      return rest
    })
}

async function globalConfigGet(): Promise<ApiResult<Config>> {
  try {
    const response = await fetch("/global/config", {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    })

    if (!response.ok) {
      return {
        error: { message: "Failed to load global config" },
        data: null,
      }
    }

    const data = (await response.json()) as Config
    return { data, error: null }
  } catch (error) {
    return {
      error: { message: error instanceof Error ? error.message : "Unknown error" },
      data: null,
    }
  }
}

async function globalConfigUpdate(options: { body: Partial<Config> }): Promise<ApiResult<Config>> {
  try {
    const response = await fetch("/global/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options.body),
    })

    if (!response.ok) {
      return {
        error: { message: "Failed to update global config" },
        data: null,
      }
    }

    const data = (await response.json()) as Config
    return { data, error: null }
  } catch (error) {
    return {
      error: { message: error instanceof Error ? error.message : "Unknown error" },
      data: null,
    }
  }
}

async function globalConfigReplace(options: { body: Partial<Config> }): Promise<ApiResult<Config>> {
  try {
    const response = await fetch("/global/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options.body),
    })

    if (!response.ok) {
      return {
        error: { message: "Failed to replace global config" },
        data: null,
      }
    }

    const data = (await response.json()) as Config
    return { data, error: null }
  } catch (error) {
    return {
      error: { message: error instanceof Error ? error.message : "Unknown error" },
      data: null,
    }
  }
}

async function configProviderModels(providerID: string): Promise<ApiResult<ProviderCatalogModelsResult>> {
  try {
    const response = await fetch(`/config/providers/${encodeURIComponent(providerID)}/models`)

    if (!response.ok) {
      return {
        error: { message: "Failed to load provider catalog models" },
        data: null,
      }
    }

    const data = (await response.json()) as ProviderCatalogModelsResult
    return { data, error: null }
  } catch (error) {
    return {
      error: { message: error instanceof Error ? error.message : "Unknown error" },
      data: null,
    }
  }
}

async function sessionList(options: SessionListOptions = {}): Promise<ApiResult<Session[]>> {
  try {
    const query = new URLSearchParams()
    if (options.directory) query.set("directory", options.directory)
    if (typeof options.limit === "number") query.set("limit", String(options.limit))
    if (typeof options.roots === "boolean") query.set("roots", String(options.roots))
    const suffix = query.size > 0 ? `?${query.toString()}` : ""
    const response = await fetch(`/session${suffix}`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    })

    if (!response.ok) {
      return {
        error: { message: "Failed to load sessions" },
        data: null,
      }
    }

    const data = (await response.json()) as Session[]
    return { data, error: null }
  } catch (error) {
    return {
      error: { message: error instanceof Error ? error.message : "Unknown error" },
      data: null,
    }
  }
}

async function sessionRegenerateTitle(options: { path: { sessionID: string } }): Promise<ApiResult<Session>> {
  try {
    const response = await fetch(`/session/${encodeURIComponent(options.path.sessionID)}/title/regenerate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    })

    if (!response.ok) {
      return {
        error: { message: "Failed to regenerate session title" },
        data: null,
      }
    }

    const data = (await response.json()) as Session
    return { data, error: null }
  } catch (error) {
    return {
      error: { message: error instanceof Error ? error.message : "Unknown error" },
      data: null,
    }
  }
}

async function sessionSyncVisible(options: {
  body: { sessionIDs: string[] }
}): Promise<ApiResult<{ sessionIDs: string[] }>> {
  try {
    const response = await fetch("/session/visibility", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options.body),
    })

    if (!response.ok) {
      return {
        error: { message: "Failed to sync visible sessions", status: response.status },
        data: null,
      }
    }

    const data = (await response.json()) as { sessionIDs: string[] }
    return { data, error: null }
  } catch (error) {
    return {
      error: { message: error instanceof Error ? error.message : "Unknown error" },
      data: null,
    }
  }
}

async function mcpTools(options: { path: { name: string } }): Promise<ApiResult<unknown>> {
  try {
    const response = await fetch(`/mcp/${encodeURIComponent(options.path.name)}/tools`, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    })

    if (!response.ok) {
      return {
        error: { message: "Failed to load MCP tools" },
        data: null,
      }
    }

    const data = await response.json()
    return { data, error: null }
  } catch (error) {
    return {
      error: { message: error instanceof Error ? error.message : "Unknown error" },
      data: null,
    }
  }
}

async function mcpSetEnabled(options: {
  path: { name: string }
  body: { enabled: boolean }
}): Promise<ApiResult<unknown>> {
  try {
    const response = await fetch(`/mcp/${encodeURIComponent(options.path.name)}/enabled`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options.body),
    })

    if (!response.ok) {
      return {
        error: { message: "Failed to update MCP state" },
        data: null,
      }
    }

    const data = await response.json()
    return { data, error: null }
  } catch (error) {
    return {
      error: { message: error instanceof Error ? error.message : "Unknown error" },
      data: null,
    }
  }
}

async function mcpSetToolEnabled(options: {
  path: { name: string; toolId: string }
  body: { enabled: boolean }
}): Promise<ApiResult<unknown>> {
  try {
    const response = await fetch(
      `/mcp/${encodeURIComponent(options.path.name)}/tools/${encodeURIComponent(options.path.toolId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options.body),
      },
    )

    if (!response.ok) {
      return {
        error: { message: "Failed to update MCP tool" },
        data: null,
      }
    }

    const data = await response.json()
    return { data, error: null }
  } catch (error) {
    return {
      error: { message: error instanceof Error ? error.message : "Unknown error" },
      data: null,
    }
  }
}

/**
 * Extended SDK client with state management methods
 * TODO: Remove once SDK is regenerated with Stainless
 */
export const sdk = {
  ...baseClient,
  global: Object.assign(baseClient.global, {
    config: {
      get: globalConfigGet,
      update: globalConfigUpdate,
      replace: globalConfigReplace,
    },
  }),
  session: Object.assign(baseClient.session, {
    list: sessionList,
    regenerateTitle: sessionRegenerateTitle,
    syncVisible: sessionSyncVisible,
    retry: async (options: { path: { sessionID: string } }) => {
      try {
        const session = await baseClient.session.get({
          path: { id: options.path.sessionID },
        })
        if (session.error || !session.data) {
          return { error: { message: errorMessage(session.error, "Failed to load session") }, data: null }
        }

        const messages = await baseClient.session.messages({
          path: { id: options.path.sessionID },
        })
        if (messages.error || !messages.data) {
          return { error: { message: errorMessage(messages.error, "Failed to load session messages") }, data: null }
        }

        const sorted = [...messages.data].sort((a, b) => a.info.time.created - b.info.time.created)
        const cut = session.data.revert
          ? sorted.findIndex((item) => item.info.id === session.data.revert?.messageID)
          : -1
        const visible =
          cut < 0
            ? sorted
            : sorted.flatMap((item, index) => {
                if (index < cut) return [item]
                if (index > cut) return []
                if (!session.data.revert?.partID) return []
                const part = item.parts.findIndex((x) => x.id === session.data.revert?.partID)
                if (part <= 0) return []
                return [
                  {
                    ...item,
                    parts: item.parts.slice(0, part),
                  },
                ]
              })
        const latest = [...visible].reverse().find((item) => item.info.role === "user")
        if (!latest) return { error: { message: "No user message to retry" }, data: null }
        const info = latest.info as UserMessage
        const body = {
          parts: retryParts(latest.parts),
          agent: info.agent,
          model: {
            providerID: info.model.providerID,
            modelID: info.model.modelID,
          },
          variant: info.model.variant,
          format: info.format,
          system: info.system,
          tools: info.tools,
        }

        const response = await baseClient.session.prompt({
          path: { id: options.path.sessionID },
          body,
        })

        if (response.error || !response.data) {
          return { error: { message: errorMessage(response.error, "Failed to retry session") }, data: null }
        }

        return { data: response.data, error: null }
      } catch (error) {
        return {
          error: { message: error instanceof Error ? error.message : "Unknown error" },
          data: null,
        }
      }
    },
  }) as typeof baseClient.session & {
    list: (options?: SessionListOptions) => Promise<ApiResult<Session[]>>
    regenerateTitle: (options: { path: { sessionID: string } }) => Promise<ApiResult<Session>>
    syncVisible: (options: { body: { sessionIDs: string[] } }) => Promise<ApiResult<{ sessionIDs: string[] }>>
    retry: (options: { path: { sessionID: string } }) => Promise<any>
  },
  mcp: Object.assign(baseClient.mcp, {
    tools: mcpTools,
    setEnabled: mcpSetEnabled,
    setToolEnabled: mcpSetToolEnabled,
  }) as typeof baseClient.mcp & {
    tools: (options: { path: { name: string } }) => Promise<ApiResult<unknown>>
    setEnabled: (options: { path: { name: string }; body: { enabled: boolean } }) => Promise<ApiResult<unknown>>
    setToolEnabled: (options: {
      path: { name: string; toolId: string }
      body: { enabled: boolean }
    }) => Promise<ApiResult<unknown>>
  },
  config: {
    get: baseClient.config.get.bind(baseClient.config),
    update: baseClient.config.update.bind(baseClient.config),
    providers: baseClient.config.providers.bind(baseClient.config),
    providerModels: configProviderModels,
    allProviders: async () => {
      try {
        const response = await baseClient.provider.list()
        if (response.error || !response.data) {
          return { error: { message: "Failed to load providers" }, data: null as ProvidersResponse | null }
        }

        const data: ProvidersResponse = {
          providers: response.data.all as unknown as Provider[],
          default: response.data.default,
        }
        return { data, error: null as { message: string } | null }
      } catch (error) {
        return {
          error: { message: error instanceof Error ? error.message : "Unknown error" },
          data: null as ProvidersResponse | null,
        }
      }
    },
  },
  path: {
    get: async () => {
      try {
        const response = await fetch("/path", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        })

        if (!response.ok) {
          return {
            error: { message: "Failed to fetch path" },
            data: null as PathResponse | null,
          }
        }

        const data = (await response.json()) as PathResponse
        return { data, error: null as { message: string } | null }
      } catch (error) {
        return {
          error: { message: error instanceof Error ? error.message : "Unknown error" },
          data: null as PathResponse | null,
        }
      }
    },
  },
  auth: {
    set: async (provider: string, value: any) => {
      const res = await baseClient.auth.set({
        path: { id: provider },
        body: value,
      })
      if (res.error) throw new Error(errorMessage(res.error, "Failed to set auth"))
    },
    list: async () => {
      const res = await baseClient.provider.list()
      if (res.error || !res.data) return {}
      return Object.fromEntries(res.data.connected.map((item) => [item, true])) as Record<string, any>
    },
    remove: async (provider: string) => {
      const res = await fetch(`/auth/${provider}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      })
      if (!res.ok) throw new Error(await res.text())
    },
    methods: async (provider: string) => {
      const res = await baseClient.provider.auth()
      if (res.error || !res.data) return []
      return (res.data[provider] ?? []) as AuthMethod[]
    },
    start: async (provider: string, methodIndex: number, inputs: any) => {
      void inputs
      const res = await baseClient.provider.oauth.authorize({
        path: { id: provider },
        body: { method: methodIndex },
      })
      if (res.error || !res.data) {
        throw new Error(errorMessage(res.error, "Failed to start login"))
      }

      const id = oauthID()
      const status: OAuthStatus = { status: "pending" }
      oauth.set(id, {
        provider,
        method: methodIndex,
        status,
      })

      return {
        id,
        url: res.data.url,
        method: res.data.method,
        instructions: res.data.instructions,
      }
    },
    submit: async (id: string, code: string) => {
      const flow = oauth.get(id)
      if (!flow) throw new Error("OAuth flow not found")
      const res = await baseClient.provider.oauth.callback({
        path: { id: flow.provider },
        body: {
          method: flow.method,
          code,
        },
      })
      if (res.error) {
        const message = errorMessage(res.error, "Failed to submit OAuth code")
        flow.status = {
          status: "failed",
          result: {
            message,
          },
        }
        throw new Error(message)
      }
      flow.status = { status: "success" }
      return Boolean(res.data)
    },
    status: async (id: string) => {
      const flow = oauth.get(id)
      if (!flow) {
        return {
          status: "failed",
          result: {
            message: "OAuth flow not found",
          },
        }
      }
      return flow.status
    },
  },
  app: Object.assign(baseClient.app, {
    skills: async () => {
      try {
        const response = await fetch("/skill", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        })
        if (!response.ok) {
          return { error: { message: "Failed to load skills" }, data: null as SkillsResponse[] | null }
        }
        const data = (await response.json()) as SkillsResponse[]
        return { data, error: null as { message: string } | null }
      } catch (error) {
        return {
          error: { message: error instanceof Error ? error.message : "Unknown error" },
          data: null as SkillsResponse[] | null,
        }
      }
    },
    setSkillEnabled: async (options: {
      path: { name: string }
      body: { enabled: boolean }
    }): Promise<ApiResult<unknown>> => {
      try {
        const response = await fetch(`/skill/${encodeURIComponent(options.path.name)}/enabled`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options.body),
        })
        if (!response.ok) {
          return { error: { message: "Failed to update skill state" }, data: null }
        }
        const data = await response.json()
        return { data, error: null }
      } catch (error) {
        return { error: { message: error instanceof Error ? error.message : "Unknown error" }, data: null }
      }
    },
  }) as typeof baseClient.app & {
    skills: () => Promise<{ data: SkillsResponse[] | null; error: { message: string } | null }>
    setSkillEnabled: (options: { path: { name: string }; body: { enabled: boolean } }) => Promise<ApiResult<unknown>>
  },
  permissions: {
    list: () => pendingList<PermissionRequest>("/permission", "Failed to load pending permissions"),
    respond: async (options: {
      path: { requestID: string }
      body: { reply: "once" | "always" | "reject"; message?: string }
    }) => {
      const response = await fetch(`/permission/${options.path.requestID}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options.body),
      })
      if (!response.ok) {
        return { error: { message: "Failed to respond to permission" }, data: null }
      }
      const data = await response.json()
      return { data, error: null }
    },
  },
  question: {
    list: () => pendingList<QuestionRequest>("/question", "Failed to load pending questions"),
    reply: async (options: { requestID: string; answers: Array<Array<string>> }) => {
      const response = await fetch(`/question/${options.requestID}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: options.answers }),
      })
      if (!response.ok) {
        return { error: { message: "Failed to reply to question" }, data: null }
      }
      const data = await response.json()
      return { data, error: null }
    },
    reject: async (options: { requestID: string }) => {
      const response = await fetch(`/question/${options.requestID}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
      if (!response.ok) {
        return { error: { message: "Failed to reject question" }, data: null }
      }
      const data = await response.json()
      return { data, error: null }
    },
  },
}
