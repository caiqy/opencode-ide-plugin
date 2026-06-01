import { scopedStateGetJSON, scopedStateSetJSON } from "../scopedStorage"
import { quick_phrase_preset } from "./quickPhrasePreset"

const key = "opencode:webgui:global:quick_phrase:v1"

export type QuickPhraseItem = {
  id: string
  title: string
  body: string
  source: "preset" | "custom"
  hidden: boolean
  order: number
  updated_at: number
}

export type QuickPhraseState = {
  preset_version: number
  order: string[]
  items: Record<string, QuickPhraseItem>
}

let queue = Promise.resolve()

function item(input: unknown): QuickPhraseItem | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null
  const id = (input as { id?: unknown }).id
  const title = (input as { title?: unknown }).title
  const body = (input as { body?: unknown }).body
  const source = (input as { source?: unknown }).source
  if (typeof id !== "string" || typeof title !== "string" || typeof body !== "string") return null
  if (source !== "preset" && source !== "custom") return null
  return {
    id,
    title,
    body,
    source,
    hidden: (input as { hidden?: unknown }).hidden === true,
    order: typeof (input as { order?: unknown }).order === "number" ? (input as { order: number }).order : 0,
    updated_at:
      typeof (input as { updated_at?: unknown }).updated_at === "number"
        ? (input as { updated_at: number }).updated_at
        : 0,
  }
}

function map(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {} as Record<string, QuickPhraseItem>
  return Object.fromEntries(
    Object.entries(input).flatMap(([k, v]) => {
      const next = item(v)
      if (!next || next.id !== k) return []
      return [[k, next]]
    }),
  )
}

function normalize(input: unknown): QuickPhraseState {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {}
  const prev = map((raw as { items?: unknown }).items)
  const merged = Object.fromEntries(
    quick_phrase_preset.items.map((v, i) => {
      const current = prev[v.id]
      return [
        v.id,
        {
          id: v.id,
          title: v.title,
          body: v.body,
          source: "preset" as const,
          hidden: current?.source === "preset" ? current.hidden : false,
          order: i,
          updated_at: current?.updated_at ?? 0,
        },
      ]
    }),
  )
  const custom = Object.fromEntries(Object.entries(prev).filter(([_, v]) => v.source === "custom"))
  const items = {
    ...merged,
    ...custom,
  }
  const list =
    Array.isArray((raw as { order?: unknown }).order) && (raw as { order: unknown[] }).order.length > 0
      ? (raw as { order: unknown[] }).order
      : []
  const base = list.filter((v): v is string => typeof v === "string" && v in items)
  const rest = Object.values(items)
    .filter((v) => !base.includes(v.id))
    .sort((a, b) => a.order - b.order)
    .map((v) => v.id)
  return {
    preset_version: quick_phrase_preset.version,
    order: [...new Set([...base, ...rest])],
    items,
  }
}

export async function loadQuickPhraseState() {
  const value = await scopedStateGetJSON<unknown>("global", key, null)
  return normalize(value)
}

export async function saveQuickPhraseState(value: QuickPhraseState) {
  return scopedStateSetJSON("global", key, normalize(value))
}

function enqueue<T>(task: () => Promise<T>) {
  const run = queue.then(task, task)
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function sorted(state: QuickPhraseState, order: string[]) {
  const base = order.filter((id) => id in state.items)
  const rest = Object.values(state.items)
    .filter((item) => !base.includes(item.id))
    .sort((a, b) => a.order - b.order)
    .map((item) => item.id)
  return [...new Set([...base, ...rest])]
}

export function reorderQuickPhrase(order: string[]) {
  return enqueue(async () => {
    const prev = await loadQuickPhraseState()
    const next = {
      ...prev,
      order: sorted(prev, order),
    }
    await saveQuickPhraseState(next)
    return next
  })
}

export function toggleQuickPhraseHidden(id: string) {
  return enqueue(async () => {
    const prev = await loadQuickPhraseState()
    const item = prev.items[id]
    if (!item) return prev
    const next = {
      ...prev,
      items: {
        ...prev.items,
        [id]: {
          ...item,
          hidden: !item.hidden,
          updated_at: Date.now(),
        },
      },
    }
    await saveQuickPhraseState(next)
    return next
  })
}

export function addCustomQuickPhrase(input: { title: string; body: string }) {
  return enqueue(async () => {
    const title = input.title.trim()
    const body = input.body.trim()
    if (!title || !body) {
      return loadQuickPhraseState()
    }
    const prev = await loadQuickPhraseState()
    const id = `custom:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 7)}`
    const item = {
      id,
      title,
      body,
      source: "custom" as const,
      hidden: false,
      order: prev.order.length,
      updated_at: Date.now(),
    }
    const next = {
      ...prev,
      order: [...prev.order, id],
      items: {
        ...prev.items,
        [id]: item,
      },
    }
    await saveQuickPhraseState(next)
    return next
  })
}

export function updateCustomQuickPhrase(id: string, patch: { title: string; body: string }) {
  return enqueue(async () => {
    const title = patch.title.trim()
    const body = patch.body.trim()
    if (!title || !body) {
      return loadQuickPhraseState()
    }
    const prev = await loadQuickPhraseState()
    const item = prev.items[id]
    if (!item || item.source !== "custom") return prev
    const next = {
      ...prev,
      items: {
        ...prev.items,
        [id]: {
          ...item,
          title,
          body,
          updated_at: Date.now(),
        },
      },
    }
    await saveQuickPhraseState(next)
    return next
  })
}

export function removeQuickPhrase(id: string) {
  return enqueue(async () => {
    const prev = await loadQuickPhraseState()
    const item = prev.items[id]
    if (!item || item.source !== "custom") return prev
    const items = { ...prev.items }
    delete items[id]
    const next = {
      ...prev,
      items,
      order: prev.order.filter((value) => value !== id),
    }
    await saveQuickPhraseState(next)
    return next
  })
}
