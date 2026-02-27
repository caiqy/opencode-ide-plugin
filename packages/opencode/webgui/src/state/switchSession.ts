export async function switchSessionWithTabRollback(input: {
  sessionId: string
  previousSessionId: string | null
  previousActiveTab: string
  existed: boolean
  open: (id: string) => void
  activate: (id: string) => void
  canActivate?: (id: string) => boolean
  onUnrecoverable?: () => void
  remove: (id: string) => void
  switchTo: (id: string) => Promise<void>
}) {
  if (input.existed) {
    input.activate(input.sessionId)
  } else {
    input.open(input.sessionId)
  }
  try {
    await input.switchTo(input.sessionId)
    return true
  } catch {
    if (!input.existed) {
      input.remove(input.sessionId)
    }
    const list = [input.previousSessionId, input.previousActiveTab].filter(
      (id): id is string => !!id && id !== input.sessionId,
    )
    const seen = new Set<string>()
    let recovered = false
    for (const id of list) {
      if (seen.has(id)) continue
      seen.add(id)
      if (input.canActivate && !input.canActivate(id)) continue
      input.activate(id)
      recovered = true
      break
    }
    if (!recovered) {
      input.onUnrecoverable?.()
    }
    return false
  }
}
