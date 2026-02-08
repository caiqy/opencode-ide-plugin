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
 * Legacy webgui state snapshot (migration only)
 */
interface LegacyStateSnapshot {
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
const legacyFavoriteKey = "opencode_favorite_models_v1"

function stateValue() {
  if (typeof localStorage === "undefined") return {}
  const raw = localStorage.getItem(stateKey)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return {}
    return parsed as LegacyStateSnapshot
  } catch {
    return {}
  }
}

function recentFromState(state: LegacyStateSnapshot) {
  return (state.recently_used_models ?? []).map((item) => ({
    providerID: item.provider_id,
    modelID: item.model_id,
  }))
}

function kvFromLegacyState(state: LegacyStateSnapshot) {
  const migrated: Record<string, any> = {}
  if (typeof state.agent === "string") migrated.webgui_agent = state.agent
  if (typeof state.provider === "string") migrated.webgui_provider = state.provider
  if (typeof state.model === "string") migrated.webgui_model = state.model
  if (state.agent_model && typeof state.agent_model === "object") {
    migrated.webgui_agent_model = state.agent_model
  }
  if (typeof state.message_parts_auto_expand === "boolean") {
    migrated.webgui_message_parts_auto_expand = state.message_parts_auto_expand
  }
  return migrated
}

function modelEntryKey(entry: ModelEntry) {
  return `${entry.providerID}/${entry.modelID}`
}

function parseModelEntryArray(input: unknown) {
  if (!Array.isArray(input)) return [] as ModelEntry[]
  return input.filter(
    (item): item is ModelEntry =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as { providerID?: unknown }).providerID === "string" &&
      typeof (item as { modelID?: unknown }).modelID === "string",
  )
}

function parseLegacyFavoriteEntries(raw: string | null | undefined) {
  if (!raw) return [] as ModelEntry[]
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    const result: ModelEntry[] = []
    for (const item of parsed) {
      if (typeof item !== "string") continue
      const index = item.indexOf("/")
      if (index <= 0 || index >= item.length - 1) continue
      result.push({
        providerID: item.slice(0, index),
        modelID: item.slice(index + 1),
      })
    }
    return result
  } catch {
    return []
  }
}

function mergeModelEntries(primary: ModelEntry[], secondary: ModelEntry[]) {
  const merged: ModelEntry[] = []
  const seen = new Set<string>()
  for (const item of [...primary, ...secondary]) {
    const key = modelEntryKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(item)
  }
  return merged
}

function legacyFavoriteEntries() {
  if (typeof localStorage === "undefined") return [] as ModelEntry[]
  return parseLegacyFavoriteEntries(localStorage.getItem(legacyFavoriteKey))
}

function legacyFavoriteStore(entries: ModelEntry[]) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(legacyFavoriteKey, JSON.stringify(entries.map(modelEntryKey)))
}

function modelFromState(state: LegacyStateSnapshot): ModelPreferences {
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

  const legacyFavorite = legacyFavoriteEntries()
  const raw = localStorage.getItem(modelKey)
  if (!raw) {
    const favorite = mergeModelEntries(fallback.favorite, legacyFavorite)
    const migrated = {
      ...fallback,
      favorite,
    }
    if (favorite.length > 0) {
      modelStore(migrated)
    }
    return migrated
  }

  try {
    const parsed = JSON.parse(raw) as {
      recent?: unknown
      favorite?: unknown
      variant?: unknown
    }

    const recent = parsed.recent !== undefined ? parseModelEntryArray(parsed.recent) : fallback.recent

    const parsedFavorite = parsed.favorite !== undefined ? parseModelEntryArray(parsed.favorite) : fallback.favorite
    const favorite = mergeModelEntries(parsedFavorite, legacyFavorite)

    const variant =
      parsed.variant && typeof parsed.variant === "object"
        ? (parsed.variant as Record<string, string>)
        : fallback.variant

    const result = {
      recent,
      favorite,
      variant,
    }

    if (favorite.length !== parsedFavorite.length) {
      modelStore(result)
    }

    return result
  } catch {
    const favorite = mergeModelEntries(fallback.favorite, legacyFavorite)
    const migrated = {
      ...fallback,
      favorite,
    }
    if (favorite.length > 0) {
      modelStore(migrated)
    }
    return migrated
  }
}

function modelStore(value: ModelPreferences) {
  if (typeof localStorage === "undefined") return
  localStorage.setItem(modelKey, JSON.stringify(value))
  legacyFavoriteStore(value.favorite)
}

function kvValue() {
  if (typeof localStorage === "undefined") return {}
  const legacy = kvFromLegacyState(stateValue())
  const raw = localStorage.getItem(kvKey)
  if (!raw) {
    if (Object.keys(legacy).length > 0) {
      kvStore(legacy)
    }
    return legacy
  }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return legacy
    const current = parsed as Record<string, any>
    const merged = {
      ...legacy,
      ...current,
    }
    if (JSON.stringify(merged) !== JSON.stringify(current)) {
      kvStore(merged)
    }
    return merged
  } catch {
    if (Object.keys(legacy).length > 0) {
      kvStore(legacy)
    }
    return legacy
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
