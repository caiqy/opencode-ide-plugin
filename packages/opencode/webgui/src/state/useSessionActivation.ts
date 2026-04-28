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
  const { currentSession, restoreSelections, resolveSelections } = useSession()
  const { ensureSession, scanOlder, getSessionCursor, getMessagesBySession } = useMessages()
  const lastActivatedSessionIDRef = useRef<string | null>(null)
  const activationTokenRef = useRef(0)
  const ensureRef = useRef(ensureSession)
  const scanRef = useRef(scanOlder)
  const cursorRef = useRef(getSessionCursor)
  const getRef = useRef(getMessagesBySession)
  const restoreRef = useRef(restoreSelections)
  const resolveRef = useRef(resolveSelections)
  const revertRef = useRef(currentSession?.revert ?? null)

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
    revertRef.current = currentSession?.revert ?? null
  }, [currentSession?.revert])

  const activate = useCallback(async (sessionID?: string | null) => {
    if (!sessionID) return

    const token = ++activationTokenRef.current
    const loadedMessages = await ensureRef.current(sessionID)
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
      const older = await scanRef.current(sessionID, cursor)
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
  }, [])

  useEffect(() => {
    const sessionID = currentSession?.id ?? null
    if (!sessionID) {
      lastActivatedSessionIDRef.current = null
      activationTokenRef.current += 1
      return
    }
    if (lastActivatedSessionIDRef.current === sessionID) return

    lastActivatedSessionIDRef.current = sessionID

    void activate(sessionID)

    return () => {
      activationTokenRef.current += 1
    }
  }, [activate, currentSession?.id])

  return activate
}
