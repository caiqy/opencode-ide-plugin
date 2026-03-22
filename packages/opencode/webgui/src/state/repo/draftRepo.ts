import { scopedStateGetJSON, scopedStateSetJSON } from "../scopedStorage"

const draftsKey = "opencode:webgui:workspace:drafts:v1"
const draftSessionKey = "opencode:webgui:workspace:draft_session:v1"
let cache: Record<string, string> | null = null
let dirty = false

function map(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {} as Record<string, string>
  return Object.fromEntries(
    Object.entries(input).flatMap(([k, v]) => {
      if (typeof v !== "string") return []
      return [[k, v]]
    }),
  )
}

function same(a: Record<string, string>, b: Record<string, string>) {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  return ak.every((key) => a[key] === b[key])
}

export function resetDraftRepoForTest() {
  cache = null
  dirty = false
}

export async function loadDrafts() {
  const next = map(await scopedStateGetJSON<unknown>("workspace", draftsKey, {}))
  if (!dirty) {
    cache = next
    return next
  }
  if (!cache) {
    cache = next
    dirty = false
    return next
  }
  if (same(cache, next)) {
    dirty = false
    return next
  }
  return cache
}

export async function saveDrafts(value: Record<string, string>) {
  const next = map(value)
  cache = next
  dirty = true
  return scopedStateSetJSON("workspace", draftsKey, next)
}

export async function loadDraftSession() {
  const value = await scopedStateGetJSON<unknown>("workspace", draftSessionKey, null)
  if (typeof value === "string") return value
  return null
}

export async function saveDraftSession(value: string | null) {
  return scopedStateSetJSON("workspace", draftSessionKey, value)
}

export async function cleanupDeletedSessionDraft(session_id: string) {
  const drafts = await loadDrafts()
  if (session_id in drafts) {
    const next = { ...drafts }
    delete next[session_id]
    await saveDrafts(next)
  }

  const draftSession = await loadDraftSession()
  if (draftSession !== session_id) return
  await saveDraftSession(null)
}
