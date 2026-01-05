import { createContext, useContext, useState, useCallback, type ReactNode } from "react"
import { useEventHandler, type EventEmitter, type ServerEvent } from "../lib/api/events"
import type { Message, Part, SDKMessage } from "../types/messages"
// PermissionRequest type based on new permission system (permission.asked event)
interface PermissionRequest {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata: Record<string, unknown>
  always: string[]
  tool?: {
    messageID: string
    callID: string
  }
}
import * as Store from "../lib/messagesStore"
import { sdk } from "../lib/api/sdkClient"
import { useSession } from "./SessionContext"
import { reloadPath } from "../lib/ideBridge"

// Re-export types for convenience
export type { Message, Part, SDKMessage } from "../types/messages"

interface MessagesContextValue {
  messages: Message[]
  addMessage: (message: Message) => void
  updateMessage: (messageID: string, update: Partial<Message>) => void
  removeMessage: (messageID: string) => void
  addPart: (messageID: string, part: Part) => void
  updatePart: (messageID: string, partID: string, update: Partial<Part>) => void
  removePart: (messageID: string, partID: string) => void
  clearMessages: () => void
  getMessagesBySession: (sessionID: string) => Message[]
  loadSessionMessages: (sessionID: string) => Promise<void>
  setMessages: (messages: Message[]) => void
  // permissions
  permissions: PermissionRequest[]
  getPermissionForCall: (sessionID: string, callID?: string | null) => PermissionRequest | undefined
  respondPermission: (
    requestID: string,
    reply: "once" | "always" | "reject",
  ) => Promise<boolean>
}

const MessagesContext = createContext<MessagesContextValue | undefined>(undefined)

interface MessagesProviderProps {
  children: ReactNode
  emitter?: EventEmitter | null | undefined
}

export function MessagesProvider({ children, emitter }: MessagesProviderProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [permissions, setPermissions] = useState<PermissionRequest[]>([])
  const session = useSession()
  const setReasoning = session.setReasoning

  // Add or update a message
  const addMessage = useCallback((message: Message) => {
    setMessages((prev) => Store.upsertMessage(prev, message))
  }, [])

  // Update a message
  const updateMessage = useCallback((messageID: string, update: Partial<Message>) => {
    setMessages((prev) => Store.updateMessage(prev, messageID, update))
  }, [])

  // Remove a message
  const removeMessage = useCallback((messageID: string) => {
    setMessages((prev) => Store.removeMessage(prev, messageID))
  }, [])

  // Add a part to a message
  const addPart = useCallback((messageID: string, part: Part) => {
    setMessages((prev) => Store.upsertPart(prev, messageID, part))
  }, [])

  // Update a specific part in a message
  const updatePart = useCallback((messageID: string, partID: string, update: Partial<Part>) => {
    setMessages((prev) => Store.updatePart(prev, messageID, partID, update))
  }, [])

  // Remove a part from a message
  const removePart = useCallback((messageID: string, partID: string) => {
    setMessages((prev) => Store.removePart(prev, messageID, partID))
  }, [])

  // Clear all messages
  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  // Get messages for a specific session
  const getMessagesBySession = useCallback(
    (sessionID: string) => Store.getMessagesBySession(messages, sessionID),
    [messages],
  )

  // Listen to message.updated events (also handles message creation)
  const handleMessageUpdated = useCallback((event: ServerEvent) => {
    if (event.type === "message.updated") {
      const { info } = event.properties as { info: SDKMessage }
      console.log("[MessagesContext] Message updated:", info.id, info.role)
      // updateMessageInfo creates the message if it doesn't exist
      setMessages((prev) => Store.updateMessageInfo(prev, info.id, info))
    }
  }, [])

  // Listen to message.part.updated events
  const handlePartUpdated = useCallback(
    (event: ServerEvent) => {
      if (event.type === "message.part.updated") {
        const { part, delta } = event.properties as { part: Part; delta?: string }
        console.log(
          "[MessagesContext] Part updated:",
          part.id,
          part.type,
          delta ? `(delta: ${delta.length} chars)` : "",
        )

        if (delta && part.type === "text") {
          // Apply delta for streaming text
          setMessages((prev) => Store.applyPartDelta(prev, part.messageID, part, delta))
        } else {
          // No delta, just upsert the part normally
          addPart(part.messageID, part)
        }

        // Reload file in IDE when write/edit tool completes
        if (part.type === "tool") {
          const toolPart = part as { tool?: string; state?: { status?: string; input?: { filePath?: string } } }
          if (
            (toolPart.tool === "write" || toolPart.tool === "edit") &&
            toolPart.state?.status === "completed" &&
            toolPart.state?.input?.filePath
          ) {
            reloadPath(toolPart.state.input.filePath, toolPart.tool)
          }
        }

        if (part.type === "reasoning") {
          //const time = (part as { time?: { end?: number } }).time
          //const end = typeof time?.end === 'number'
          setReasoning(part.sessionID, true)
        } else {
          setReasoning(part.sessionID, false)
        }
      }
    },
    [addPart, setReasoning],
  )

  // Listen to message.removed events
  const handleMessageRemoved = useCallback(
    (event: ServerEvent) => {
      if (event.type === "message.removed") {
        const { sessionID, messageID } = event.properties as { sessionID: string; messageID: string }
        console.log("[MessagesContext] Message removed:", messageID)
        removeMessage(messageID)
        setReasoning(sessionID, false)
      }
    },
    [removeMessage, setReasoning],
  )

  // Listen to message.part.removed events
  const handlePartRemoved = useCallback(
    (event: ServerEvent) => {
      if (event.type === "message.part.removed") {
        const { sessionID, messageID, partID } = event.properties as {
          sessionID: string
          messageID: string
          partID: string
        }
        console.log("[MessagesContext] Part removed:", partID)
        removePart(messageID, partID)
        setReasoning(sessionID, false)
      }
    },
    [removePart, setReasoning],
  )

  // Load messages for a session
  const loadSessionMessages = useCallback(async (sessionID: string) => {
    // Skip loading for virtual sessions (not yet persisted to server)
    if (sessionID.startsWith("virtual-")) {
      console.log("[MessagesContext] Skipping load for virtual session:", sessionID)
      return
    }

    console.log("[MessagesContext] Loading messages for session:", sessionID)

    try {
      const response = await sdk.session.messages({ path: { id: sessionID } })

      if (response.error) {
        console.error("[MessagesContext] Failed to load messages:", response.error)
        return
      }

      if (response.data) {
        console.log("[MessagesContext] Messages loaded:", response.data.length)
        // SDK response is already in the correct format: Array<{ info: Message, parts: Array<Part> }>
        const loadedMessages: Message[] = response.data

        console.log("[MessagesContext] Loaded messages sample:", loadedMessages[0])

        // Replace messages for this session only if we received any; otherwise keep existing local state
        setMessages((prev) => {
          if (!loadedMessages || loadedMessages.length === 0) return prev
          const filtered = prev.filter((msg) => msg.info.sessionID !== sessionID)
          return [...filtered, ...loadedMessages]
        })

        try {
          const { currentSession, setIsIdle } = session
          if (currentSession?.id === sessionID) {
            const last = [...loadedMessages].sort((a, b) => a.info.time.created - b.info.time.created).at(-1)
            if (last) {
              const completed = (last.info as any)?.time?.completed
              const isAssistant = (last.info as any)?.role === "assistant"
              const busy = isAssistant && (!completed || completed === 0)
              setIsIdle(!busy)
            }
          }
        } catch (e) {}
      }
    } catch (err) {
      console.error("[MessagesContext] Failed to load messages:", err)
    }
  }, [])

  // Permission events
  const handlePermissionAsked = useCallback((event: ServerEvent) => {
    if (event.type !== "permission.asked") return
    const perm = event.properties as PermissionRequest
    setPermissions((prev) => {
      const exists = prev.some((p) => p.id === perm.id)
      if (exists) return prev.map((p) => (p.id === perm.id ? perm : p))
      return [...prev, perm]
    })
  }, [])

  const handlePermissionReplied = useCallback((event: ServerEvent) => {
    if (event.type !== "permission.replied") return
    const { requestID } = event.properties as { sessionID: string; requestID: string; reply: string }
    setPermissions((prev) => prev.filter((p) => p.id !== requestID))
  }, [])

  const getPermissionForCall = useCallback(
    (sessionID: string, callID?: string | null) => {
      if (!sessionID || !callID) return undefined
      // Match by session + tool.callID (new structure)
      return permissions.find((p) => p.sessionID === sessionID && p.tool?.callID === callID)
    },
    [permissions],
  )

  const respondPermission = useCallback(
    async (requestID: string, reply: "once" | "always" | "reject") => {
      try {
        const result = await sdk.permissions.respond({
          path: { requestID },
          body: { reply },
        })
        const ok = Boolean(result && "data" in result && result.data === true)
        if (ok) setPermissions((prev) => prev.filter((p) => p.id !== requestID))
        return ok
      } catch (e) {
        return false
      }
    },
    [],
  )

  // Subscribe to events if emitter is provided
  useEventHandler(emitter ?? null, "message.updated", handleMessageUpdated)
  useEventHandler(emitter ?? null, "message.part.updated", handlePartUpdated)
  useEventHandler(emitter ?? null, "message.removed", handleMessageRemoved)
  useEventHandler(emitter ?? null, "message.part.removed", handlePartRemoved)
  useEventHandler(emitter ?? null, "permission.asked", handlePermissionAsked)
  useEventHandler(emitter ?? null, "permission.replied", handlePermissionReplied)

  const value: MessagesContextValue = {
    messages,
    addMessage,
    updateMessage,
    removeMessage,
    addPart,
    updatePart,
    removePart,
    clearMessages,
    getMessagesBySession,
    loadSessionMessages,
    setMessages,
    permissions,
    getPermissionForCall,
    respondPermission,
  }

  return <MessagesContext.Provider value={value}>{children}</MessagesContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMessages() {
  const context = useContext(MessagesContext)
  if (context === undefined) {
    throw new Error("useMessages must be used within a MessagesProvider")
  }
  return context
}
