import { useCallback, useEffect, useRef, useState } from "react"
import {
  inputQueue,
  type InputDelivery,
  type InputQueueSnapshot,
  type QueuedSubmission,
} from "../../../lib/api/inputQueue"
import { eventEmitter } from "../../../lib/api/events"

export function useInputQueue(sessionID: string | null) {
  const [snapshot, setSnapshot] = useState<InputQueueSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string[]>([])
  const active = useRef(sessionID)
  active.current = sessionID
  const locks = useRef(new Set<string>())
  const apply = useCallback((value: InputQueueSnapshot) => {
    if (active.current !== value.sessionID) return
    setSnapshot((current) =>
      current?.sessionID === value.sessionID && current.revision > value.revision ? current : value,
    )
    setError(null)
  }, [])
  const refresh = useCallback(async () => {
    if (!sessionID) return
    const value = await inputQueue.list(sessionID).catch((error: unknown) => {
      if (active.current === sessionID) setError(error instanceof Error ? error.message : "加载待发送消息失败")
    })
    if (value) apply(value)
  }, [apply, sessionID])
  useEffect(() => {
    setSnapshot(null)
    setError(null)
    setPending([])
    const unsubscribe = eventEmitter.subscribe("session.input.changed", (event) => apply(event.properties))
    const reconnect = eventEmitter.on("server.connected", () => {
      void refresh()
    })
    void refresh()
    return () => {
      unsubscribe()
      reconnect()
    }
  }, [apply, refresh])

  const mutate = useCallback(
    async (id: string, request: () => Promise<InputQueueSnapshot>) => {
      const key = `${sessionID}:${id}`
      if (locks.current.has(key)) return false
      locks.current.add(key)
      setPending((current) => [...current, id])
      try {
        apply(await request())
        return true
      } catch (error) {
        await refresh()
        if (active.current === sessionID) setError(error instanceof Error ? error.message : "操作失败，请重试")
        return false
      } finally {
        locks.current.delete(key)
        if (active.current === sessionID) setPending((current) => current.filter((value) => value !== id))
      }
    },
    [apply, refresh, sessionID],
  )

  return {
    snapshot: snapshot?.sessionID === sessionID ? snapshot : null,
    error,
    pending,
    refresh,
    add: useCallback(
      (input: QueuedSubmission) =>
        sessionID ? mutate(input.id, () => inputQueue.add(sessionID, input)) : Promise.resolve(false),
      [mutate, sessionID],
    ),
    update: (id: string, delivery: InputDelivery) =>
      sessionID && mutate(id, () => inputQueue.update(sessionID, id, delivery)),
    remove: (id: string) => sessionID && mutate(id, () => inputQueue.remove(sessionID, id)),
    next: () => sessionID && mutate("next", () => inputQueue.next(sessionID)),
  }
}
