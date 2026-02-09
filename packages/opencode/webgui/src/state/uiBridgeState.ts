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

const INPUT_SEND_DEBOUNCE_MS = 300

type UiBridgeTimer = ReturnType<typeof setTimeout>

const store = {
  state: empty,
  json: JSON.stringify(empty),
  listeners: new Set<(s: UiBridgeState) => void>(),
  enabled: false,
  inputSendTimer: null as UiBridgeTimer | null,
  pendingInputSend: null as UiBridgeState | null,
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

function clearPendingInputSend() {
  if (store.inputSendTimer) {
    clearTimeout(store.inputSendTimer)
    store.inputSendTimer = null
  }
  store.pendingInputSend = null
}

function flushPendingInputSend() {
  const pending = store.pendingInputSend
  if (!pending) return
  clearPendingInputSend()
  send(pending)
}

function hasNonInputChange(prev: UiBridgeState, next: UiBridgeState) {
  return (
    prev.sessionID !== next.sessionID ||
    prev.providerId !== next.providerId ||
    prev.modelId !== next.modelId ||
    prev.agent !== next.agent ||
    prev.variant !== next.variant
  )
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

  clearPendingInputSend()
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
  clearPendingInputSend()
  send(store.state)
}

export function uiBridgeFlush() {
  flushPendingInputSend()
}

export function uiBridgeUpdate(patch: Partial<Omit<UiBridgeState, "v">>): UiBridgeState {
  const prev = store.state
  const next: UiBridgeState = {
    ...prev,
    sessionID: sanitizeSession(
      typeof patch.sessionID === "string" ? patch.sessionID : patch.sessionID === null ? null : prev.sessionID,
    ),
    providerId: typeof patch.providerId === "string" ? patch.providerId : patch.providerId === null ? null : prev.providerId,
    modelId: typeof patch.modelId === "string" ? patch.modelId : patch.modelId === null ? null : prev.modelId,
    agent: typeof patch.agent === "string" ? patch.agent : patch.agent === null ? null : prev.agent,
    variant: typeof patch.variant === "string" ? patch.variant : patch.variant === null ? null : prev.variant,
    input: typeof patch.input === "string" ? patch.input : patch.input === null ? null : prev.input,
  }

  const json = encode(next)
  store.state = next
  if (json === store.json) return next
  store.json = json

  const nonInputChanged = hasNonInputChange(prev, next)
  if (nonInputChanged) {
    clearPendingInputSend()
    send(next)
  } else if (prev.input !== next.input) {
    if (store.inputSendTimer) {
      clearTimeout(store.inputSendTimer)
    }
    store.pendingInputSend = next
    store.inputSendTimer = setTimeout(() => {
      flushPendingInputSend()
    }, INPUT_SEND_DEBOUNCE_MS)
  } else {
    send(next)
  }

  emit(next)
  return next
}
