import type { Session } from "@opencode-ai/sdk/client"

export const SESSION_LIST_LIMIT = 30
export const SESSION_LIST_PAGE_SIZE = 30
export const MESSAGE_PAGE_SIZE = 100
export const MESSAGE_TOP_UNLOAD_THRESHOLD = 200
export const MESSAGE_TOP_SENTINEL_THRESHOLD = 80
export const MESSAGE_TOP_MEASURE_FALLBACK = 96

const pinnedMetadataKey = "opencode.session.pinned"

export function isSessionPinned(session: Session) {
  return (session as Session & { metadata?: Record<string, unknown> }).metadata?.[pinnedMetadataKey] === true
}

export function withSessionPinned(session: Session, pinned: boolean) {
  const metadata = { ...(session as Session & { metadata?: Record<string, unknown> }).metadata }
  if (pinned) metadata[pinnedMetadataKey] = true
  else delete metadata[pinnedMetadataKey]
  return { ...session, metadata: Object.keys(metadata).length > 0 ? metadata : undefined }
}

export function compareSessionList(a: Session, b: Session) {
  const pinned = Number(isSessionPinned(b)) - Number(isSessionPinned(a))
  if (pinned !== 0) return pinned
  if (a.time.updated !== b.time.updated) return b.time.updated - a.time.updated
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}
