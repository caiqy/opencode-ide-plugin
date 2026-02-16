import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react"
import { useEventHandler, type EventEmitter, type ServerEvent } from "../lib/api/events"
import {
  type Message,
  type Part,
  type WebguiPart,
  type SDKMessage,
  type QuestionRequest,
} from "../types/messages"
import type { QuestionAnswer } from "@opencode-ai/sdk/v2/client"
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
export type { Message, Part, WebguiPart, SDKMessage, QuestionRequest, QuestionRequestPart } from "../types/messages"

interface MessagesContextValue {
  messages: Message[]
  addMessage: (message: Message) => void
  addSessionError: (sessionID: string, error: unknown) => void
  updateMessage: (messageID: string, update: Partial<Message>) => void
  removeMessage: (messageID: string) => void
  addPart: (messageID: string, part: WebguiPart) => void
  updatePart: (messageID: string, partID: string, update: Partial<WebguiPart>) => void
  removePart: (messageID: string, partID: string) => void
  clearMessages: () => void
  getMessagesBySession: (sessionID: string) => Message[]
  loadSessionMessages: (sessionID: string) => Promise<Message[] | null>
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  removeSessionErrors: (sessionID: string, afterTimestamp?: number) => void
  // permissions
  permissions: PermissionRequest[]
  getPermissionForCall: (sessionID: string, callID?: string | null) => PermissionRequest | undefined
  respondPermission: (requestID: string, reply: "once" | "always" | "reject") => Promise<boolean>
  // questions
  questions: Map<string, QuestionRequest[]>
  getQuestionsBySession: (sessionID: string) => QuestionRequest[]
  getQuestionForCall: (sessionID: string, callID?: string | null) => QuestionRequest | undefined
  replyQuestion: (requestID: string, answers: QuestionAnswer[]) => Promise<boolean>
  rejectQuestion: (requestID: string) => Promise<boolean>
}

const MessagesContext = createContext<MessagesContextValue | undefined>(undefined)

interface MessagesProviderProps {
  children: ReactNode
  emitter?: EventEmitter | null | undefined
}

function sessionErrorText(error: unknown): string {
  if (!error) return "An error occurred in the session"
  if (typeof error === "string") return error
  if (typeof error !== "object") return "An error occurred in the session"

  const data = (error as { data?: { message?: unknown }; message?: unknown }).data
  const dataMessage = data && typeof data.message === "string" ? data.message : undefined
  if (dataMessage) return dataMessage

  const msg = (error as { message?: unknown }).message
  if (typeof msg === "string" && msg.length > 0) return msg

  return "An error occurred in the session"
}

function sessionErrorKey(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined

  const name = (error as { name?: unknown }).name
  const safeName = typeof name === "string" && name.length > 0 ? name : ""

  // Prefer data.message when present (MessageAbortedError etc.)
  const dataMessage = (error as { data?: { message?: unknown } })?.data?.message
  if (typeof dataMessage === "string" && dataMessage.length > 0) {
    return safeName ? `${safeName}:${dataMessage}` : `:${dataMessage}`
  }

  const msg = (error as { message?: unknown }).message
  if (typeof msg === "string" && msg.length > 0) {
    return safeName ? `${safeName}:${msg}` : `:${msg}`
  }

  return safeName.length > 0 ? `${safeName}:` : undefined
}

function infoSessionErrorKey(info: unknown): string | undefined {
  const error = (info as { error?: unknown })?.error
  return sessionErrorKey(error)
}

export function MessagesProvider({ children, emitter }: MessagesProviderProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [permissions, setPermissions] = useState<PermissionRequest[]>([])
  const [questions, setQuestions] = useState<Map<string, QuestionRequest[]>>(new Map())
  const session = useSession()
  const setReasoning = session.setReasoning
  const setSessionIdle = session.setSessionIdle
  const reasoningPartsBySessionRef = useRef<Map<string, Set<string>>>(new Map())

  const updateReasoningFromPart = useCallback(
    (part: Extract<Part, { type: "reasoning" }>) => {
      const sessionID = part.sessionID
      const current = new Set(reasoningPartsBySessionRef.current.get(sessionID) ?? [])
      const ended = typeof part.time?.end === "number"

      if (ended) {
        current.delete(part.id)
      } else {
        current.add(part.id)
      }

      if (current.size > 0) {
        reasoningPartsBySessionRef.current.set(sessionID, current)
      } else {
        reasoningPartsBySessionRef.current.delete(sessionID)
      }

      setReasoning(sessionID, current.size > 0)
    },
    [setReasoning],
  )

  const removeTrackedReasoningPart = useCallback(
    (sessionID: string, partID: string) => {
      const current = reasoningPartsBySessionRef.current.get(sessionID)
      if (!current || !current.has(partID)) return

      current.delete(partID)

      if (current.size > 0) {
        reasoningPartsBySessionRef.current.set(sessionID, current)
      } else {
        reasoningPartsBySessionRef.current.delete(sessionID)
      }

      setReasoning(sessionID, current.size > 0)
    },
    [setReasoning],
  )

  const syncSessionReasoningFromMessages = useCallback(
    (sessionID: string, sessionMessages: Message[]) => {
      const activeReasoningIDs = new Set<string>()
      for (const message of sessionMessages) {
        for (const part of message.parts) {
          if (part.type !== "reasoning") continue
          if (typeof part.time?.end === "number") continue
          activeReasoningIDs.add(part.id)
        }
      }

      if (activeReasoningIDs.size > 0) {
        reasoningPartsBySessionRef.current.set(sessionID, activeReasoningIDs)
      } else {
        reasoningPartsBySessionRef.current.delete(sessionID)
      }

      setReasoning(sessionID, activeReasoningIDs.size > 0)
    },
    [setReasoning],
  )

  // Add or update a message
  const addMessage = useCallback((message: Message) => {
    setMessages((prev) => Store.upsertMessage(prev, message))
  }, [])

  // Add an error message for a session (synthetic message)
  const addSessionError = useCallback((sessionID: string, error: unknown) => {
    const text = sessionErrorText(error)
    const key = sessionErrorKey(error)

    const errorID = `error-${Date.now()}`
    const errorMessage: Message = {
      info: {
        id: errorID,
        sessionID,
        role: "assistant",
        time: {
          created: Date.now(),
          updated: Date.now(),
        },
        syntheticErrorKey: key,
      } as unknown as SDKMessage,
      parts: [
        {
          id: `part-${errorID}`,
          type: "session-error",
          sessionID,
          messageID: errorID,
          message: text,
        } as WebguiPart,
      ],
    }

    setMessages((prev) => {
      const alreadyShownOnMessage =
        key &&
        prev.some((m) => {
          if (m.info.sessionID !== sessionID) return false
          if (m.info.role !== "assistant") return false
          return infoSessionErrorKey(m.info) === key
        })

      if (alreadyShownOnMessage) return prev

      const existingSynthetic =
        key &&
        prev.some((m) => {
          if (m.info.sessionID !== sessionID) return false
          if (!m.info.id.startsWith("error-")) return false
          return (m.info as any)?.syntheticErrorKey === key
        })

      if (existingSynthetic) return prev

      return Store.upsertMessage(prev, errorMessage)
    })
  }, [])

  // Remove session errors for a specific session, optionally after a certain timestamp
  const removeSessionErrors = useCallback((sessionID: string, afterTimestamp?: number) => {
    setMessages((prev) =>
      prev.filter(
        (m) =>
          !(
            m.info.sessionID === sessionID &&
            (m.info.id.startsWith("error-") || m.parts.some((p) => p.type === "session-error")) &&
            (!afterTimestamp || m.info.time.created > afterTimestamp)
          ),
      ),
    )
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
  const addPart = useCallback((messageID: string, part: WebguiPart) => {
    setMessages((prev) => Store.upsertPart(prev, messageID, part))
  }, [])

  // Update a specific part in a message
  const updatePart = useCallback((messageID: string, partID: string, update: Partial<WebguiPart>) => {
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

      const key = infoSessionErrorKey(info)

      // updateMessageInfoCleaningOptimistic removes optimistic placeholders
      // when a real user message arrives, then upserts the real message.
      setMessages((prev) => {
        const next = Store.updateMessageInfoCleaningOptimistic(prev, info.id, info)
        if (!key) return next

        // If we later receive a message-level error, remove any synthetic session error we created for it.
        return next.filter((m) => {
          if (m.info.sessionID !== info.sessionID) return true
          if (!m.info.id.startsWith("error-")) return true
          return (m.info as any)?.syntheticErrorKey !== key
        })
      })
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

        // Reload file in IDE when write/edit/apply_patch tool completes
        if (part.type === "tool") {
          const toolPart = part as { tool?: string; state?: { status?: string; input?: { filePath?: string } } }
          if (
            (toolPart.tool === "write" || toolPart.tool === "edit") &&
            toolPart.state?.status === "completed" &&
            toolPart.state?.input?.filePath
          ) {
            reloadPath(toolPart.state.input.filePath, toolPart.tool)
          }

          if (toolPart.tool === "apply_patch" && toolPart.state?.status === "completed") {
            const patched = (
              toolPart.state as unknown as {
                metadata?: { files?: Array<{ filePath?: string; movePath?: string }> }
              }
            )?.metadata?.files
            if (Array.isArray(patched)) {
              for (const entry of patched) {
                if (entry.filePath) reloadPath(entry.filePath, toolPart.tool)
                if (entry.movePath) reloadPath(entry.movePath, toolPart.tool)
              }
            }
          }
        }

        if (part.type === "reasoning") {
          updateReasoningFromPart(part)
        }
      }
    },
    [addPart, updateReasoningFromPart],
  )

  // Listen to session.error events
  const handleSessionError = useCallback(
    (event: ServerEvent) => {
      if (event.type === "session.error") {
        const { sessionID, error } = event.properties as { sessionID: string; error: unknown }
        console.error("[MessagesContext] Session error:", sessionID, error)
        addSessionError(sessionID, error)
      }
    },
    [addSessionError],
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
        removeTrackedReasoningPart(sessionID, partID)
      }
    },
    [removePart, removeTrackedReasoningPart],
  )

  // Load messages for a session
  const loadSessionMessages = useCallback(
    async (sessionID: string) => {
      // Skip loading for virtual sessions (not yet persisted to server)
      if (sessionID.startsWith("virtual-")) {
        console.log("[MessagesContext] Skipping load for virtual session:", sessionID)
        return null
      }

      console.log("[MessagesContext] Loading messages for session:", sessionID)

      try {
        const response = await sdk.session.messages({ path: { id: sessionID } })

        if (response.error) {
          console.error("[MessagesContext] Failed to load messages:", response.error)
          return null
        }

        const loadedMessages = (response.data ?? []) as unknown as Message[]
        console.log("[MessagesContext] Messages loaded:", loadedMessages.length)
        // SDK response is already in the correct format: Array<{ info: Message, parts: Array<Part> }>
        // Cast needed because sdk.session.messages returns non-v2 types, but they're structurally identical

        console.log("[MessagesContext] Loaded messages sample:", loadedMessages[0])

        if (loadedMessages.length > 0) {
          // Replace messages for this session with latest server data.
          setMessages((prev) => {
            const filtered = prev.filter((msg) => msg.info.sessionID !== sessionID)
            return [...filtered, ...loadedMessages]
          })

          syncSessionReasoningFromMessages(sessionID, loadedMessages)
        }

        let last: Message | undefined
        let lastCreated = -Infinity
        for (const message of loadedMessages) {
          const created = message.info.time.created
          if (created <= lastCreated) continue
          last = message
          lastCreated = created
        }

        const completed = (last ? (last.info as any)?.time?.completed : 0) as unknown
        const isAssistant = last ? (last.info as any)?.role === "assistant" : false
        const busy = Boolean(last && isAssistant && (!completed || completed === 0))
        setSessionIdle(sessionID, !busy)

        return loadedMessages
      } catch (err) {
        console.error("[MessagesContext] Failed to load messages:", err)
        return null
      }
    },
    [setSessionIdle, syncSessionReasoningFromMessages],
  )

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

  const respondPermission = useCallback(async (requestID: string, reply: "once" | "always" | "reject") => {
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
  }, [])

  // Question events
  const handleQuestionAsked = useCallback((event: ServerEvent) => {
    if (event.type !== "question.asked") return
    const request = event.properties as QuestionRequest
    console.log("[MessagesContext] Question asked:", request.id, request.sessionID)
    setQuestions((prev) => {
      const newMap = new Map(prev)
      const sessionQuestions = newMap.get(request.sessionID) ?? []
      const exists = sessionQuestions.some((q) => q.id === request.id)
      if (exists) {
        // Update existing question
        newMap.set(
          request.sessionID,
          sessionQuestions.map((q) => (q.id === request.id ? request : q)),
        )
      } else {
        // Add new question
        newMap.set(request.sessionID, [...sessionQuestions, request])
      }
      return newMap
    })
  }, [])

  const handleQuestionReplied = useCallback((event: ServerEvent) => {
    if (event.type !== "question.replied") return
    const { sessionID, requestID } = event.properties as { sessionID: string; requestID: string }
    console.log("[MessagesContext] Question replied:", requestID, sessionID)
    setQuestions((prev) => {
      const newMap = new Map(prev)
      const sessionQuestions = newMap.get(sessionID)
      if (sessionQuestions) {
        newMap.set(
          sessionID,
          sessionQuestions.filter((q) => q.id !== requestID),
        )
      }
      return newMap
    })
  }, [])

  const handleQuestionRejected = useCallback((event: ServerEvent) => {
    if (event.type !== "question.rejected") return
    const { sessionID, requestID } = event.properties as { sessionID: string; requestID: string }
    console.log("[MessagesContext] Question rejected:", requestID, sessionID)
    setQuestions((prev) => {
      const newMap = new Map(prev)
      const sessionQuestions = newMap.get(sessionID)
      if (sessionQuestions) {
        newMap.set(
          sessionID,
          sessionQuestions.filter((q) => q.id !== requestID),
        )
      }
      return newMap
    })
  }, [])

  const getQuestionsBySession = useCallback(
    (sessionID: string): QuestionRequest[] => {
      return questions.get(sessionID) ?? []
    },
    [questions],
  )

  const getQuestionForCall = useCallback(
    (sessionID: string, callID?: string | null): QuestionRequest | undefined => {
      if (!sessionID || !callID) return undefined
      const sessionQuestions = questions.get(sessionID)
      if (!sessionQuestions) return undefined
      return sessionQuestions.find((q) => q.tool?.callID === callID)
    },
    [questions],
  )

  const replyQuestion = useCallback(async (requestID: string, answers: QuestionAnswer[]): Promise<boolean> => {
    try {
      await sdk.question.reply({
        requestID,
        answers,
      })
      // Remove from local state (event will also do this, but be proactive)
      setQuestions((prev) => {
        const newMap = new Map(prev)
        for (const [sessionID, sessionQuestions] of newMap) {
          const filtered = sessionQuestions.filter((q) => q.id !== requestID)
          if (filtered.length !== sessionQuestions.length) {
            newMap.set(sessionID, filtered)
            break
          }
        }
        return newMap
      })
      return true
    } catch (e) {
      console.error("[MessagesContext] Failed to reply to question:", e)
      return false
    }
  }, [])

  const rejectQuestion = useCallback(async (requestID: string): Promise<boolean> => {
    try {
      await sdk.question.reject({
        requestID,
      })
      // Remove from local state (event will also do this, but be proactive)
      setQuestions((prev) => {
        const newMap = new Map(prev)
        for (const [sessionID, sessionQuestions] of newMap) {
          const filtered = sessionQuestions.filter((q) => q.id !== requestID)
          if (filtered.length !== sessionQuestions.length) {
            newMap.set(sessionID, filtered)
            break
          }
        }
        return newMap
      })
      return true
    } catch (e) {
      console.error("[MessagesContext] Failed to reject question:", e)
      return false
    }
  }, [])

  // Subscribe to events if emitter is provided
  useEventHandler(emitter ?? null, "message.updated", handleMessageUpdated)
  useEventHandler(emitter ?? null, "message.part.updated", handlePartUpdated)
  useEventHandler(emitter ?? null, "session.error", handleSessionError)
  useEventHandler(emitter ?? null, "message.removed", handleMessageRemoved)
  useEventHandler(emitter ?? null, "message.part.removed", handlePartRemoved)
  useEventHandler(emitter ?? null, "permission.asked", handlePermissionAsked)
  useEventHandler(emitter ?? null, "permission.replied", handlePermissionReplied)
  useEventHandler(emitter ?? null, "question.asked", handleQuestionAsked)
  useEventHandler(emitter ?? null, "question.replied", handleQuestionReplied)
  useEventHandler(emitter ?? null, "question.rejected", handleQuestionRejected)

  const value: MessagesContextValue = {
    messages,
    addMessage,
    addSessionError,
    updateMessage,
    removeMessage,
    addPart,
    updatePart,
    removePart,
    clearMessages,
    getMessagesBySession,
    loadSessionMessages,
    setMessages,
    removeSessionErrors,
    permissions,
    getPermissionForCall,
    respondPermission,
    questions,
    getQuestionsBySession,
    getQuestionForCall,
    replyQuestion,
    rejectQuestion,
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
