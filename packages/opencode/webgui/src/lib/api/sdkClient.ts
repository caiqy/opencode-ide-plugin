/**
 * OpenCode SDK client instance
 * Configured to connect to the OpenCode server at the default location
 */

import { createOpencodeClient, type Config, type Provider } from "@opencode-ai/sdk/client"

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

interface SkillsResponse {
  name: string
  description: string
}

interface PathResponse {
  state: string
  config: string
  worktree: string
  directory: string
}

type ApiResult<T> = {
  data: T | null
  error: { message: string } | null
}

function retryParts(input: any[]) {
  return input
    .filter((part) => ["text", "file", "agent", "subtask"].includes(part.type))
    .map((part) => {
      const { sessionID, messageID, ...rest } = part
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
    },
  }),
  session: Object.assign(baseClient.session, {
    retry: async (options: { path: { sessionID: string } }) => {
      try {
        const messages = await baseClient.session.messages({
          path: { id: options.path.sessionID },
        })
        if (messages.error || !messages.data) {
          return { error: { message: errorMessage(messages.error, "Failed to load session messages") }, data: null }
        }

        const sorted = [...messages.data].sort((a, b) => a.info.time.created - b.info.time.created)
        const latest = [...sorted].reverse().find((item) => item.info.role === "user")
        if (!latest) return { error: { message: "No user message to retry" }, data: null }
        const info = latest.info as {
          agent?: string
          model?: {
            providerID: string
            modelID: string
          }
        }

        const response = await baseClient.session.prompt({
          path: { id: options.path.sessionID },
          body: {
            parts: retryParts(latest.parts),
            agent: info.agent,
            model: info.model,
          },
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
    retry: (options: { path: { sessionID: string } }) => Promise<any>
  },
  mcp: Object.assign(baseClient.mcp, {
    tools: mcpTools,
  }) as typeof baseClient.mcp & {
    tools: (options: { path: { name: string } }) => Promise<ApiResult<unknown>>
  },
  config: {
    get: baseClient.config.get.bind(baseClient.config),
    update: baseClient.config.update.bind(baseClient.config),
    providers: baseClient.config.providers.bind(baseClient.config),
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
  }) as typeof baseClient.app & {
    skills: () => Promise<{ data: SkillsResponse[] | null; error: { message: string } | null }>
  },
  permissions: {
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
