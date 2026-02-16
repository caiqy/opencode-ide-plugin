import { useEffect, useRef } from "react"
import { selectionFromMessages } from "../lib/selection/selectionFromMessages"
import { useMessages } from "./MessagesContext"
import { useSession } from "./SessionContext"
import { uiBridgeUpdate } from "./uiBridgeState"

export function useSessionActivation() {
  const { currentSession, restoreSelections } = useSession()
  const { loadSessionMessages } = useMessages()
  const lastActivatedSessionIDRef = useRef<string | null>(null)
  const activationTokenRef = useRef(0)

  useEffect(() => {
    const sessionID = currentSession?.id ?? null
    if (!sessionID) {
      lastActivatedSessionIDRef.current = null
      activationTokenRef.current += 1
      return
    }
    if (lastActivatedSessionIDRef.current === sessionID) return

    lastActivatedSessionIDRef.current = sessionID
    uiBridgeUpdate({ sessionID })

    const token = ++activationTokenRef.current

    void (async () => {
      const loadedMessages = await loadSessionMessages(sessionID)
      if (token !== activationTokenRef.current) return
      if (!loadedMessages) return

      const restoredSelection = selectionFromMessages(loadedMessages)
      if (!restoredSelection) return

      restoreSelections(restoredSelection)
    })()

    return () => {
      activationTokenRef.current += 1
    }
  }, [currentSession?.id, loadSessionMessages, restoreSelections])
}
