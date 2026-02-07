import { ideBridge } from "../lib/ideBridge"

export type UiBridgeState = {
  v: 1
  sessionID: string | null
  providerId: string | null
  modelId: string | null
  agent: string | null
  variant: string | null
  input: string | null
}

const empty: UiBridgeState = {
  v: 1,
  sessionID: null,
  providerId: null,
  modelId: null,
  agent: null,
  variant: null,
  input: null,
}

const store = {
  state: empty,
  json: JSON.stringify(empty),
  listeners: new Set<(s: UiBridgeState) => void>(),
  enabled: false,
}

function emit(next: UiBridgeState) {
  store.listeners.forEach((fn) => {
    try {
      fn(next)
    } catch {}
  })
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

export function uiBridgeState(): UiBridgeState {
  return store.state
}

export function uiBridgeHydrate(raw: unknown): UiBridgeState {
  const obj = raw && typeof raw === "object" ? (raw as any) : null

  const next: UiBridgeState = {
    v: 1,
    sessionID: sanitizeSession(
      typeof obj?.sessionID === "string"
        ? obj.sessionID
        : typeof obj?.sessionId === "string"
          ? obj.sessionId
          : null,
    ),
    providerId: typeof obj?.providerId === "string" ? obj.providerId : typeof obj?.providerID === "string" ? obj.providerID : null,
    modelId: typeof obj?.modelId === "string" ? obj.modelId : typeof obj?.modelID === "string" ? obj.modelID : null,
    agent: typeof obj?.agent === "string" ? obj.agent : null,
    variant: typeof obj?.variant === "string" ? obj.variant : null,
    input: typeof obj?.input === "string" ? obj.input : null,
  }

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

export function uiBridgeEnable() {
  if (store.enabled) return
  store.enabled = true
  send(store.state)
}

export function uiBridgeUpdate(patch: Partial<Omit<UiBridgeState, "v">>): UiBridgeState {
  const next: UiBridgeState = {
    ...store.state,
    sessionID: sanitizeSession(
      typeof patch.sessionID === "string" ? patch.sessionID : patch.sessionID === null ? null : store.state.sessionID,
    ),
    providerId: typeof patch.providerId === "string" ? patch.providerId : patch.providerId === null ? null : store.state.providerId,
    modelId: typeof patch.modelId === "string" ? patch.modelId : patch.modelId === null ? null : store.state.modelId,
    agent: typeof patch.agent === "string" ? patch.agent : patch.agent === null ? null : store.state.agent,
    variant: typeof patch.variant === "string" ? patch.variant : patch.variant === null ? null : store.state.variant,
    input: typeof patch.input === "string" ? patch.input : patch.input === null ? null : store.state.input,
  }

  const json = encode(next)
  store.state = next
  if (json === store.json) return next
  store.json = json
  send(next)
  emit(next)
  return next
}
