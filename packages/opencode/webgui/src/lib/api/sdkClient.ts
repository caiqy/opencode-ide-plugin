/**
 * OpenCode SDK client instance
 * Configured to connect to the OpenCode server at the default location
 */

import { createOpencodeClient, type Provider } from "@opencode-ai/sdk/client"

// Create a single SDK client instance with relative baseUrl
// The server runs on the same origin, so we use '/' for relative requests
const baseClient = createOpencodeClient({ baseUrl: "/" })

/**
 * State API response types
 */
interface StateResponse {
  theme?: string
  agent_model?: Record<string, { provider_id: string; model_id: string }>
  provider?: string
  model?: string
  agent?: string
  variant?: Record<string, string>
  recently_used_models?: Array<{
    provider_id: string
    model_id: string
    last_used: string // RFC3339 timestamp
  }>
  recently_used_agents?: Array<{
    agent_name: string
    last_used: string // RFC3339 timestamp
  }>
  show_tool_details?: boolean
  show_thinking_blocks?: boolean
}

interface ProvidersResponse {
  providers: Provider[]
  default: Record<string, string>
}

interface PathResponse {
  state: string
  config: string
  worktree: string
  directory: string
}

/**
 * Extended SDK client with state management methods
 * TODO: Remove once SDK is regenerated with Stainless
 */
export const sdk = {
  ...baseClient,
  session: Object.assign(baseClient.session, {
    retry: async (options: { path: { sessionID: string } }) => {
      try {
        const response = await fetch(`/app/api/session/${options.path.sessionID}/retry`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })

        if (!response.ok) {
          return { error: { message: "Failed to retry session" }, data: null }
        }

        const data = await response.json()
        return { data, error: null }
      } catch (error) {
        return {
          error: { message: error instanceof Error ? error.message : "Unknown error" },
          data: null,
        }
      }
    },
  }) as (typeof baseClient.session) & {
    retry: (options: { path: { sessionID: string } }) => Promise<any>
  },
  config: {
    get: baseClient.config.get.bind(baseClient.config),
    update: baseClient.config.update.bind(baseClient.config),
    providers: baseClient.config.providers.bind(baseClient.config),
    allProviders: async () => {
      try {
        const response = await fetch("/app/api/config/providers", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        })

        if (!response.ok) {
          return { error: { message: "Failed to load providers" }, data: null as ProvidersResponse | null }
        }

        const data = (await response.json()) as ProvidersResponse
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
      const res = await fetch("/app/api/auth/set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, value }),
      })
      if (!res.ok) throw new Error(await res.text())
    },
    list: async () => {
      const res = await fetch("/app/api/auth/list")
      return res.json() as Promise<Record<string, any>>
    },
    remove: async (provider: string) => {
      await fetch("/app/api/auth/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider }),
      })
    },
    methods: async (provider: string) => {
      const res = await fetch(`/app/api/auth/methods?provider=${provider}`)
      return res.json() as Promise<
        Array<{
          label: string
          type: "oauth" | "api"
          prompts?: any[]
        }>
      >
    },
    start: async (provider: string, methodIndex: number, inputs: any) => {
      const res = await fetch("/app/api/auth/login/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, methodIndex, inputs }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json() as Promise<{ id: string; url?: string; method: "auto" | "code"; instructions?: string }>
    },
    submit: async (id: string, code: string) => {
      const res = await fetch("/app/api/auth/login/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, code }),
      })
      if (!res.ok) throw new Error(await res.text())
      return res.json() as Promise<boolean>
    },
    status: async (id: string) => {
      const res = await fetch(`/app/api/auth/login/status/${id}`)
      return res.json() as Promise<{ status: "pending" | "success" | "failed"; result?: any }>
    },
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
  state: {
    get: async () => {
      try {
        const response = await fetch("/app/api/state", {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        })
        if (!response.ok) {
          return { error: { message: "Failed to fetch state" }, data: null }
        }
        const data = (await response.json()) as StateResponse
        return { data, error: null }
      } catch (error) {
        return { error: { message: error instanceof Error ? error.message : "Unknown error" }, data: null }
      }
    },
    update: async (options: { body: Partial<StateResponse> }) => {
      try {
        const response = await fetch("/app/api/state", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(options.body),
        })
        if (!response.ok) {
          return { error: { message: "Failed to update state" }, data: null }
        }
        const data = (await response.json()) as StateResponse
        return { data, error: null }
      } catch (error) {
        return { error: { message: error instanceof Error ? error.message : "Unknown error" }, data: null }
      }
    },
  },
}
