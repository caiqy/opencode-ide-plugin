import { useState, useRef, useEffect, forwardRef, useImperativeHandle, useCallback } from "react"
import type { ConnectionState } from "../../lib/api/events"
import { useTheme } from "../../state/ThemeContext"
import { useSession } from "../../state/SessionContext"
import { compareSessionList, isSessionPinned, withSessionPinned } from "../../state/sessionPaging"
import { ConfirmModal } from "../ConfirmModal"
import { SettingsPanel } from "../SettingsPanel"
import { useSessionDropdown } from "./hooks/useSessionDropdown"
import { useSessionActions } from "./hooks/useSessionActions"
import { StatusIndicator } from "./StatusIndicator"
import { StatusPopover } from "./StatusPopover"
import { ActionButtons } from "./ActionButtons"
import { SessionDropdown } from "./SessionDropdown"
import { TabBar } from "./TabBar"
import { HEADER_RIGHT_GAP } from "./utils"
import { sdk, setSessionPinned } from "../../lib/api/sdkClient"
import { useToast } from "../../state/ToastContext"
import { useTabStore } from "../../state/tabStore"
import { ideBridge } from "../../lib/ideBridge"
import { switchSessionWithTabRollback } from "../../state/switchSession"
import { useUpdate } from "../../state/UpdateContext"
import { flushScopedStateWrites } from "../../state/scopedStorage"

interface CompactHeaderProps {
  connectionState: ConnectionState
  onNewSession: () => void
  isCreatingSession: boolean
  onOpenCommandPalette: () => void
}

const CompactHeader = forwardRef<
  {
    toggleSessionDropdown: () => void
  },
  CompactHeaderProps
>(({ connectionState, onNewSession, isCreatingSession, onOpenCommandPalette }, ref) => {
  const { theme, toggleTheme } = useTheme()
  const {
    currentSession,
    setCurrentSession,
    sessions,
    setSessions,
    switchSession,
    regenerateSessionTitle,
    updateSessionTitle,
    deleteSession,
    hasMore,
    isLoading,
    isLoadingMore,
    loadSessions,
    loadMoreSessions,
  } = useSession()
  const tabStore = useTabStore()
  const toast = useToast()
  const { isChecking, checkForUpdates, confirmOpen, confirmVersion, confirmInstall, cancelInstallConfirm } = useUpdate()

  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const [sharingSessionId, setSharingSessionId] = useState<string | null>(null)
  const [pinningSessionId, setPinningSessionId] = useState<string | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restartMode, setRestartMode] = useState<"window" | "ide" | null>(ideBridge.restartMode)
  const [restartConfirmOpen, setRestartConfirmOpen] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [statusOpen, setStatusOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [displayVersion, setDisplayVersion] = useState(typeof __APP_VERSION__ === "undefined" ? "dev" : __APP_VERSION__)
  const activeRef = useRef("")
  const statusRef = useRef<HTMLButtonElement>(null)
  const sessionsEverLoaded = useRef(false)
  if (isLoading) sessionsEverLoaded.current = true
  activeRef.current = tabStore.activeTab

  const isShared = !!currentSession?.share?.url
  const canRestart = restartMode === "window" || restartMode === "ide"

  useEffect(() => {
    const syncRestartMode = () => {
      if (ideBridge.restartMode === "window" || ideBridge.restartMode === "ide") {
        setRestartMode(ideBridge.restartMode)
        return
      }
      setRestartMode(null)
    }

    syncRestartMode()
    window.addEventListener("opencode:idebridge-connected", syncRestartMode)
    return () => {
      window.removeEventListener("opencode:idebridge-connected", syncRestartMode)
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    void ideBridge
      .request<{ version?: unknown }>("getExtensionVersion")
      .then((reply) => {
        if (cancelled) return
        if (typeof reply.result?.version !== "string" || reply.result.version.length === 0) return
        setDisplayVersion(reply.result.version)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  const handleOpenConfigFile = useCallback(() => {
    void sdk.path
      .get()
      .then((result) => {
        if (typeof result.data?.configFile !== "string" || result.data.configFile.length === 0) {
          throw new Error("configFile missing")
        }
        return ideBridge.request("ensureAndOpenFile", { path: result.data.configFile })
      })
      .catch(() => {
        toast.showToast("打开配置文件失败", { variant: "error" })
      })
  }, [toast])

  const handleOpenRestartConfirm = useCallback(() => {
    setRestartConfirmOpen(true)
  }, [])

  const handleRestartConfirm = useCallback(async () => {
    setRestarting(true)
    try {
      await flushScopedStateWrites()
      const res = await ideBridge.request("restartHost")
      if (res.ok !== true) {
        toast.showToast("重启失败，请稍后重试", { variant: "error" })
      }
    } catch {
      toast.showToast("重启失败，请稍后重试", { variant: "error" })
    }
    setRestarting(false)
    setRestartConfirmOpen(false)
  }, [toast])

  const handleToggleShare = useCallback(async () => {
    if (!currentSession) return

    setIsSharing(true)
    if (isShared) {
      const res = await sdk.session.unshare({ path: { id: currentSession.id } })
      if (res.data) {
        setCurrentSession(res.data)
        toast.showToast("已取消分享会话", { variant: "success" })
      } else {
        toast.showToast("取消分享会话失败", { variant: "error" })
      }
    } else {
      const res = await sdk.session.share({ path: { id: currentSession.id } })
      if (res.data) {
        setCurrentSession(res.data)
        if (res.data.share?.url) {
          await navigator.clipboard.writeText(res.data.share.url)
          toast.showToast("分享链接已复制到剪贴板", { variant: "success" })
        }
      } else {
        toast.showToast("分享会话失败", { variant: "error" })
      }
    }
    setIsSharing(false)
  }, [currentSession, isShared, setCurrentSession, toast])

  const handleToggleShareSession = useCallback(
    async (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      const session = sessions.find((s) => s.id === sessionId)
      if (!session) return

      setSharingSessionId(sessionId)
      const sessionIsShared = !!session.share?.url

      if (sessionIsShared) {
        const res = await sdk.session.unshare({ path: { id: sessionId } })
        if (res.data) {
          // Update session in the list for immediate UI feedback
          setSessions(sessions.map((s) => (s.id === sessionId ? res.data! : s)))
          if (currentSession?.id === sessionId) {
            setCurrentSession(res.data)
          }
          toast.showToast("已取消分享会话", { variant: "success" })
        } else {
          toast.showToast("取消分享会话失败", { variant: "error" })
        }
      } else {
        const res = await sdk.session.share({ path: { id: sessionId } })
        if (res.data) {
          // Update session in the list for immediate UI feedback
          setSessions(sessions.map((s) => (s.id === sessionId ? res.data! : s)))
          if (currentSession?.id === sessionId) {
            setCurrentSession(res.data)
          }
          if (res.data.share?.url) {
            await navigator.clipboard.writeText(res.data.share.url)
            toast.showToast("分享链接已复制到剪贴板", { variant: "success" })
          }
        } else {
          toast.showToast("分享会话失败", { variant: "error" })
        }
      }
      setSharingSessionId(null)
    },
    [sessions, currentSession, setCurrentSession, setSessions, toast],
  )

  const handleTogglePinSession = useCallback(
    async (sessionId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      if (pinningSessionId) return
      const session = sessions.find((item) => item.id === sessionId)
      if (!session) return

      const pinned = !isSessionPinned(session)
      setPinningSessionId(sessionId)
      const res = await setSessionPinned({ path: { id: sessionId }, body: { pinned } })
      setPinningSessionId(null)
      if (!res.data) {
        toast.showToast(pinned ? "钉住会话失败" : "取消钉住失败", { variant: "error" })
        return
      }

      setSessions((current) =>
        current
          .map((item) => (item.id === sessionId && item === session ? withSessionPinned(item, pinned) : item))
          .sort(compareSessionList),
      )
      void loadSessions()
    },
    [loadSessions, pinningSessionId, sessions, setSessions, toast],
  )

  // Session dropdown management
  const dropdown = useSessionDropdown(sessions)

  const handleToggleHistory = useCallback(() => {
    setStatusOpen(false)
    setMenuOpen(false)
    dropdown.toggleDropdown()
  }, [dropdown.toggleDropdown])

  const handleStatusToggle = useCallback(() => {
    setMenuOpen(false)
    dropdown.closeDropdown()
    setStatusOpen((prev) => !prev)
  }, [dropdown.closeDropdown])

  const handleStatusClose = useCallback(() => {
    setStatusOpen(false)
  }, [])

  const handleMenuChange = useCallback(
    (open: boolean) => {
      if (open) {
        setStatusOpen(false)
        dropdown.closeDropdown()
      }
      setMenuOpen(open)
    },
    [dropdown.closeDropdown],
  )

  // Session actions (edit, delete)
  const actions = useSessionActions({
    sessions,
    updateSessionTitle,
    deleteSession: async (sessionId) => {
      const success = await deleteSession(sessionId)
      if (success) tabStore.closeTab(sessionId)
      return success
    },
  })

  // Expose toggleSessionDropdown method via ref
  useImperativeHandle(
    ref,
    () => ({
      toggleSessionDropdown: handleToggleHistory,
    }),
    [handleToggleHistory],
  )

  const switchWithRollback = useCallback(
    async (
      sessionId: string,
      afterSuccess?: () => void,
      afterFailure?: () => void,
      shouldHandleUnrecoverable: () => boolean = () => true,
    ) => {
      const ok = await switchSessionWithTabRollback({
        sessionId,
        previousSessionId: currentSession?.id ?? null,
        previousActiveTab: tabStore.activeTab,
        existed: tabStore.openTabs.includes(sessionId),
        open: tabStore.openTab,
        activate: tabStore.activateTab,
        canActivate: (id) => tabStore.openTabs.includes(id),
        onUnrecoverable: () => {
          if (!shouldHandleUnrecoverable()) return
          setCurrentSession(null)
          onNewSession()
        },
        remove: tabStore.removeTab,
        switchTo: switchSession,
      })
      if (ok) {
        afterSuccess?.()
        return true
      }
      afterFailure?.()
      toast.showToast("切换会话失败", { variant: "error" })
      return false
    },
    [currentSession?.id, onNewSession, setCurrentSession, switchSession, tabStore, toast],
  )

  const handleSessionSelect = useCallback(
    async (sessionId: string) => {
      await switchWithRollback(sessionId, dropdown.closeDropdown)
    },
    [dropdown.closeDropdown, switchWithRollback],
  )

  const handleTabActivate = useCallback(
    async (sessionId: string) => {
      await switchWithRollback(sessionId)
    },
    [switchWithRollback],
  )

  const handleTabClose = useCallback(
    async (sessionId: string) => {
      const idx = tabStore.openTabs.indexOf(sessionId)
      if (idx < 0) return

      const openTabs = tabStore.openTabs.filter((id) => id !== sessionId)
      const activeTab =
        tabStore.activeTab === sessionId
          ? openTabs.length === 0
            ? ""
            : openTabs[Math.min(idx, openTabs.length - 1)]
          : tabStore.activeTab

      if (tabStore.activeTab !== sessionId) {
        tabStore.closeTab(sessionId)
        return
      }

      if (activeTab) {
        const ok = await switchWithRollback(activeTab)
        if (!ok) return
        tabStore.closeTab(sessionId)
        return
      }

      tabStore.closeTab(sessionId)
      setCurrentSession(null)
      onNewSession()
    },
    [onNewSession, setCurrentSession, switchWithRollback, tabStore],
  )

  const handleCloseOtherTabs = useCallback(
    async (sessionId: string) => {
      const ok = await switchWithRollback(sessionId)
      if (!ok) return
      tabStore.closeOtherTabs(sessionId)
    },
    [switchWithRollback, tabStore],
  )

  const handleCloseTabsToRight = useCallback(
    async (sessionId: string) => {
      const idx = tabStore.openTabs.indexOf(sessionId)
      if (idx < 0) return
      const openTabs = tabStore.openTabs.slice(0, idx + 1)
      const activeTab = openTabs.includes(tabStore.activeTab) ? tabStore.activeTab : sessionId

      if (activeTab !== tabStore.activeTab) {
        const ok = await switchWithRollback(activeTab)
        if (!ok) return
      }
      tabStore.closeTabsToRight(sessionId)
    },
    [switchWithRollback, tabStore],
  )

  const handleTabDelete = useCallback(
    (sessionId: string) => {
      actions.setDeleteConfirm(sessionId)
    },
    [actions],
  )

  const handleRegenerateTitle = useCallback(
    async (sessionId: string) => {
      const ok = await regenerateSessionTitle(sessionId)
      if (!ok) {
        toast.showToast("重新生成标签名失败", { variant: "error" })
      }
    },
    [regenerateSessionTitle, toast],
  )

  const handleToggleShareTab = useCallback(
    async (sessionId: string) => {
      const session = sessions.find((s) => s.id === sessionId)
      if (!session) return

      setSharingSessionId(sessionId)
      const sessionIsShared = !!session.share?.url

      if (sessionIsShared) {
        const res = await sdk.session.unshare({ path: { id: sessionId } })
        if (res.data) {
          setSessions(sessions.map((s) => (s.id === sessionId ? res.data! : s)))
          if (currentSession?.id === sessionId) {
            setCurrentSession(res.data)
          }
          toast.showToast("已取消分享会话", { variant: "success" })
        } else {
          toast.showToast("取消分享会话失败", { variant: "error" })
        }
      } else {
        const res = await sdk.session.share({ path: { id: sessionId } })
        if (res.data) {
          setSessions(sessions.map((s) => (s.id === sessionId ? res.data! : s)))
          if (currentSession?.id === sessionId) {
            setCurrentSession(res.data)
          }
          if (res.data.share?.url) {
            await navigator.clipboard.writeText(res.data.share.url)
            toast.showToast("分享链接已复制到剪贴板", { variant: "success" })
          }
        } else {
          toast.showToast("分享会话失败", { variant: "error" })
        }
      }

      setSharingSessionId(null)
    },
    [currentSession?.id, sessions, setCurrentSession, setSessions, toast],
  )

  const handleDeleteConfirm = () => {
    actions.handleDeleteConfirm(actions.deleteConfirm, dropdown.selectedSessions, () => {
      dropdown.setSelectedSessions(new Set())
    })
  }

  const handleBulkDeleteStart = () => {
    actions.handleBulkDeleteStart(dropdown.selectedSessions)
    dropdown.setIsDropdownOpen(false)
  }

  const handleDeleteStart = (sessionId: string, e: React.MouseEvent) => {
    actions.handleDeleteStart(sessionId, e)
    dropdown.setIsDropdownOpen(false)
  }

  useEffect(() => {
    if (!tabStore.loaded || actions.isDeleting) return
    if (tabStore.openTabs.length > 0) {
      if (!tabStore.activeTab) {
        const target = tabStore.openTabs[tabStore.openTabs.length - 1]
        if (!target) {
          onNewSession()
          return
        }
        if (!restoring) {
          setRestoring(true)
          void switchWithRollback(
            target,
            () => tabStore.activateTab(target),
            () => {
              if (activeRef.current) return
              onNewSession()
            },
            () => !activeRef.current || activeRef.current === target,
          ).finally(() => {
            setRestoring(false)
          })
        }
        return
      }
      if (currentSession?.id !== tabStore.activeTab && !restoring) {
        const target = tabStore.activeTab
        const targetMissing =
          sessionsEverLoaded.current && !isLoading && !hasMore && !sessions.some((s) => s.id === target)
        if (targetMissing) return
        setRestoring(true)
        void switchWithRollback(
          target,
          undefined,
          () => {
            if (activeRef.current !== target) return
            onNewSession()
          },
          () => activeRef.current === target,
        ).finally(() => {
          setRestoring(false)
        })
      }
      return
    }

    if (currentSession?.id) {
      tabStore.openTab(currentSession.id)
      return
    }

    onNewSession()
  }, [
    currentSession?.id,
    onNewSession,
    switchWithRollback,
    tabStore.loaded,
    tabStore.openTabs,
    tabStore.activeTab,
    tabStore.openTab,
    tabStore.activateTab,
    restoring,
    actions.isDeleting,
  ])

  useEffect(() => {
    if (!tabStore.loaded) return
    if (!currentSession?.id) return
    if (!tabStore.activeTab) return
    if (tabStore.openTabs.includes(currentSession.id)) return
    tabStore.openTab(currentSession.id)
  }, [currentSession?.id, tabStore.loaded, tabStore.activeTab, tabStore.openTabs, tabStore.openTab])

  useEffect(() => {
    if (!tabStore.loaded || !sessionsEverLoaded.current || isLoading || hasMore) return
    const ids = new Set(sessions.map((s) => s.id))
    if (currentSession?.id) {
      ids.add(currentSession.id)
    }
    tabStore.pruneTabs(ids)
  }, [currentSession?.id, hasMore, sessions, tabStore.loaded, tabStore.openTabs, tabStore.pruneTabs, isLoading])

  return (
    <>
      <header className="h-9 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex items-center justify-between px-2 flex-shrink-0 relative">
        <TabBar
          openTabs={tabStore.openTabs}
          activeTab={tabStore.activeTab}
          onActivate={(id) => {
            void handleTabActivate(id)
          }}
          onClose={(id) => {
            void handleTabClose(id)
          }}
          onReorder={tabStore.reorderTabs}
          onCloseOtherTabs={(id) => {
            void handleCloseOtherTabs(id)
          }}
          onCloseTabsToRight={(id) => {
            void handleCloseTabsToRight(id)
          }}
          onRegenerateTitle={(id) => {
            void handleRegenerateTitle(id)
          }}
          onRename={(id, title) => {
            void updateSessionTitle(id, title)
          }}
          onDelete={handleTabDelete}
          onToggleShare={(id) => {
            void handleToggleShareTab(id)
          }}
        />

        {/* Right: Connection status, theme toggle, and new session button */}
        <div
          className={`flex items-center gap-1 ${HEADER_RIGHT_GAP}`}
          data-testid="compact-header-right"
          ref={dropdown.dropdownRef}
        >
          <StatusIndicator
            buttonRef={statusRef}
            connectionState={connectionState}
            open={statusOpen}
            onToggle={handleStatusToggle}
          />
          <ActionButtons
            theme={theme}
            toggleTheme={toggleTheme}
            onOpenCommandPalette={onOpenCommandPalette}
            onOpenConfigFile={ideBridge.isInstalled() ? handleOpenConfigFile : undefined}
            displayVersion={displayVersion}
            isCheckingForUpdates={isChecking}
            onCheckForUpdates={() => {
              void checkForUpdates()
            }}
            canRestart={canRestart}
            onRestart={handleOpenRestartConfirm}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onNewSession={onNewSession}
            onToggleHistory={handleToggleHistory}
            isCreatingSession={isCreatingSession}
            isShared={isShared}
            isSharing={isSharing}
            onToggleShare={handleToggleShare}
            menuOpen={menuOpen}
            onMenuOpenChange={handleMenuChange}
          />

          <StatusPopover
            open={statusOpen}
            connectionState={connectionState}
            onClose={handleStatusClose}
            triggerRef={statusRef}
          />

          <SessionDropdown
            sessions={sessions}
            currentSessionId={currentSession?.id}
            filteredSessions={dropdown.filteredSessions}
            isDropdownOpen={dropdown.isDropdownOpen}
            hasMore={hasMore}
            isSelectMode={dropdown.isSelectMode}
            isLoadingMore={isLoadingMore}
            selectedSessions={dropdown.selectedSessions}
            selectedSessionIndex={dropdown.selectedSessionIndex}
            searchQuery={dropdown.searchQuery}
            editingSessionId={actions.editingSessionId}
            editingTitle={actions.editingTitle}
            searchInputRef={dropdown.searchInputRef}
            editInputRef={actions.editInputRef}
            selectedSessionRef={dropdown.selectedSessionRef}
            sessionListRef={dropdown.sessionListRef}
            sharingSessionId={sharingSessionId}
            pinningSessionId={pinningSessionId}
            onSearchChange={dropdown.setSearchQuery}
            onSearchKeyDown={dropdown.handleSearchKeyDown}
            onToggleSelectMode={dropdown.toggleSelectMode}
            onSessionSelect={handleSessionSelect}
            onEditStart={actions.handleEditStart}
            onEditSave={actions.handleEditSave}
            onEditCancel={actions.handleEditCancel}
            onEditChange={actions.setEditingTitle}
            onDeleteStart={handleDeleteStart}
            onBulkDeleteStart={handleBulkDeleteStart}
            onCheckboxChange={dropdown.handleSessionCheckboxChange}
            onKeyDown={(e) => dropdown.handleKeyDown(e, handleSessionSelect)}
            onLoadMore={loadMoreSessions}
            onToggleShare={handleToggleShareSession}
            onTogglePin={handleTogglePinSession}
          />
        </div>
      </header>

      {/* Delete confirmation modal */}
      <ConfirmModal
        isOpen={!!actions.deleteConfirm}
        onClose={actions.handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
        title={actions.deleteConfirm === "bulk" ? "删除多个会话" : "删除会话"}
        message={
          actions.deleteConfirm === "bulk"
            ? `确定要删除所选的 ${dropdown.selectedSessions.size} 个会话吗？此操作无法撤销。`
            : "确定要删除此会话吗？此操作无法撤销。"
        }
        confirmText="删除"
        cancelText="取消"
        variant="danger"
        isLoading={actions.isDeleting}
      />

      <ConfirmModal
        isOpen={restartConfirmOpen}
        onClose={() => setRestartConfirmOpen(false)}
        onConfirm={() => {
          void handleRestartConfirm()
        }}
        title="确认重启插件"
        message={restartMode === "ide" ? "将重启 IDE 以重新加载插件，是否继续？" : "将重载窗口并重启插件，是否继续？"}
        confirmText="重启"
        cancelText="取消"
        variant="warning"
        isLoading={restarting}
      />

      <ConfirmModal
        isOpen={confirmOpen}
        onClose={cancelInstallConfirm}
        onConfirm={() => {
          void confirmInstall()
        }}
        title="发现新版本"
        message={`检测到新版本 v${confirmVersion ?? ""}，是否立即更新？`}
        confirmText="立即更新"
        cancelText="稍后"
        variant="info"
      />

      {/* Settings panel */}
      <SettingsPanel isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </>
  )
})

CompactHeader.displayName = "CompactHeader"

export { CompactHeader }
