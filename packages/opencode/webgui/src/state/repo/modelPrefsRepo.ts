import { scopedStateGetJSON, scopedStateSetJSON } from "../scopedStorage"

const key = "opencode:webgui:global:model:v1"

export type ModelEntry = {
  providerID: string
  modelID: string
}

export type ModelPrefs = {
  recent: ModelEntry[]
  favorite: ModelEntry[]
}

let queue = Promise.resolve()
let cachedPrefsPromise: Promise<ModelPrefs> | undefined

function entries(input: unknown) {
  if (!Array.isArray(input)) return [] as ModelEntry[]
  return input.filter(
    (item): item is ModelEntry =>
      Boolean(item) &&
      typeof item === "object" &&
      typeof (item as { providerID?: unknown }).providerID === "string" &&
      typeof (item as { modelID?: unknown }).modelID === "string",
  )
}

async function loadModelPrefsFresh(): Promise<ModelPrefs> {
  const fallback: ModelPrefs = {
    recent: [],
    favorite: [],
  }
  const value = await scopedStateGetJSON<unknown>("global", key, fallback)
  if (!value || typeof value !== "object") return fallback
  return {
    recent: entries((value as { recent?: unknown }).recent),
    favorite: entries((value as { favorite?: unknown }).favorite),
  }
}

export function loadModelPrefs(): Promise<ModelPrefs> {
  if (!cachedPrefsPromise) {
    cachedPrefsPromise = loadModelPrefsFresh().catch((error) => {
      cachedPrefsPromise = undefined
      throw error
    })
  }
  return cachedPrefsPromise
}

/** Reset the internal prefs cache. Intended for test isolation. */
export function resetModelPrefsCache() {
  cachedPrefsPromise = undefined
  queue = Promise.resolve()
}

export async function saveModelPrefs(value: ModelPrefs) {
  const safe = {
    recent: entries(value.recent),
    favorite: entries(value.favorite),
  }
  await scopedStateSetJSON("global", key, safe)
  cachedPrefsPromise = Promise.resolve(safe)
}

function enqueue<T>(task: () => Promise<T>) {
  const run = queue.then(task, task)
  queue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export function updateModelPrefs(mutator: (value: ModelPrefs) => ModelPrefs | Promise<ModelPrefs>) {
  return enqueue(async () => {
    const value = await loadModelPrefsFresh()
    const next = await mutator(value)
    const safe = {
      recent: entries(next.recent),
      favorite: entries(next.favorite),
    }
    await scopedStateSetJSON("global", key, safe)
    cachedPrefsPromise = Promise.resolve(safe)
    return safe
  })
}

export async function addRecentModel(item: ModelEntry, max = 10) {
  return updateModelPrefs((value) => {
    const recent = [item, ...value.recent.filter((v) => v.providerID !== item.providerID || v.modelID !== item.modelID)]
    if (recent.length > max) recent.length = max
    return {
      recent,
      favorite: value.favorite,
    }
  })
}
