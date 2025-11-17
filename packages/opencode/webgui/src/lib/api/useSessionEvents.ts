/**
 * Hook for subscribing to multiple session events
 * Consolidates session event subscriptions in a single pattern
 */

import { useEffect } from "react"
import type { EventEmitter, ServerEvent } from "./events"

export interface SessionEventHandlers {
  onSessionCreated?: (event: Extract<ServerEvent, { type: "session.created" }>) => void
  onSessionUpdated?: (event: Extract<ServerEvent, { type: "session.updated" }>) => void
  onSessionDeleted?: (event: Extract<ServerEvent, { type: "session.deleted" }>) => void
  onSessionError?: (event: Extract<ServerEvent, { type: "session.error" }>) => void
  onSessionIdle?: (event: Extract<ServerEvent, { type: "session.idle" }>) => void
  onSessionCompacted?: (event: Extract<ServerEvent, { type: "session.compacted" }>) => void
}

/**
 * Subscribe to multiple session events with a single hook
 */
export function useSessionEvents(emitter: EventEmitter | null, handlers: SessionEventHandlers) {
  useEffect(() => {
    if (!emitter) return

    const unsubscribers: Array<() => void> = []

    if (handlers.onSessionCreated) {
      unsubscribers.push(emitter.subscribe("session.created", handlers.onSessionCreated))
    }

    if (handlers.onSessionUpdated) {
      unsubscribers.push(emitter.subscribe("session.updated", handlers.onSessionUpdated))
    }

    if (handlers.onSessionDeleted) {
      unsubscribers.push(emitter.subscribe("session.deleted", handlers.onSessionDeleted))
    }

    if (handlers.onSessionError) {
      unsubscribers.push(emitter.subscribe("session.error", handlers.onSessionError))
    }

    if (handlers.onSessionIdle) {
      unsubscribers.push(emitter.subscribe("session.idle", handlers.onSessionIdle))
    }

    if (handlers.onSessionCompacted) {
      unsubscribers.push(emitter.subscribe("session.compacted", handlers.onSessionCompacted))
    }

    return () => {
      unsubscribers.forEach((unsub) => unsub())
    }
  }, [emitter, handlers])
}
