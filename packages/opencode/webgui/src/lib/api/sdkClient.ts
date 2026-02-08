/**
 * OpenCode SDK client instance
 * Configured to connect to the OpenCode server at the default location
 */

import { createOpencodeClient, type Provider } from "@opencode-ai/sdk/client"

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
  message_parts_auto_expand?: boolean
}

interface ProvidersResponse {
  providers: Provider[]
  default: Record<string, string>
}

interface ModelEntry {
  providerID: string
  modelID: string
}

interface ModelPreferences {
  recent: ModelEntry[]
  favorite: ModelEntry[]
  variant?: Record<string, string>
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

const stateKey = "opencode_webgui_state_v1"
const modelKey = "opencode_webgui_model_v1"
const kvKey = "opencode_webgui_kv_v1"

function stateValue() {
  if (typeof localStorage === "undefined") return {}
  const raw = localStorage.getItem(stateKey)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}
    return parsed as StateResponse
  } catch {
    return {}
  }
}

function stateStore(value: StateResponse) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(stateKey, JSON.stringify(value))
}

function recentFromState(state: StateResponse) {
  return (state.recently_used_models ?? []).map((item) => ({
    providerID: item.provider_id,
    modelID: item.model_id,
  }))
}

function modelFromState(state: StateResponse): ModelPreferences {
  return {
    recent: recentFromState(state),
    favorite: [],
    variant: state.variant ?? {},
  }
}

function modelValue() {
  const state = stateValue()
  const fallback = modelFromState(state)
  if (typeof localStorage === "undefined") return fallback
  const raw = localStorage.getItem(modelKey)
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw) as {
      recent?: unknown
      favorite?: unknown
      variant?: unknown
    }

    const recent = Array.isArray(parsed.recent)
      ? parsed.recent.filter(
          (item): item is ModelEntry =>
            Boolean(item) &&
            typeof item === "object" &&
            typeof (item as { providerID?: unknown }).providerID === "string" &&
            typeof (item as { modelID?: unknown }).modelID === "string",
        )
      : fallback.recent

    const favorite = Array.isArray(parsed.favorite)
      ? parsed.favorite.filter(
          (item): item is ModelEntry =>
            Boolean(item) &&
            typeof item === "object" &&
            typeof (item as { providerID?: unknown }).providerID === "string" &&
            typeof (item as { modelID?: unknown }).modelID === "string",
        )
      : fallback.favorite

    const variant =
      parsed.variant && typeof parsed.variant === "object"
        ? (parsed.variant as Record<string, string>)
        : fallback.variant

    return {
      recent,
      favorite,
      variant,
    }
  } catch {
    return fallback
  }
}

function modelStore(value: ModelPreferences) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(modelKey, JSON.stringify(value))
}

function kvValue() {
  if (typeof localStorage === "undefined") return {}
  const raw = localStorage.getItem(kvKey)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}
    return parsed as Record<string, any>
  } catch {
    return {}
  }
}

function kvStore(value: Record<string, any>) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(kvKey, JSON.stringify(value))
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

/**
 * Extended SDK client with state management methods
 * TODO: Remove once SDK is regenerated with Stainless
 */
export const sdk = {
  ...baseClient,
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
  state: {
    get: async () => {
      const data = stateValue()
      return { data, error: null }
    },
    update: async (options: { body: Partial<StateResponse> }) => {
      try {
        const prev = stateValue()
        const body = options.body
        const next = { ...prev } as StateResponse

        if (body.theme !== undefined) next.theme = body.theme
        if (body.provider !== undefined) next.provider = body.provider
        if (body.model !== undefined) next.model = body.model
        if (body.agent !== undefined) next.agent = body.agent
        if (body.show_tool_details !== undefined) next.show_tool_details = body.show_tool_details
        if (body.show_thinking_blocks !== undefined) next.show_thinking_blocks = body.show_thinking_blocks
        if (body.message_parts_auto_expand !== undefined)
          next.message_parts_auto_expand = body.message_parts_auto_expand
        if (body.recently_used_models !== undefined) next.recently_used_models = body.recently_used_models
        if (body.recently_used_agents !== undefined) next.recently_used_agents = body.recently_used_agents

        if (body.agent_model) {
          next.agent_model = {
            ...(next.agent_model ?? {}),
            ...body.agent_model,
          }
        }

        if (body.variant) {
          next.variant = {
            ...(next.variant ?? {}),
            ...body.variant,
          }
        }

        stateStore(next)

        const model = modelValue()
        let shouldStoreModel = false
        if (body.recently_used_models !== undefined) {
          model.recent = recentFromState(next)
          shouldStoreModel = true
        }
        if (body.variant) {
          model.variant = {
            ...(model.variant ?? {}),
            ...body.variant,
          }
          shouldStoreModel = true
        }
        if (shouldStoreModel) {
          modelStore(model)
        }

        return { data: next, error: null }
      } catch (error) {
        return { error: { message: error instanceof Error ? error.message : "Unknown error" }, data: null }
      }
    },
  },
  model: {
    get: async () => {
      const data = modelValue()
      return { data, error: null as { message: string } | null }
    },
    update: async (options: { body: Partial<ModelPreferences> }) => {
      try {
        const prev = modelValue()
        const body = options.body
        const next: ModelPreferences = {
          recent: body.recent ?? prev.recent ?? [],
          favorite: body.favorite ?? prev.favorite ?? [],
          variant: body.variant
            ? {
                ...(prev.variant ?? {}),
                ...body.variant,
              }
            : (prev.variant ?? {}),
        }

        modelStore(next)

        const state = stateValue()
        if (body.recent !== undefined) {
          const now = Date.now()
          state.recently_used_models = next.recent.map((entry, index) => ({
            provider_id: entry.providerID,
            model_id: entry.modelID,
            last_used: new Date(now - index).toISOString(),
          }))

          const first = next.recent[0]
          if (first) {
            state.provider = first.providerID
            state.model = first.modelID
          }
        }

        if (body.variant !== undefined) {
          state.variant = {
            ...(state.variant ?? {}),
            ...(body.variant ?? {}),
          }
        }

        stateStore(state)

        return { data: next, error: null as { message: string } | null }
      } catch (error) {
        return {
          error: { message: error instanceof Error ? error.message : "Unknown error" },
          data: null as ModelPreferences | null,
        }
      }
    },
  },
  kv: {
    get: async () => {
      const data = kvValue()
      return { data, error: null as { message: string } | null }
    },
    update: async (options: { body: Record<string, any> }) => {
      try {
        const next = {
          ...kvValue(),
          ...options.body,
        }
        kvStore(next)
        return { data: next, error: null as { message: string } | null }
      } catch (error) {
        return {
          error: { message: error instanceof Error ? error.message : "Unknown error" },
          data: null as Record<string, any> | null,
        }
      }
    },
  },
}
