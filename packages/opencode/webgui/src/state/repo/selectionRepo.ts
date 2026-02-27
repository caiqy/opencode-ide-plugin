import { scopedStateGetJSON, scopedStateSetJSON } from "../scopedStorage"

const key = "opencode:webgui:workspace:last_selection:v1"

export type Selection = {
  agent: string | null
  provider_id: string | null
  model_id: string | null
  variant: string | null
  agent_model_map: Record<string, { provider_id: string; model_id: string }>
  updated_at: number
}

const fallback: Selection = {
  agent: null,
  provider_id: null,
  model_id: null,
  variant: null,
  agent_model_map: {},
  updated_at: 0,
}

function map(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {} as Selection["agent_model_map"]
  }
  return Object.fromEntries(
    Object.entries(input).flatMap(([k, v]) => {
      if (!v || typeof v !== "object" || Array.isArray(v)) return []
      const provider = (v as { provider_id?: unknown }).provider_id
      const model = (v as { model_id?: unknown }).model_id
      if (typeof provider !== "string" || typeof model !== "string") return []
      return [[k, { provider_id: provider, model_id: model }]]
    }),
  )
}

export async function loadSelection(): Promise<Selection> {
  const value = await scopedStateGetJSON<unknown>("workspace", key, fallback)
  if (!value || typeof value !== "object" || Array.isArray(value)) return fallback
  return {
    agent: typeof (value as { agent?: unknown }).agent === "string" ? (value as { agent: string }).agent : null,
    provider_id:
      typeof (value as { provider_id?: unknown }).provider_id === "string"
        ? (value as { provider_id: string }).provider_id
        : null,
    model_id:
      typeof (value as { model_id?: unknown }).model_id === "string" ? (value as { model_id: string }).model_id : null,
    variant:
      typeof (value as { variant?: unknown }).variant === "string" ? (value as { variant: string }).variant : null,
    agent_model_map: map((value as { agent_model_map?: unknown }).agent_model_map),
    updated_at:
      typeof (value as { updated_at?: unknown }).updated_at === "number"
        ? (value as { updated_at: number }).updated_at
        : 0,
  }
}

export async function saveSelection(value: Selection) {
  return scopedStateSetJSON("workspace", key, value)
}

export async function patchSelection(value: Partial<Selection>) {
  const prev = await loadSelection()
  const next = {
    ...prev,
    ...value,
    agent_model_map: value.agent_model_map ? map(value.agent_model_map) : prev.agent_model_map,
    updated_at: value.updated_at ?? Date.now(),
  } satisfies Selection
  await saveSelection(next)
  return next
}
