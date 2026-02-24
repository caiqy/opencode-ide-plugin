import { ideBridge } from "../lib/ideBridge"

export type UiBridgeState = {
  v: 2
  sessionID: string | null
  providerId: string | null
  modelId: string | null
  agent: string | null
  variant: string | null
  drafts: Record<string, string>
}

const empty: UiBridgeState = {
  v: 2,
  sessionID: null,
  providerId: null,
  modelId: null,
  agent: null,
  variant: null,
  drafts: {},
}

const DRAFT_SEND_DEBOUNCE_MS = 300
// Reserved key for migrating v1 input before a concrete sessionID is available.
const LEGACY_DRAFT_KEY = "__legacy__"

type UiBridgeTimer = ReturnType<typeof setTimeout>

const store = {
  state: empty,
  json: JSON.stringify(empty),
  listeners: new Set<(s: UiBridgeState) => void>(),
  enabled: false,
  draftSendTimer: null as UiBridgeTimer | null,
  pendingDraftSend: null as UiBridgeState | null,
}

function emit(next: UiBridgeState) {
  store.listeners.forEach((fn) => {
    try {
      fn(next)
    } catch {}
  })
}

function omitDraft(drafts: Record<string, string>, id: string) {
  if (!drafts[id]) return drafts
  const next = { ...drafts }
  delete next[id]
  return next
}

function patchDraft(drafts: Record<string, string>, id: string, value: string) {
  const text = value.length > 0 ? value : ""
  if (!text) return omitDraft(drafts, id)
  if (drafts[id] === text) return drafts
  return { ...drafts, [id]: text }
}

function parseDrafts(input: unknown) {
  if (!input || typeof input !== "object") return {}
  return Object.entries(input as Record<string, unknown>).reduce(
    (acc, [id, value]) => {
      if (!id || typeof value !== "string") return acc
      const text = value
      if (!text) return acc
      acc[id] = text
      return acc
    },
    {} as Record<string, string>,
  )
}

function sanitizeSession(sessionID: string | null): string | null {
  if (!sessionID) return null
  if (sessionID.startsWith("virtual-")) return null
  return sessionID
}

function encode(next: UiBridgeState) {
  return JSON.stringify(next)
}

function send(next: UiBridgeState) {
  if (!store.enabled) return
  if (!ideBridge.isInstalled()) return
  void ideBridge.setState(next)
}

function clearPendingDraftSend() {
  if (store.draftSendTimer) {
    clearTimeout(store.draftSendTimer)
    store.draftSendTimer = null
  }
  store.pendingDraftSend = null
}

function flushPendingDraftSend() {
  const pending = store.pendingDraftSend
  if (!pending) return
  clearPendingDraftSend()
  send(pending)
}

function hasNonDraftChange(prev: UiBridgeState, next: UiBridgeState) {
  return (
    prev.sessionID !== next.sessionID ||
    prev.providerId !== next.providerId ||
    prev.modelId !== next.modelId ||
    prev.agent !== next.agent ||
    prev.variant !== next.variant
  )
}

function hasDraftChange(prev: UiBridgeState, next: UiBridgeState) {
  if (prev.drafts === next.drafts) return false
  const prevKeys = Object.keys(prev.drafts)
  const nextKeys = Object.keys(next.drafts)
  if (prevKeys.length !== nextKeys.length) return true
  return prevKeys.some((key) => prev.drafts[key] !== next.drafts[key])
}

function migrateLegacyDraft(drafts: Record<string, string>, sessionID: string | null) {
  const legacy = drafts[LEGACY_DRAFT_KEY]
  if (!legacy || !sessionID) return drafts
  const next = omitDraft(drafts, LEGACY_DRAFT_KEY)
  if (next[sessionID]) return next
  return { ...next, [sessionID]: legacy }
}

function draftFromState(state: UiBridgeState, sessionID: string | null) {
  if (!sessionID) return state.drafts[LEGACY_DRAFT_KEY] ?? ""
  return state.drafts[sessionID] ?? state.drafts[LEGACY_DRAFT_KEY] ?? ""
}

export function uiBridgeState(): UiBridgeState {
  return store.state
}

export function uiBridgeHydrate(raw: unknown): UiBridgeState {
  const obj = raw && typeof raw === "object" ? (raw as any) : null

  const sessionID = sanitizeSession(
    typeof obj?.sessionID === "string" ? obj.sessionID : typeof obj?.sessionId === "string" ? obj.sessionId : null,
  )
  const drafts = parseDrafts(obj?.drafts)
  const legacyInput = typeof obj?.input === "string" ? obj.input : ""
  const nextDrafts = (() => {
    if (!legacyInput) return drafts
    if (sessionID && !drafts[sessionID]) return { ...drafts, [sessionID]: legacyInput }
    if (!sessionID && !drafts[LEGACY_DRAFT_KEY]) return { ...drafts, [LEGACY_DRAFT_KEY]: legacyInput }
    return drafts
  })()

  const next: UiBridgeState = {
    v: 2,
    sessionID,
    providerId:
      typeof obj?.providerId === "string"
        ? obj.providerId
        : typeof obj?.providerID === "string"
          ? obj.providerID
          : null,
    modelId: typeof obj?.modelId === "string" ? obj.modelId : typeof obj?.modelID === "string" ? obj.modelID : null,
    agent: typeof obj?.agent === "string" ? obj.agent : null,
    variant: typeof obj?.variant === "string" ? obj.variant : null,
    drafts: nextDrafts,
  }

  clearPendingDraftSend()
  store.state = next
  store.json = encode(next)
  emit(next)
  return next
}

export function uiBridgeSubscribe(fn: (s: UiBridgeState) => void) {
  store.listeners.add(fn)
  try {
    fn(store.state)
  } catch {}
  return () => {
    store.listeners.delete(fn)
  }
}

export function uiBridgeSubscribeSelector<T>(
  selector: (s: UiBridgeState) => T,
  onChange: (next: T) => void,
  isEqual: (a: T, b: T) => boolean = Object.is,
) {
  let current = selector(store.state)

  const listener = (nextState: UiBridgeState) => {
    const next = selector(nextState)
    if (isEqual(current, next)) return
    current = next
    onChange(next)
  }

  store.listeners.add(listener)
  try {
    onChange(current)
  } catch {}

  return () => {
    store.listeners.delete(listener)
  }
}

export function uiBridgeEnable() {
  if (store.enabled) return
  store.enabled = true
  clearPendingDraftSend()
  send(store.state)
}

export function uiBridgeFlush() {
  flushPendingDraftSend()
}

export function uiBridgeUpdate(patch: Partial<Omit<UiBridgeState, "v">>): UiBridgeState {
  const prev = store.state
  const nextSessionID = sanitizeSession(
    typeof patch.sessionID === "string" ? patch.sessionID : patch.sessionID === null ? null : prev.sessionID,
  )
  const parsedDrafts = patch.drafts ? parseDrafts(patch.drafts) : prev.drafts
  const nextDrafts = migrateLegacyDraft(parsedDrafts, nextSessionID)
  const next: UiBridgeState = {
    ...prev,
    sessionID: nextSessionID,
    providerId:
      typeof patch.providerId === "string" ? patch.providerId : patch.providerId === null ? null : prev.providerId,
    modelId: typeof patch.modelId === "string" ? patch.modelId : patch.modelId === null ? null : prev.modelId,
    agent: typeof patch.agent === "string" ? patch.agent : patch.agent === null ? null : prev.agent,
    variant: typeof patch.variant === "string" ? patch.variant : patch.variant === null ? null : prev.variant,
    drafts: nextDrafts,
  }

  const json = encode(next)
  store.state = next
  if (json === store.json) return next
  store.json = json

  const nonDraftChanged = hasNonDraftChange(prev, next)
  if (nonDraftChanged) {
    clearPendingDraftSend()
    send(next)
  } else if (hasDraftChange(prev, next)) {
    if (store.draftSendTimer) {
      clearTimeout(store.draftSendTimer)
    }
    store.pendingDraftSend = next
    store.draftSendTimer = setTimeout(() => {
      flushPendingDraftSend()
    }, DRAFT_SEND_DEBOUNCE_MS)
  } else {
    send(next)
  }

  emit(next)
  return next
}

export function uiBridgeDraft(sessionID: string | null) {
  return draftFromState(store.state, sessionID)
}

export function uiBridgeSubscribeDraft(sessionID: string | null, fn: (value: string) => void) {
  return uiBridgeSubscribeSelector((state) => draftFromState(state, sessionID), fn)
}

export function uiBridgeUpdateDraft(sessionID: string | null, value: string) {
  if (!sessionID) return store.state
  const drafts = patchDraft(store.state.drafts, sessionID, value)
  if (drafts === store.state.drafts) return store.state
  return uiBridgeUpdate({ drafts })
}

export function uiBridgeMoveDraft(from: string, to: string) {
  if (!from || !to || from === to) return store.state
  const value = store.state.drafts[from]
  if (!value) return store.state
  const drafts = omitDraft(store.state.drafts, from)
  if (drafts[to]) return uiBridgeUpdate({ drafts })
  return uiBridgeUpdate({ drafts: { ...drafts, [to]: value } })
}
