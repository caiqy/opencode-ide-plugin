import type { SessionID } from "./schema"

type SessionState = {
  closed: boolean
}

type State<T extends SessionState> = {
  foregroundCount: number
  sessions: Map<SessionID, T>
}

export function applyForegroundStart<T extends SessionState>(state: State<T>, sessionID: SessionID) {
  state.foregroundCount += 1
  const current = state.sessions.get(sessionID)
  if (current) current.closed = false
}

export function applyForegroundFinish<T extends SessionState>(state: State<T>, sessionID: SessionID) {
  state.foregroundCount = Math.max(0, state.foregroundCount - 1)
  const current = state.sessions.get(sessionID)
  if (current) current.closed = true
  return state.foregroundCount === 0
}
