import { useCallback, useEffect, useState, useRef } from "react"
import type { Session } from "@opencode-ai/sdk/client"
import { useEventStream, useEventHandler, eventEmitter, type ServerEvent, type ConnectionState } from "./lib/api/events"
import { useSessionEvents } from "./lib/api/useSessionEvents"
import { useSession } from "./state/SessionContext"
import { useToast } from "./state/ToastContext"
import { MessageInput } from "./components/MessageInput"
import { MessageList } from "./components/MessageList"
import { ChatLoadGuard } from "./components/ChatLoadGuard"
import type { Toast } from "./components/Toast"
import { MessagesProvider, useMessages } from "./state/MessagesContext"
import { ThemeProvider } from "./state/ThemeContext"
import { CompactHeader } from "./components/CompactHeader"
import { OfflineBanner } from "./components/OfflineBanner"
import { UpdateBanner } from "./components/UpdateBanner"
import { CommandPalette } from "./components/CommandPalette"
import { KeyboardShortcutsHelp } from "./components/KeyboardShortcutsHelp"
import { SubtaskDrawerProvider } from "./state/SubtaskDrawerContext"
import { SubtaskDrawer } from "./components/SubtaskDrawer/SubtaskDrawer"
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts"
import { ideBridge } from "./lib/ideBridge"
import { extractPathsFromDrop } from "./lib/dnd"
import { createDropCoordinator } from "./lib/dropCoordinator"
import {
  isUnsupportedForwardedSystemFileDrop,
  isUnsupportedNativeSystemFileDrop,
  unsupportedSystemFileDropMessage,
} from "./lib/dropUnsupported"
import { initKeyboardHandler, destroyKeyboardHandler } from "./lib/keyboardHandler"
import { useSessionActivation } from "./state/useSessionActivation"
import { useTabStore } from "./state/tabStore"
import { sdk } from "./lib/api/sdkClient"
import { retryScopedStateWrites, setScopedStateWriteErrorReporter } from "./state/scopedStorage"
import { loadDraftSession, saveDraftSession } from "./state/repo/draftRepo"
import { switchSessionWithTabRollback } from "./state/switchSession"
import { useSessionVisibilitySync } from "./hooks/useSessionVisibilitySync"

const isMac = typeof navigator !== "undefined" && navigator.platform.includes("Mac")

export function chatState(input: { loading: boolean; loaded: boolean; error: boolean; ready: boolean }) {
  if (input.ready) return { loading: false, error: false, blocked: false }
  const loading = input.loading || (!input.loaded && !input.error)
  return { loading, error: !loading && input.error, blocked: loading || input.error }
}

export async function retryLoad(input: {
  id: string | null | undefined
  load: (id: string) => Promise<unknown> | unknown
  activate?: (id: string) => Promise<unknown> | unknown
}) {
  if (!input.id) return
  if (input.activate) {
    await input.activate(input.id)
    return
  }
  await input.load(input.id)
}

export function handleSessionUiEvent(input: {
  event: ServerEvent
  currentSessionId: string | null | undefined
  setSessionIdle: (sessionID: string, idle: boolean) => void
  showToast: (message: string, options?: Partial<Omit<Toast, "id" | "message">>) => string
}) {
  if (input.event.type === "session.idle") {
    const { sessionID } = input.event.properties
    console.log("[App] session.idle event:", { sessionID, currentSessionID: input.currentSessionId })
    console.log("[App] Session became idle, updating idle map")
    input.setSessionIdle(sessionID, true)
    return
  }

  if (input.event.type !== "session.compacted") return
  const { sessionID } = input.event.properties
  if (input.currentSessionId !== sessionID) return
  console.log("[App] Session compacted:", sessionID)
  input.showToast("会话历史已压缩以节省空间", {
    title: "会话已压缩",
    variant: "info",
    duration: 5000,
  })
}

export function handleIdeBridgeUiEvent(
  msg: unknown,
  switchSession: (sessionID: string) => unknown,
  sessionExists: (sessionID: string) => boolean | Promise<boolean>,
  requestGeneration: { current: number },
) {
  if (!msg || typeof msg !== "object") return false
  const event = msg as { type?: unknown; payload?: { sessionID?: unknown } }
  if (event.type !== "openSession") return false
  if (typeof event.payload?.sessionID !== "string" || !event.payload.sessionID) return false
  const sessionID = event.payload.sessionID
  const generation = ++requestGeneration.current
  const switchIfExists = (exists: boolean) => {
    if (!exists || generation !== requestGeneration.current) return
    try {
      void Promise.resolve(switchSession(sessionID)).catch(() => {})
    } catch {}
  }
  const exists = sessionExists(sessionID)
  if (typeof exists === "boolean") {
    switchIfExists(exists)
    return true
  }
  void exists.then(switchIfExists).catch(() => {})
  return true
}

export async function ideSessionExists(sessionID: string) {
  return sdk.session
    .get({ path: { id: sessionID } })
    .then((response) => Boolean(response.data))
    .catch(() => false)
}

export type ReuseCheck = "reusable" | "not_reusable" | "unknown"
type SessionCandidate = { id: string }
type DefaultSessionInput = Pick<Session, "id" | "title" | "parentID"> & {
  time: Session["time"] & { archived?: number }
}

function normalizeReuseCheck(value: unknown): ReuseCheck {
  if (value === true) return "reusable"
  if (value === false) return "not_reusable"
  if (value === "reusable" || value === "not_reusable" || value === "unknown") return value
  return "unknown"
}

function isNotFoundError(error: unknown) {
  const record = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : null
  const data =
    typeof record?.data === "object" && record.data !== null ? (record.data as Record<string, unknown>) : null
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : record?.message
  const dataMessage = data?.message
  const text = [message, dataMessage]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase()

  return (
    record?.name === "NotFoundError" ||
    text.includes("404") ||
    text.includes("not found") ||
    text.includes("not_found") ||
    text.includes("not-found") ||
    text.includes("session not found") ||
    record?.status === 404 ||
    record?.status === "404" ||
    record?.statusCode === 404 ||
    record?.statusCode === "404"
  )
}

export function reuseCheckFromResponses(input: {
  exists: boolean | "unknown"
  messages: unknown[] | "unknown"
}): ReuseCheck {
  if (input.exists === false) return "not_reusable"
  if (input.exists === "unknown" || input.messages === "unknown") return "unknown"
  return input.messages.length === 0 ? "reusable" : "not_reusable"
}

export async function findReusableDefaultSession(
  sessions: DefaultSessionInput[],
  messages: (id: string) => Promise<unknown[]> | unknown[],
): Promise<SessionCandidate | null> {
  return [...sessions]
    .filter(
      (session) =>
        !session.parentID &&
        session.time.archived === undefined &&
        /^New session - \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(session.title || ""),
    )
    .sort((a, b) => (b.time.updated ?? b.time.created) - (a.time.updated ?? a.time.created))
    .reduce<Promise<SessionCandidate | null>>(async (result, session) => {
      const found = await result
      if (found) return found
      const list = await Promise.resolve(messages(session.id)).catch(() => null)
      return list?.length === 0 ? { id: session.id } : null
    }, Promise.resolve(null))
}

export async function findReusableDefaultSessionFallback(input: {
  sessions: DefaultSessionInput[]
  list: () => Promise<DefaultSessionInput[]>
  messages: (id: string) => Promise<unknown[]> | unknown[]
}) {
  const loaded = input.sessions.length > 0 ? input.sessions : await input.list()
  return findReusableDefaultSession(loaded, input.messages)
}

export async function checkDraftSessionReusable(id: string): Promise<ReuseCheck> {
  const session = await sdk.session.get({ path: { id } }).catch((error: unknown) => error)
  if (isNotFoundError(session)) return "not_reusable"
  const response =
    typeof session === "object" && session !== null ? (session as { data?: unknown; error?: unknown }) : null
  if (!response || session instanceof Error) return "unknown"
  if (isNotFoundError(response.error)) return "not_reusable"
  if (response.error) return "unknown"
  if (!response.data) return reuseCheckFromResponses({ exists: false, messages: "unknown" })
  const messages = await sdk.session.messages({ path: { id } }).catch(() => null)
  if (!messages || messages.error) return "unknown"
  if (!messages.data) return "unknown"
  return reuseCheckFromResponses({ exists: true, messages: messages.data })
}

export async function prepareSession(input: {
  draft: string | null
  restore?: () => Promise<string | null>
  reusable: (id: string) => Promise<ReuseCheck | boolean>
  fallback?: () => Promise<SessionCandidate | null>
  create: () => Promise<SessionCandidate | null>
  open: (id: string) => void
  switchTo: (id: string) => Promise<void>
  setDraft: (id: string | null) => void
  fail: () => void
}) {
  const draft = input.draft ?? (input.restore ? await input.restore().catch(() => null) : null)
  if (draft) {
    const reuse = await input
      .reusable(draft)
      .then(normalizeReuseCheck)
      .catch((): ReuseCheck => "unknown")
    if (reuse === "reusable") {
      input.open(draft)
      const restored = await input
        .switchTo(draft)
        .then(() => true)
        .catch(() => false)
      if (restored) return
    }
    if (reuse === "not_reusable") input.setDraft(null)
  }

  const fallback = input.fallback ? await input.fallback().catch(() => null) : null
  if (fallback) {
    input.open(fallback.id)
    const switched = await input
      .switchTo(fallback.id)
      .then(() => true)
      .catch(() => false)
    if (switched) {
      input.setDraft(fallback.id)
      return
    }
  }

  const next = await input.create().catch(() => null)
  if (!next) {
    input.fail()
    return
  }
  input.open(next.id)
  input.setDraft(next.id)
}

// Inner component that uses MessagesContext
function AppInner({ connectionState }: { connectionState: ConnectionState }) {
  const {
    currentSession,
    sessions,
    createSession,
    switchSession,
    isCreating,
    error,
    clearError,
    selectionRestoreNotice,
    clearSelectionRestoreNotice,
  } = useSession()
  const tabStore = useTabStore()
  const { showToast } = useToast()
  const { getMessagesBySession, isSessionLoading, isSessionLoaded, isSessionLoadError, loadSessionMessages } =
    useMessages()
  const compactHeaderRef = useRef<{ toggleSessionDropdown: () => void }>(null)
  const messageInputRef = useRef<{
    focus: () => void
    insertPaths: (paths: string[]) => void
    pastePath: (path: string) => void
    insertPlainWithMentions: (value: string) => void
  }>(null)
  const dropCoordinatorRef = useRef<ReturnType<typeof createDropCoordinator> | null>(null)
  const ideOpenSessionGeneration = useRef(0)
  if (!dropCoordinatorRef.current) {
    dropCoordinatorRef.current = createDropCoordinator({
      focus: () => messageInputRef.current?.focus(),
      insertPaths: (paths) => messageInputRef.current?.insertPaths(paths),
      pastePath: (path) => messageInputRef.current?.pastePath(path),
    })
  }

  useEffect(() => {
    setScopedStateWriteErrorReporter((input) => {
      showToast(input.message, {
        variant: "warning",
        duration: 2500,
      })
    })
    const disposeReady = ideBridge.onReady(() => {
      void retryScopedStateWrites()
    })
    return () => {
      disposeReady()
      setScopedStateWriteErrorReporter(null)
    }
  }, [showToast])

  // Keyboard shortcuts state
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [sendRequestKey, setSendRequestKey] = useState(0)

  const creating = useRef(false)

  const activateSession = useSessionActivation()
  useSessionVisibilitySync()

  const gate = currentSession?.id
    ? chatState({
        loading: isSessionLoading(currentSession.id),
        loaded: isSessionLoaded(currentSession.id),
        error: isSessionLoadError(currentSession.id),
        ready: getMessagesBySession(currentSession.id).length > 0,
      })
    : { loading: false, error: false, blocked: false }

  const handleRetrySessionLoad = useCallback(() => {
    void retryLoad({
      id: currentSession?.id,
      load: loadSessionMessages,
      activate: activateSession,
    })
  }, [activateSession, currentSession?.id, loadSessionMessages])

  const handleNewSession = useCallback(() => {
    if (creating.current) return
    creating.current = true
    void prepareSession({
      draft: null,
      restore: loadDraftSession,
      reusable: checkDraftSessionReusable,
      fallback: () =>
        findReusableDefaultSessionFallback({
          sessions,
          list: () =>
            sdk.session.list({ limit: 50, roots: true }).then((response) => {
              if (response.error) {
                throw new Error(
                  typeof response.error === "object" && "message" in response.error
                    ? String(response.error.message)
                    : "Failed to load sessions",
                )
              }
              if (!Array.isArray(response.data)) throw new Error("sessions missing")
              return response.data
            }),
          messages: async (id) => {
            const messages = await sdk.session.messages({ path: { id } })
            if (messages.error) {
              throw new Error(
                typeof messages.error === "object" && "message" in messages.error
                  ? String(messages.error.message)
                  : "Failed to load messages",
              )
            }
            if (!Array.isArray(messages.data)) throw new Error("messages missing")
            return messages.data
          },
        }),
      create: createSession,
      open: tabStore.openTab,
      switchTo: switchSession,
      setDraft: (id) => {
        void saveDraftSession(id)
      },
      fail: () => {
        showToast("创建会话失败", { variant: "error" })
      },
    }).finally(() => {
      creating.current = false
    })
  }, [createSession, sessions, switchSession, tabStore.openTab, showToast])

  const handleToggleSessionList = useCallback(() => {
    compactHeaderRef.current?.toggleSessionDropdown()
  }, [])

  const handleSwitchSession = useCallback(
    async (sessionId: string) => {
      const ok = await switchSessionWithTabRollback({
        sessionId,
        previousSessionId: currentSession?.id ?? null,
        previousActiveTab: tabStore.activeTab,
        existed: tabStore.openTabs.includes(sessionId),
        open: tabStore.openTab,
        activate: tabStore.activateTab,
        canActivate: (id) => tabStore.openTabs.includes(id),
        onUnrecoverable: handleNewSession,
        remove: tabStore.removeTab,
        switchTo: switchSession,
      })
      if (ok) return true
      showToast("切换会话失败", { variant: "error" })
      return false
    },
    [currentSession?.id, handleNewSession, showToast, switchSession, tabStore],
  )

  // Keyboard shortcuts handlers
  const handleCloseModal = useCallback(() => {
    if (isCommandPaletteOpen) {
      setIsCommandPaletteOpen(false)
    } else if (isHelpOpen) {
      setIsHelpOpen(false)
    } else if (isSettingsOpen) {
      setIsSettingsOpen(false)
    }
  }, [isCommandPaletteOpen, isHelpOpen, isSettingsOpen])

  const isAnyModalOpen = isCommandPaletteOpen || isHelpOpen || isSettingsOpen

  // Set up keyboard shortcuts
  useKeyboardShortcuts({
    onNewSession: handleNewSession,
    onOpenCommandPalette: () => setIsCommandPaletteOpen(true),
    onOpenSettings: () => setIsSettingsOpen(true),
    onShowHelp: () => setIsHelpOpen(true),
    onCloseModal: handleCloseModal,
    onToggleSessionList: handleToggleSessionList,
    isModalOpen: isAnyModalOpen,
  })

  // Fix Cmd/Ctrl clipboard shortcuts in VSCode webview iframe (macOS)
  useEffect(() => {
    const handler = initKeyboardHandler()
    return () => {
      handler.destroy()
      destroyKeyboardHandler()
    }
  }, [])

  // Host → UI bridge messages
  useEffect(() => {
    const consumeReadUrisResult = (msg: any) => {
      const files = (msg.payload?.filePaths ?? msg.filePaths) as string[] | undefined
      const directories = (msg.payload?.directoryPaths ?? msg.directoryPaths) as string[] | undefined
      if (!Array.isArray(files) && !Array.isArray(directories)) return false
      return dropCoordinatorRef.current?.consume({
        files: Array.isArray(files) ? files : [],
        directories: Array.isArray(directories) ? directories : [],
      })
    }

    const consumeDragEventDrop = (msg: any) => {
      const eventType = typeof msg.eventType === "string" ? msg.eventType : ""
      const payload = msg.payload as
        | {
            dataTransfer?: { data?: Record<string, string> }
          }
        | undefined
      if (eventType !== "drop" || !payload?.dataTransfer?.data) return false
      if (isUnsupportedForwardedSystemFileDrop(payload)) {
        showToast(unsupportedSystemFileDropMessage, { variant: "warning", duration: 5000 })
        return true
      }
      const data = payload.dataTransfer.data
      const uriList = (data["application/vnd.code.uri-list"] || data["text/uri-list"]) as string | undefined
      if (!uriList) return false
      const files = uriList
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !s.startsWith("#"))
        .map((uri) => (uri.startsWith("file://") ? uri.replace("file://", "") : uri))
      if (files.length === 0) return false
      return dropCoordinatorRef.current?.consume({ files })
    }

    const handler = (msg: any) => {
      if (!msg || typeof msg !== "object") return
      if (
        handleIdeBridgeUiEvent(
          msg,
          handleSwitchSession,
          ideSessionExists,
          ideOpenSessionGeneration,
        )
      )
        return
      if (msg.type === "insertPaths") {
        const paths = (msg.payload?.paths ?? msg.paths) as string[] | undefined
        if (Array.isArray(paths) && paths.length > 0) {
          messageInputRef.current?.focus()
          messageInputRef.current?.insertPaths(paths)
        }
      }
      if (msg.type === "pastePath") {
        const path = (msg.payload?.path ?? msg.path) as string | undefined
        if (typeof path === "string" && path.length > 0) {
          messageInputRef.current?.focus()
          messageInputRef.current?.pastePath(path)
        }
      }
      if (msg.type === "readUrisResult") {
        consumeReadUrisResult(msg)
      }
      if (msg.type === "drag-event") {
        if (consumeDragEventDrop(msg)) return
        if (!isMac) return
        const eventType = typeof msg.eventType === "string" ? msg.eventType : ""
        const payload = msg.payload as
          | {
              clientX?: number
              clientY?: number
              shiftKey?: boolean
              dataTransfer?: { data?: Record<string, string> }
            }
          | undefined
        if (!eventType || !payload) return

        const clientX = typeof payload.clientX === "number" ? payload.clientX : 0
        const clientY = typeof payload.clientY === "number" ? payload.clientY : 0
        const shiftKey = !!payload.shiftKey
        const target = document.elementFromPoint(clientX, clientY) ?? document.body
        const synthetic = new DragEvent(eventType, {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          shiftKey,
        })
        target.dispatchEvent(synthetic)
      }
    }
    ideBridge.on(handler)
    const windowHandler = (event: MessageEvent) => {
      const msg = event.data
      if (!msg || typeof msg !== "object") return
      if (msg.type === "readUrisResult") {
        consumeReadUrisResult(msg)
        return
      }
      if (msg.type === "drag-event") {
        consumeDragEventDrop(msg)
      }
    }
    window.addEventListener("message", windowHandler)
    return () => {
      ideBridge.off(handler)
      window.removeEventListener("message", windowHandler)
    }
  }, [handleSwitchSession])

  // Accept drop anywhere in the webview (VSCode iframe)
  useEffect(() => {
    const onDragOver = (ev: DragEvent) => {
      ev.preventDefault()
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy"
    }
    const onDrop = (ev: DragEvent) => {
      ev.preventDefault()
      ev.stopPropagation()
      const paths = extractPathsFromDrop(ev)
      if (paths && paths.length > 0) {
        dropCoordinatorRef.current?.consume({ files: paths })
        return
      }
      const types = ev.dataTransfer?.types ? Array.from(ev.dataTransfer.types) : []
      if (isUnsupportedNativeSystemFileDrop({ types, paths: paths ?? [] })) {
        showToast(unsupportedSystemFileDropMessage, { variant: "warning", duration: 5000 })
      }
    }
    document.addEventListener("dragover", onDragOver as any)
    document.addEventListener("drop", onDrop as any)
    return () => {
      document.removeEventListener("dragover", onDragOver as any)
      document.removeEventListener("drop", onDrop as any)
    }
  }, [])

  // Focus message input when session changes
  useEffect(() => {
    if (!currentSession?.id) return
    const timer = setTimeout(() => {
      messageInputRef.current?.focus()
    }, 100)
    return () => clearTimeout(timer)
  }, [currentSession?.id])

  // Show toast for session context errors
  useEffect(() => {
    if (error) {
      showToast(error.message, {
        title: "错误",
        variant: "error",
        duration: 8000,
      })
      // Clear error after showing toast
      clearError()
    }
  }, [error, showToast, clearError])

  useEffect(() => {
    if (!selectionRestoreNotice) return
    showToast(selectionRestoreNotice, {
      title: "已恢复选择",
      variant: "warning",
      duration: 5000,
    })
    clearSelectionRestoreNotice()
  }, [selectionRestoreNotice, showToast, clearSelectionRestoreNotice])

  return (
    <div className="min-h-screen w-full bg-[rgb(243,243,243)] dark:bg-gray-950">
      <div className="mx-auto flex h-screen w-full max-w-[1200px] flex-col bg-white dark:bg-gray-950">
        {/* Compact Header */}
        <CompactHeader
          ref={compactHeaderRef}
          connectionState={connectionState}
          onNewSession={handleNewSession}
          isCreatingSession={isCreating}
          onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        />

        <UpdateBanner />

        {/* Offline Banner */}
        <OfflineBanner connectionState={connectionState} />

        <ChatLoadGuard loading={gate.loading} error={gate.error} onRetry={handleRetrySessionLoad}>
          {/* Messages Area */}
          <main className="flex-1 overflow-y-auto bg-[rgb(243,243,243)] px-4 py-3 dark:bg-gray-950">
            <MessageList
              sessionID={currentSession?.id}
              onUndoToInput={(value) => messageInputRef.current?.insertPlainWithMentions(value)}
              sendRequestKey={sendRequestKey}
            />
          </main>

          {/* Input Area */}
          <MessageInput
            ref={messageInputRef}
            sessionID={currentSession?.id ?? null}
            blocked={gate.blocked}
            onMessageSent={() => {
              console.log("[App] Message sent successfully")
            }}
            onSendIntent={() => setSendRequestKey((value) => value + 1)}
            onError={(error) => {
              console.error("[App] Message send error:", error)
            }}
          />
        </ChatLoadGuard>

        {/* Command Palette */}
        <CommandPalette
          isOpen={isCommandPaletteOpen}
          onClose={() => setIsCommandPaletteOpen(false)}
          sessions={sessions}
          onNewSession={handleNewSession}
          onSwitchSession={handleSwitchSession}
          onOpenSettings={() => setIsSettingsOpen(true)}
          onShowHelp={() => setIsHelpOpen(true)}
        />

        {/* Keyboard Shortcuts Help */}
        <KeyboardShortcutsHelp isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
      </div>
    </div>
  )
}

function AppContent() {
  const { connectionState, emitter } = useEventStream({
    debug: true,
    onConnectionStateChange: (state) => {
      console.log("[App] Connection state changed:", state)
    },
  })

  const { currentSession, setSessionIdle } = useSession()
  const { showToast } = useToast()

  const handleAllEvents = useCallback(
    (event: ServerEvent) => {
      // Forward all events to the global singleton for SessionContext
      eventEmitter.emit(event)

      if (event.type === "server.connected") {
        console.log("[App] Successfully connected to OpenCode server")
        showToast("已连接到 OpenCode 服务器", { variant: "success", duration: 3000 })
      }

      // session.error is handled in MessagesContext.tsx to show a persistent message

      handleSessionUiEvent({
        event,
        currentSessionId: currentSession?.id,
        setSessionIdle,
        showToast,
      })
    },
    [currentSession?.id, setSessionIdle, showToast],
  )

  useEventHandler(emitter, "*", handleAllEvents)

  useSessionEvents(emitter, {
    onSessionCreated: (event) => {
      console.log("[App] Session created:", event.properties.sessionID)
    },
    onSessionUpdated: (event) => {
      console.log("[App] Session updated:", event.properties.sessionID)
    },
    onSessionDeleted: (event) => {
      console.log("[App] Session deleted:", event.properties.info.id)
    },
  })

  return (
    <MessagesProvider emitter={emitter}>
      <SubtaskDrawerProvider>
        <AppInner connectionState={connectionState} />
        <SubtaskDrawer />
      </SubtaskDrawerProvider>
    </MessagesProvider>
  )
}

function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  )
}

export default App
