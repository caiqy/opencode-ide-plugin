import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react"
import { useEventHandler, type EventEmitter, type ServerEvent } from "../lib/api/events"
import { type Message, type Part, type WebguiPart, type SDKMessage, type QuestionRequest } from "../types/messages"
import type { PermissionRequest, QuestionAnswer } from "@opencode-ai/sdk/v2/client"
import * as Store from "../lib/messagesStore"
import { sdk } from "../lib/api/sdkClient"
import { useSession } from "./SessionContext"
import { reloadPath } from "../lib/ideBridge"
import { adaptPart } from "../lib/task-part"

const PAGE = 50

interface SessionPage {
  cursor?: string
  complete: boolean
  loaded: boolean
  latest_loading: boolean
  latest_error: boolean
  older_loading: boolean
  older_error: boolean
}

interface SessionPagination {
  ready: boolean
  latestLoading: boolean
  olderLoading: boolean
  olderError: boolean
  complete: boolean
}

interface LatestLoad {
  promise: Promise<Message[] | null>
  signal?: AbortSignal
}

const emptyPage: SessionPage = {
  complete: false,
  loaded: false,
  latest_loading: false,
  latest_error: false,
  older_loading: false,
  older_error: false,
}

function mergePendingSnapshot<T extends { id: string }>(
  current: T[],
  snapshot: T[],
  touched: Record<string, number>,
  type: "permission" | "question",
  version: number,
) {
  const local = new Map(current.map((item) => [item.id, item]))
  const incoming = new Map(snapshot.map((item) => [item.id, item]))
  const result = snapshot.flatMap((item) => {
    if ((touched[`${type}:${item.id}`] ?? 0) <= version) return [item]
    const current = local.get(item.id)
    return current ? [current] : []
  })
  for (const item of current) {
    if (incoming.has(item.id) || (touched[`${type}:${item.id}`] ?? 0) <= version) continue
    result.push(item)
  }
  return result
}

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
  loadLatest: (sessionID: string, signal?: AbortSignal) => Promise<Message[] | null>
  ensureSession: (sessionID: string, signal?: AbortSignal) => Promise<Message[] | null>
  loadOlder: (sessionID: string, signal?: AbortSignal) => Promise<Message[] | null>
  /** 后台扫描更早消息：不污染分页状态，也不落地到可见消息列表 */
  scanOlder: (
    sessionID: string,
    before: string,
    signal?: AbortSignal,
  ) => Promise<{ rows: Message[]; cursor?: string } | null>
  /** 兼容接口：仅保证最近一页可用，等价于 ensureSession，不会加载整段会话历史 */
  loadSessionMessages: (sessionID: string) => Promise<Message[] | null>
  /** 仅读取当前会话分页 cursor（用于后台扫描），不触发加载 */
  getSessionCursor: (sessionID: string) => string | undefined
  isSessionComplete: (sessionID: string) => boolean
  isSessionLoading: (sessionID: string) => boolean
  isSessionLoaded: (sessionID: string) => boolean
  isSessionLoadError: (sessionID: string) => boolean
  getSessionPagination: (sessionID: string) => SessionPagination
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

function nextCursor(result: unknown): string | undefined {
  const headers =
    (result as { response?: { headers?: Headers | Record<string, unknown> } })?.response?.headers ??
    (result as { headers?: Headers | Record<string, unknown> })?.headers
  if (!headers) return undefined
  if (headers instanceof Headers) {
    const value = headers.get("X-Next-Cursor") ?? headers.get("x-next-cursor")
    return value || undefined
  }
  const value = headers["X-Next-Cursor"] ?? headers["x-next-cursor"]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function MessagesProvider({ children, emitter }: MessagesProviderProps) {
  const [messages, setRows] = useState<Message[]>([])
  const [, setSessionPageMap] = useState<Record<string, SessionPage>>({})
  const [permissions, setPermissions] = useState<PermissionRequest[]>([])
  const [questions, setQuestions] = useState<Map<string, QuestionRequest[]>>(new Map())
  const sessionLoadToken = useRef<Record<string, number>>({})
  const sessionVersion = useRef<Record<string, number>>({})
  const sessionPageRef = useRef<Record<string, SessionPage>>({})
  const latestLoadRef = useRef<Record<string, LatestLoad | undefined>>({})
  const olderLoadRef = useRef<Record<string, Promise<Message[] | null> | undefined>>({})
  const messagesRef = useRef<Message[]>([])
  const pendingEpoch = useRef(0)
  const pendingWindow = useRef<{ epoch: number; version: number; touched: Record<string, number> } | undefined>(undefined)
  const session = useSession()
  const setReasoning = session.setReasoning
  const setSessionIdle = session.setSessionIdle
  const reasoningPartsBySessionRef = useRef<Map<string, Set<string>>>(new Map())

  const setMessages = useCallback<React.Dispatch<React.SetStateAction<Message[]>>>((next) => {
    const rows = typeof next === "function" ? next(messagesRef.current) : next
    messagesRef.current = rows
    setRows(rows)
  }, [])

  const touchPending = useCallback((type: "permission" | "question", id: string) => {
    const current = pendingWindow.current
    if (!current) return
    current.version++
    current.touched[`${type}:${id}`] = current.version
  }, [])

  const normalizePart = useCallback((part: WebguiPart): WebguiPart => {
    if (part.type !== "tool") return part
    return adaptPart(part)
  }, [])

  const normalizeMsg = useCallback(
    (msg: Message): Message => ({
      ...msg,
      parts: msg.parts.map((part) => normalizePart(part)),
    }),
    [normalizePart],
  )

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
  const addMessage = useCallback(
    (message: Message) => {
      setMessages((prev) => Store.upsertMessage(prev, normalizeMsg(message)))
    },
    [normalizeMsg],
  )

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
  const addPart = useCallback(
    (messageID: string, part: WebguiPart) => {
      setMessages((prev) => Store.upsertPart(prev, messageID, normalizePart(part)))
    },
    [normalizePart],
  )

  // Update a specific part in a message
  const updatePart = useCallback(
    (messageID: string, partID: string, update: Partial<WebguiPart>) => {
      setMessages((prev) => {
        const next = Store.updatePart(prev, messageID, partID, update)
        const mi = next.findIndex((msg) => msg.info.id === messageID)
        if (mi < 0) return next
        const msg = next[mi]
        const pi = msg.parts.findIndex((part) => part.id === partID)
        if (pi < 0) return next
        const part = msg.parts[pi]
        const row = normalizePart(part)
        if (row === part) return next
        const list = [...next]
        const parts = [...msg.parts]
        parts[pi] = row
        list[mi] = { ...msg, parts }
        return list
      })
    },
    [normalizePart],
  )

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

  const mergeSessionMessages = useCallback((sessionID: string, rows: Message[], preferLocal = false) => {
    if (rows.length === 0) return
    setMessages((prev) => {
      const keep = prev.filter((row) => row.info.sessionID !== sessionID)
      const map = new Map(prev.filter((row) => row.info.sessionID === sessionID).map((row) => [row.info.id, row]))
      for (const row of rows) {
        if (preferLocal && map.has(row.info.id)) continue
        map.set(row.info.id, row)
      }
      return [...keep, ...[...map.values()].sort((a, b) => a.info.time.created - b.info.time.created)]
    })
  }, [])

  const mergeSessionRows = useCallback((sessionID: string, rows: Message[], preferLocal = false) => {
    const map = new Map(
      messagesRef.current.filter((row) => row.info.sessionID === sessionID).map((row) => [row.info.id, row]),
    )
    for (const row of rows) {
      if (preferLocal && map.has(row.info.id)) continue
      map.set(row.info.id, row)
    }
    return [...map.values()].sort((a, b) => a.info.time.created - b.info.time.created)
  }, [])

  const setPage = useCallback((sessionID: string, next: SessionPage | ((prev: SessionPage) => SessionPage)) => {
    const last = sessionPageRef.current[sessionID] ?? emptyPage
    const row = typeof next === "function" ? next(last) : next
    sessionPageRef.current = { ...sessionPageRef.current, [sessionID]: row }
    setSessionPageMap((prev) => ({ ...prev, [sessionID]: row }))
  }, [])

  const getPage = useCallback((sessionID: string) => {
    if (!sessionID) return emptyPage
    return sessionPageRef.current[sessionID] ?? emptyPage
  }, [])

  const isSessionLoading = useCallback(
    (sessionID: string) => {
      if (!sessionID) return false
      return Boolean(getPage(sessionID).latest_loading)
    },
    [getPage],
  )

  const isSessionComplete = useCallback(
    (sessionID: string) => {
      if (!sessionID) return false
      return Boolean(getPage(sessionID).complete)
    },
    [getPage],
  )

  const isSessionLoaded = useCallback(
    (sessionID: string) => {
      if (!sessionID) return false
      return Boolean(getPage(sessionID).loaded)
    },
    [getPage],
  )

  const isSessionLoadError = useCallback(
    (sessionID: string) => {
      if (!sessionID) return false
      return Boolean(getPage(sessionID).latest_error)
    },
    [getPage],
  )

  const getSessionPagination = useCallback(
    (sessionID: string) => {
      const page = getPage(sessionID)
      return {
        ready: page.loaded,
        latestLoading: page.latest_loading,
        olderLoading: page.older_loading,
        olderError: page.older_error,
        complete: page.complete,
      }
    },
    [getPage],
  )

  const getSessionCursor = useCallback((sessionID: string) => getPage(sessionID).cursor, [getPage])

  const touch = useCallback((sessionID: string) => {
    if (!sessionID) return
    const value = sessionVersion.current[sessionID] ?? 0
    sessionVersion.current[sessionID] = value + 1
  }, [])

  // Listen to message.updated events (also handles message creation)
  const handleMessageUpdated = useCallback(
    (event: ServerEvent) => {
      if (event.type === "message.updated") {
        const { info } = event.properties as { info: SDKMessage }
        console.log("[MessagesContext] Message updated:", info.id, info.role)
        touch(info.sessionID)

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
    },
    [touch],
  )

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

        const sid = (part as { sessionID?: string }).sessionID
        if (sid) touch(sid)

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
    [addPart, touch, updateReasoningFromPart],
  )

  // Listen to message.part.delta events (streaming text chunks)
  const handlePartDelta = useCallback(
    (event: ServerEvent) => {
      if (event.type === "message.part.delta") {
        const { sessionID, messageID, partID, delta, field } = event.properties as {
          sessionID: string
          messageID: string
          partID: string
          field: string
          delta: string
        }
        if (field === "text") {
          touch(sessionID)
          setMessages((prev) => {
            const messageIndex = prev.findIndex((m) => m.info.id === messageID)
            if (messageIndex < 0) return prev
            const message = prev[messageIndex]
            const partIndex = message.parts.findIndex((p) => p.id === partID)
            if (partIndex < 0) return prev
            const existingPart = message.parts[partIndex]
            if (existingPart.type !== "text" && existingPart.type !== "reasoning") return prev
            const updatedParts = [...message.parts]
            updatedParts[partIndex] = {
              ...existingPart,
              text: (existingPart.text || "") + delta,
            }
            const updated = [...prev]
            updated[messageIndex] = { ...message, parts: updatedParts }
            return updated
          })
        }
      }
    },
    [touch],
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

  const handleSessionCompacted = useCallback(
    (event: ServerEvent) => {
      if (event.type !== "session.compacted") return
      const { sessionID } = event.properties
      removeSessionErrors(sessionID)
    },
    [removeSessionErrors],
  )

  // Listen to message.removed events
  const handleMessageRemoved = useCallback(
    (event: ServerEvent) => {
      if (event.type === "message.removed") {
        const { sessionID, messageID } = event.properties as { sessionID: string; messageID: string }
        console.log("[MessagesContext] Message removed:", messageID)
        touch(sessionID)
        removeMessage(messageID)
        syncSessionReasoningFromMessages(
          sessionID,
          messagesRef.current.filter((row) => row.info.sessionID === sessionID),
        )
      }
    },
    [removeMessage, syncSessionReasoningFromMessages, touch],
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
        touch(sessionID)
        removePart(messageID, partID)
        removeTrackedReasoningPart(sessionID, partID)
      }
    },
    [removePart, removeTrackedReasoningPart, touch],
  )

  const loadLatest = useCallback(
    async (sessionID: string, signal?: AbortSignal, force = false) => {
      const pending = latestLoadRef.current[sessionID]
      if (!force && pending && !pending.signal?.aborted) return pending.promise
      if (pending) delete latestLoadRef.current[sessionID]

      console.log("[MessagesContext] Loading latest messages for session:", sessionID)
      const token = (sessionLoadToken.current[sessionID] ?? 0) + 1
      sessionLoadToken.current[sessionID] = token
      const version = sessionVersion.current[sessionID] ?? 0
      const active = () => sessionLoadToken.current[sessionID] === token
      const changed = () => (sessionVersion.current[sessionID] ?? 0) !== version
      setPage(sessionID, (prev) => ({
        ...prev,
        latest_loading: true,
        latest_error: false,
        older_loading: false,
        older_error: false,
      }))

      const run = (async () => {
        try {
          const response = await sdk.session.messages({
            path: { id: sessionID },
            query: { limit: PAGE },
            signal,
          } as any)

          if (response.error) {
            if (signal?.aborted) {
              if (active()) {
                setPage(sessionID, (prev) => ({
                  ...prev,
                  latest_loading: false,
                  older_loading: false,
                }))
              }
              return null
            }
            console.error("[MessagesContext] Failed to load messages:", response.error)
            if (active()) {
              setPage(sessionID, (prev) => ({
                ...prev,
                latest_loading: false,
                loaded: false,
                latest_error: true,
                older_loading: false,
              }))
            }
            return null
          }

          const loadedMessages = ((response.data ?? []) as unknown as Message[]).map((msg) => normalizeMsg(msg))
          const cursor = nextCursor(response)
          console.log("[MessagesContext] Messages loaded:", loadedMessages.length)

          if (!active()) return loadedMessages

          if (changed()) {
            const rows = mergeSessionRows(sessionID, loadedMessages, true)
            mergeSessionMessages(sessionID, loadedMessages, true)

            syncSessionReasoningFromMessages(sessionID, rows)

            let last: Message | undefined
            let lastCreated = -Infinity
            for (const message of rows) {
              const created = message.info.time.created
              if (created <= lastCreated) continue
              last = message
              lastCreated = created
            }

            const completed = (last ? (last.info as any)?.time?.completed : 0) as unknown
            const isAssistant = last ? (last.info as any)?.role === "assistant" : false
            const busy = Boolean(last && isAssistant && (!completed || completed === 0))
            setSessionIdle(sessionID, !busy)

            setPage(sessionID, {
              cursor,
              complete: !cursor,
              loaded: true,
              latest_loading: false,
              latest_error: false,
              older_loading: false,
              older_error: false,
            })
            return loadedMessages
          }

          if (loadedMessages.length === 0) {
            setPage(sessionID, {
              cursor,
              complete: !cursor,
              loaded: true,
              latest_loading: false,
              latest_error: false,
              older_loading: false,
              older_error: false,
            })
            return loadedMessages
          }

          mergeSessionMessages(sessionID, loadedMessages)

          if (loadedMessages.length > 0) {
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

          setPage(sessionID, {
            cursor,
            complete: !cursor,
            loaded: true,
            latest_loading: false,
            latest_error: false,
            older_loading: false,
            older_error: false,
          })

          return loadedMessages
        } catch (err) {
          if (signal?.aborted) {
            if (active()) {
              setPage(sessionID, (prev) => ({
                ...prev,
                latest_loading: false,
                older_loading: false,
              }))
            }
            return null
          }
          console.error("[MessagesContext] Failed to load messages:", err)
          if (active()) {
            setPage(sessionID, (prev) => ({
              ...prev,
              latest_loading: false,
              loaded: false,
              latest_error: true,
              older_loading: false,
            }))
          }
          return null
        }
      })()

      let entry: LatestLoad
      const promise = run.finally(() => {
        if (latestLoadRef.current[sessionID] === entry) {
          delete latestLoadRef.current[sessionID]
        }
      })
      entry = { promise, signal }
      latestLoadRef.current[sessionID] = entry
      return promise
    },
    [mergeSessionMessages, normalizeMsg, setPage, setSessionIdle, syncSessionReasoningFromMessages],
  )

  const ensureSession = useCallback(
    async (sessionID: string, signal?: AbortSignal) => {
      if (!sessionID) return null
      if (sessionPageRef.current[sessionID]?.loaded) {
        return getMessagesBySession(sessionID)
      }
      return loadLatest(sessionID, signal)
    },
    [getMessagesBySession, loadLatest],
  )

  const loadOlder = useCallback(
    (sessionID: string, signal?: AbortSignal) => {
      if (!sessionID) return Promise.resolve(null)
      if (!sessionPageRef.current[sessionID]?.loaded) {
        return ensureSession(sessionID, signal)
      }

      const page = sessionPageRef.current[sessionID] ?? emptyPage
      if (page.complete || !page.cursor) {
        return Promise.resolve(getMessagesBySession(sessionID))
      }

      const pending = olderLoadRef.current[sessionID]
      if (pending) return pending

      const before = page.cursor
      const token = sessionLoadToken.current[sessionID] ?? 0
      setPage(sessionID, (prev) => ({
        ...prev,
        older_loading: true,
        older_error: false,
      }))
      const task = (async () => {
        try {
          const response = await sdk.session.messages({
            path: { id: sessionID },
            query: { before, limit: PAGE },
            signal,
          } as any)

          if (response.error) {
            if (signal?.aborted) {
              const current = sessionPageRef.current[sessionID] ?? emptyPage
              if ((sessionLoadToken.current[sessionID] ?? 0) === token && current.cursor === before) {
                setPage(sessionID, {
                  ...current,
                  older_loading: false,
                })
              }
              return null
            }
            const current = sessionPageRef.current[sessionID] ?? emptyPage
            if ((sessionLoadToken.current[sessionID] ?? 0) === token && current.cursor === before) {
              setPage(sessionID, {
                ...current,
                older_loading: false,
                older_error: true,
              })
            }
            return null
          }

          const loadedMessages = ((response.data ?? []) as unknown as Message[]).map((msg) => normalizeMsg(msg))
          const cursor = nextCursor(response)
          const current = sessionPageRef.current[sessionID] ?? emptyPage
          if ((sessionLoadToken.current[sessionID] ?? 0) !== token) return loadedMessages
          if (current.cursor !== before) return loadedMessages

          mergeSessionMessages(sessionID, loadedMessages, true)
          setPage(sessionID, {
            ...current,
            cursor,
            complete: !cursor,
            older_loading: false,
            older_error: false,
          })
          return loadedMessages
        } catch {
          if (signal?.aborted) {
            const current = sessionPageRef.current[sessionID] ?? emptyPage
            if ((sessionLoadToken.current[sessionID] ?? 0) === token && current.cursor === before) {
              setPage(sessionID, {
                ...current,
                older_loading: false,
              })
            }
            return null
          }
          const current = sessionPageRef.current[sessionID] ?? emptyPage
          if ((sessionLoadToken.current[sessionID] ?? 0) === token && current.cursor === before) {
            setPage(sessionID, {
              ...current,
              older_loading: false,
              older_error: true,
            })
          }
          return null
        }
      })()

      const run = task.finally(() => {
        if (olderLoadRef.current[sessionID] === run) {
          delete olderLoadRef.current[sessionID]
        }
      })
      olderLoadRef.current[sessionID] = run
      return run
    },
    [ensureSession, getMessagesBySession, mergeSessionMessages, normalizeMsg, setPage],
  )

  const scanOlder = useCallback(
    async (sessionID: string, before: string, signal?: AbortSignal) => {
      if (!sessionID || !before) return null
      try {
        const response = await sdk.session.messages({
          path: { id: sessionID },
          query: { before, limit: PAGE },
          signal,
        } as any)

        if (response.error) return null

        return {
          rows: ((response.data ?? []) as unknown as Message[]).map((msg) => normalizeMsg(msg)),
          cursor: nextCursor(response),
        }
      } catch {
        return null
      }
    },
    [normalizeMsg],
  )

  // 兼容旧调用方的别名；语义与 ensureSession 相同，只保证最近一页可用。
  const loadSessionMessages = ensureSession

  // Permission events
  const handlePermissionAsked = useCallback((event: ServerEvent) => {
    if (event.type !== "permission.asked") return
    const perm = event.properties as PermissionRequest
    touchPending("permission", perm.id)
    setPermissions((prev) => {
      const exists = prev.some((p) => p.id === perm.id)
      if (exists) return prev.map((p) => (p.id === perm.id ? perm : p))
      return [...prev, perm]
    })
  }, [touchPending])

  const handlePermissionReplied = useCallback((event: ServerEvent) => {
    if (event.type !== "permission.replied") return
    const { requestID } = event.properties as { sessionID: string; requestID: string; reply: string }
    touchPending("permission", requestID)
    setPermissions((prev) => prev.filter((p) => p.id !== requestID))
  }, [touchPending])

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
      if (ok) {
        touchPending("permission", requestID)
        setPermissions((prev) => prev.filter((p) => p.id !== requestID))
      }
      return ok
    } catch (e) {
      return false
    }
  }, [touchPending])

  // Question events
  const handleQuestionAsked = useCallback((event: ServerEvent) => {
    if (event.type !== "question.asked") return
    const request = event.properties as QuestionRequest
    touchPending("question", request.id)
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
  }, [touchPending])

  const handleQuestionReplied = useCallback((event: ServerEvent) => {
    if (event.type !== "question.replied") return
    const { sessionID, requestID } = event.properties as { sessionID: string; requestID: string }
    touchPending("question", requestID)
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
  }, [touchPending])

  const handleQuestionRejected = useCallback((event: ServerEvent) => {
    if (event.type !== "question.rejected") return
    const { sessionID, requestID } = event.properties as { sessionID: string; requestID: string }
    touchPending("question", requestID)
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
  }, [touchPending])

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
      const result = await sdk.question.reply({
        requestID,
        answers,
      })
      if (result?.error) return false
      touchPending("question", requestID)
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
  }, [touchPending])

  const rejectQuestion = useCallback(async (requestID: string): Promise<boolean> => {
    try {
      const result = await sdk.question.reject({
        requestID,
      })
      if (result?.error) return false
      touchPending("question", requestID)
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
  }, [touchPending])

  const hydratePending = useCallback(async (epoch: number) => {
    const window = pendingWindow.current
    if (!window || window.epoch !== epoch) return
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const [permissionResult, questionResult] = await Promise.all([sdk.permissions.list(), sdk.question.list()])
        if (pendingWindow.current !== window) return
        const permissions = permissionResult.data
        if (!permissionResult.error && permissions) {
          setPermissions((prev) => mergePendingSnapshot(prev, permissions, window.touched, "permission", 0))
        }
        const questions = questionResult.data
        if (!questionResult.error && questions) {
          setQuestions((prev) => {
            const grouped = new Map<string, QuestionRequest[]>()
            for (const item of mergePendingSnapshot(
              [...prev.values()].flat(),
              questions,
              window.touched,
              "question",
              0,
            )) {
              grouped.set(item.sessionID, [...(grouped.get(item.sessionID) ?? []), item])
            }
            return grouped
          })
        }
        if (window.version === 0 || attempt === 1) return
      }
    } finally {
      if (pendingWindow.current === window) pendingWindow.current = undefined
    }
  }, [])

  const handleServerConnected = useCallback(() => {
    const epoch = ++pendingEpoch.current
    pendingWindow.current = { epoch, version: 0, touched: {} }
    void hydratePending(epoch)
    const sessionID = session.currentSession?.id
    if (sessionID) void loadLatest(sessionID, undefined, true)
  }, [hydratePending, loadLatest, session.currentSession?.id])

  // Subscribe to events if emitter is provided
  useEventHandler(emitter ?? null, "message.updated", handleMessageUpdated)
  useEventHandler(emitter ?? null, "message.part.updated", handlePartUpdated)
  useEventHandler(emitter ?? null, "message.part.delta", handlePartDelta)
  useEventHandler(emitter ?? null, "session.error", handleSessionError)
  useEventHandler(emitter ?? null, "session.compacted", handleSessionCompacted)
  useEventHandler(emitter ?? null, "message.removed", handleMessageRemoved)
  useEventHandler(emitter ?? null, "message.part.removed", handlePartRemoved)
  useEventHandler(emitter ?? null, "permission.asked", handlePermissionAsked)
  useEventHandler(emitter ?? null, "permission.replied", handlePermissionReplied)
  useEventHandler(emitter ?? null, "question.asked", handleQuestionAsked)
  useEventHandler(emitter ?? null, "question.replied", handleQuestionReplied)
  useEventHandler(emitter ?? null, "question.rejected", handleQuestionRejected)
  useEventHandler(emitter ?? null, "server.connected", handleServerConnected)

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
    loadLatest,
    ensureSession,
    loadOlder,
    scanOlder,
    loadSessionMessages,
    getSessionCursor,
    isSessionComplete,
    isSessionLoading,
    isSessionLoaded,
    isSessionLoadError,
    getSessionPagination,
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
