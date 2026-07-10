import { useCallback, useEffect, useRef } from "react"
import { selectionFromMessages } from "../lib/selection/selectionFromMessages"
import type { Message } from "../types/messages"
import { useMessages } from "./MessagesContext"
import { useSession } from "./SessionContext"

function merge(rows: Message[], more: Message[]) {
  const map = new Map(rows.map((row) => [row.info.id, row]))
  for (const row of more) {
    map.set(row.info.id, row)
  }
  return [...map.values()].sort((a, b) => a.info.time.created - b.info.time.created)
}

export function useSessionActivation() {
  const { currentSession, restoreSelections, resolveSelections, beginForegroundSession, endForegroundSession } =
    useSession()
  const { ensureSession, scanOlder, getSessionCursor, getMessagesBySession } = useMessages()
  const lastActivationKeyRef = useRef<string | null>(null)
  const activationTokenRef = useRef(0)
  const ensureRef = useRef(ensureSession)
  const scanRef = useRef(scanOlder)
  const cursorRef = useRef(getSessionCursor)
  const getRef = useRef(getMessagesBySession)
  const restoreRef = useRef(restoreSelections)
  const resolveRef = useRef(resolveSelections)
  const beginForegroundRef = useRef(beginForegroundSession)
  const endForegroundRef = useRef(endForegroundSession)
  const pendingReleaseRef = useRef(new Set<() => void>())
  const revertRef = useRef(currentSession?.revert ?? null)
  const currentSessionIDRef = useRef<string | null>(currentSession?.id ?? null)

  currentSessionIDRef.current = currentSession?.id ?? null

  useEffect(() => {
    ensureRef.current = ensureSession
  }, [ensureSession])

  useEffect(() => {
    scanRef.current = scanOlder
  }, [scanOlder])

  useEffect(() => {
    cursorRef.current = getSessionCursor
  }, [getSessionCursor])

  useEffect(() => {
    getRef.current = getMessagesBySession
  }, [getMessagesBySession])

  useEffect(() => {
    restoreRef.current = restoreSelections
  }, [restoreSelections])

  useEffect(() => {
    resolveRef.current = resolveSelections
  }, [resolveSelections])

  useEffect(() => {
    beginForegroundRef.current = beginForegroundSession
  }, [beginForegroundSession])

  useEffect(() => {
    endForegroundRef.current = endForegroundSession
  }, [endForegroundSession])

  useEffect(() => {
    revertRef.current = currentSession?.revert ?? null
  }, [currentSession?.revert])

  const releasePendingForegroundSessions = useCallback(() => {
    for (const release of [...pendingReleaseRef.current]) {
      release()
    }
  }, [])

  useEffect(() => {
    return () => {
      releasePendingForegroundSessions()
    }
  }, [releasePendingForegroundSessions])

  const runActivation = useCallback(async (sessionID?: string | null, onRelease?: (release: () => void) => void) => {
    if (!sessionID) return

    const token = ++activationTokenRef.current
    const controller = new AbortController()
    let released = false
    let cancel = () => {}
    const release = () => {
      if (released) return
      released = true
      pendingReleaseRef.current.delete(cancel)
      endForegroundRef.current(sessionID)
    }
    cancel = () => {
      if (!controller.signal.aborted) {
        controller.abort()
      }
      release()
    }

    beginForegroundRef.current(sessionID)
    pendingReleaseRef.current.add(cancel)
    onRelease?.(cancel)

    try {
      const loadedMessages = await ensureRef.current(sessionID, controller.signal)
      if (token !== activationTokenRef.current) return
      if (!loadedMessages) {
        const cached = getRef.current(sessionID)
        const restored = selectionFromMessages(cached, revertRef.current)
        if (restored) {
          restoreRef.current(restored, sessionID)
          return
        }
        resolveRef.current(sessionID, "未能恢复该会话的设置，继续使用当前配置")
        return
      }

      let rows = merge(getRef.current(sessionID), loadedMessages)
      let restoredSelection = selectionFromMessages(rows, revertRef.current)
      let failed = false
      const max = 10
      const seen = new Set<string>()
      let cursor = cursorRef.current(sessionID)
      if (cursor) seen.add(cursor)

      for (let i = 0; !restoredSelection && cursor && i < max; i++) {
        const older = await scanRef.current(sessionID, cursor, controller.signal)
        if (token !== activationTokenRef.current) return
        if (!older) {
          failed = true
          break
        }

        rows = merge(rows, older.rows)
        restoredSelection = selectionFromMessages(rows, revertRef.current)

        const next = older.cursor
        if (!next) break
        if (seen.has(next)) break
        seen.add(next)
        cursor = next
      }

      if (!restoredSelection) {
        resolveRef.current(sessionID, failed ? "未能恢复该会话的设置，继续使用当前配置" : undefined)
        return
      }

      restoreRef.current(
        restoredSelection ?? {
          providerId: null,
          modelId: null,
          agent: null,
          variant: null,
        },
        sessionID,
      )
    } finally {
      release()
    }
  }, [])

  const activate = useCallback((sessionID?: string | null) => runActivation(sessionID), [runActivation])

  useEffect(() => {
    const sessionID = currentSession?.id ?? null
    const activationKey = sessionID
      ? `${sessionID}:${currentSession?.revert?.messageID ?? ""}:${currentSession?.revert?.partID ?? ""}`
      : null
    if (!activationKey) {
      lastActivationKeyRef.current = null
      activationTokenRef.current += 1
      return
    }
    if (lastActivationKeyRef.current === activationKey) return

    lastActivationKeyRef.current = activationKey

    let releaseForeground: (() => void) | null = null

    void runActivation(sessionID, (release) => {
      releaseForeground = release
    })

    return () => {
      activationTokenRef.current += 1
      if (currentSessionIDRef.current !== sessionID) {
        releaseForeground?.()
        releasePendingForegroundSessions()
      }
    }
  }, [
    currentSession?.id,
    currentSession?.revert?.messageID,
    currentSession?.revert?.partID,
    releasePendingForegroundSessions,
    runActivation,
  ])

  return activate
}
