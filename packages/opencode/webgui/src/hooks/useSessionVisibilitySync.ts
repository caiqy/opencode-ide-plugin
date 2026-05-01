import { useEffect, useRef } from "react"
import { sdk } from "../lib/api/sdkClient"
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
  const inFlight = useRef<string | undefined>(undefined)
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null)
  const disposed = useRef(false)
  const latest = useRef({ key: "[]", sessionIDs: [] as string[] })
  const flush = useRef<() => void>(() => {})
  const sessionIDs = visibleSessionIDs(openTabs, currentSession?.id, foregroundSessions)
  const key = JSON.stringify(sessionIDs)

  latest.current = { key, sessionIDs }

  flush.current = () => {
    if (disposed.current) return

    const next = latest.current
    if (inFlight.current || synced.current === next.key) return
    if (retry.current) {
      clearTimeout(retry.current)
      retry.current = null
    }

    inFlight.current = next.key

    void sdk.session
      .syncVisible({ body: { sessionIDs: next.sessionIDs } })
      .then((response) => {
        if (disposed.current || response.error) return false
        synced.current = next.key
        return true
      })
      .catch((error) => {
        if (!disposed.current) {
          console.error("[useSessionVisibilitySync] Failed to sync visible sessions:", error)
        }
        return false
      })
      .then((ok) => {
        if (disposed.current) return
        if (inFlight.current === next.key) inFlight.current = undefined

        const current = latest.current
        if (current.key !== next.key) {
          flush.current()
          return
        }

        if (ok || synced.current === current.key || retry.current) return

        retry.current = setTimeout(() => {
          retry.current = null
          flush.current()
        }, retryDelay)
      })
  }

  useEffect(() => {
    flush.current()
  }, [key])

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
