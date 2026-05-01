import { useCallback, useEffect, useState, useRef } from "react"
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
import { initKeyboardHandler, destroyKeyboardHandler } from "./lib/keyboardHandler"
import { useSessionActivation } from "./state/useSessionActivation"
import { useTabStore } from "./state/tabStore"
import { sdk } from "./lib/api/sdkClient"
import { setScopedStateWriteErrorReporter } from "./state/scopedStorage"
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

export async function prepareSession(input: {
  draft: string | null
  restore?: () => Promise<string | null>
  reusable: (id: string) => Promise<boolean>
  create: () => Promise<{ id: string } | null>
  open: (id: string) => void
  switchTo: (id: string) => Promise<void>
  setDraft: (id: string | null) => void
  fail: () => void
}) {
  const draft = input.draft ?? (input.restore ? await input.restore().catch(() => null) : null)
  if (draft) {
    const ok = await input.reusable(draft).catch(() => false)
    if (ok) {
      input.open(draft)
      const restored = await input
        .switchTo(draft)
        .then(() => true)
        .catch(() => false)
      if (restored) return
    }
    input.setDraft(null)
  }

  const next = await input.create()
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

  useEffect(() => {
    setScopedStateWriteErrorReporter((input) => {
      showToast(input.message, {
        variant: "warning",
        duration: 2500,
      })
    })
    return () => {
      setScopedStateWriteErrorReporter(null)
    }
  }, [showToast])

  // Keyboard shortcuts state
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

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
      reusable: async (id) => {
        const session = await sdk.session.get({ path: { id } })
        if (!session.data) return false
        const messages = await sdk.session.messages({ path: { id } })
        if (messages.error) return false
        return (messages.data ?? []).length === 0
      },
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
  }, [createSession, switchSession, tabStore.openTab, showToast])

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
    const handler = (msg: any) => {
      if (!msg || typeof msg !== "object") return
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
      if (msg.type === "drag-event") {
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

        if (eventType === "drop" && payload.dataTransfer && payload.dataTransfer.data) {
          const uriList = payload.dataTransfer.data["application/vnd.code.uri-list"] as string | undefined
          if (!uriList) return
          const paths = uriList
            .split("\n")
            .map((s) => s.trim())
            .filter((s) => s.length > 0 && !s.startsWith("#"))
            .map((uri) => (uri.startsWith("file://") ? uri.replace("file://", "") : uri))
          if (paths.length === 0) return
          messageInputRef.current?.focus()
          messageInputRef.current?.insertPaths(paths)
          return
        }

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
    return () => ideBridge.off(handler)
  }, [])

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
        messageInputRef.current?.focus()
        messageInputRef.current?.insertPaths(paths)
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
    <div className="flex flex-col h-screen bg-white dark:bg-gray-950">
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
        <main className="flex-1 overflow-y-auto px-4 py-3">
          <MessageList
            sessionID={currentSession?.id}
            onUndoToInput={(value) => messageInputRef.current?.insertPlainWithMentions(value)}
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
