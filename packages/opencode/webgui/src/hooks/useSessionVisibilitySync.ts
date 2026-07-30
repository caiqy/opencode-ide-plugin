import { useEffect, useRef } from "react"
import { sdk } from "../lib/api/sdkClient"
import { eventEmitter } from "../lib/api/events"
import { useSession } from "../state/SessionContext"
import { useTabStore } from "../state/tabStore"

const retryDelay = 1000

function visibleSessionIDs(
  openTabs: string[],
  currentSessionID: string | null | undefined,
  foregroundSessions: Set<string>,
) {
  const ids = currentSessionID ? [...openTabs, currentSessionID] : openTabs
  return Array.from(new Set(ids))
    .sort()
    .filter((sessionID) => !foregroundSessions.has(sessionID))
}

export function useSessionVisibilitySync() {
  const { currentSession, foregroundSessions } = useSession()
  const { openTabs } = useTabStore()
  const synced = useRef<string | undefined>(undefined)
  const blocked = useRef<string | undefined>(undefined)
  const attempts = useRef({ key: "", count: 0 })
  const inFlight = useRef<string | undefined>(undefined)
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null)
  const epoch = useRef(0)
  const disposed = useRef(false)
  const latest = useRef({ key: "[]", sessionIDs: [] as string[] })
  const flush = useRef<() => void>(() => {})
  const sessionIDs = visibleSessionIDs(openTabs, currentSession?.id, foregroundSessions)
  const key = JSON.stringify(sessionIDs)

  latest.current = { key, sessionIDs }

  flush.current = () => {
    if (disposed.current) return

    const next = latest.current
    const token = `${epoch.current}:${next.key}`
    if (inFlight.current?.startsWith(`${epoch.current}:`) || synced.current === token || blocked.current === token) return
    if (attempts.current.key !== token) attempts.current = { key: token, count: 0 }
    if (attempts.current.count === 3) return
    if (retry.current) {
      clearTimeout(retry.current)
      retry.current = null
    }

    inFlight.current = token
    attempts.current.count += 1

    void sdk.session
      .syncVisible({ body: { sessionIDs: next.sessionIDs } })
      .then((response) => {
        if (token !== `${epoch.current}:${next.key}`) return { ok: false, status: undefined, stale: true }
        if (disposed.current || response.error) return { ok: false, status: response.error?.status, stale: false }
        synced.current = token
        return { ok: true, status: undefined, stale: false }
      })
      .catch((error) => {
        if (!disposed.current) {
          console.error("[useSessionVisibilitySync] Failed to sync visible sessions:", error)
        }
        return { ok: false, status: undefined, stale: false }
      })
      .then(({ ok, status, stale }) => {
        if (disposed.current) return
        if (inFlight.current === token) inFlight.current = undefined
        if (stale) return

        const current = latest.current
        const currentToken = `${epoch.current}:${current.key}`
        if (currentToken !== token) {
          flush.current()
          return
        }

        if (ok || synced.current === currentToken || retry.current) return
        if (status && status < 500) {
          blocked.current = currentToken
          return
        }

        retry.current = setTimeout(() => {
          retry.current = null
          flush.current()
        }, retryDelay)
      })
  }

  useEffect(() => {
    if (blocked.current !== `${epoch.current}:${key}`) blocked.current = undefined
    flush.current()
  }, [key])

  useEffect(() => {
    return eventEmitter.on("server.connected", () => {
      epoch.current++
      synced.current = undefined
      blocked.current = undefined
      attempts.current = { key: "", count: 0 }
      if (retry.current) {
        clearTimeout(retry.current)
        retry.current = null
      }
      flush.current()
    })
  }, [])

  useEffect(() => {
    return () => {
      disposed.current = true
      if (retry.current) {
        clearTimeout(retry.current)
        retry.current = null
      }
    }
  }, [])
}
