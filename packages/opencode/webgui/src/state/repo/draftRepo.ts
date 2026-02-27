import { scopedStateGetJSON, scopedStateSetJSON } from "../scopedStorage"

const draftsKey = "opencode:webgui:workspace:drafts:v1"
const draftSessionKey = "opencode:webgui:workspace:draft_session:v1"

function map(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {} as Record<string, string>
  return Object.fromEntries(
    Object.entries(input).flatMap(([k, v]) => {
      if (typeof v !== "string") return []
      return [[k, v]]
    }),
  )
}

export async function loadDrafts() {
  const value = await scopedStateGetJSON<unknown>("workspace", draftsKey, {})
  return map(value)
}

export async function saveDrafts(value: Record<string, string>) {
  return scopedStateSetJSON("workspace", draftsKey, map(value))
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
