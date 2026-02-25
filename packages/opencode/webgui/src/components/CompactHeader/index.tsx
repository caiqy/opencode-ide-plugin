import { useState, useRef, useEffect, forwardRef, useImperativeHandle, useCallback } from "react"
import type { ConnectionState } from "../../lib/api/events"
import { useTheme } from "../../state/ThemeContext"
import { useSession } from "../../state/SessionContext"
import { ConfirmModal } from "../ConfirmModal"
import { SettingsPanel } from "../SettingsPanel"
import { useSessionDropdown } from "./hooks/useSessionDropdown"
import { useSessionActions } from "./hooks/useSessionActions"
import { StatusIndicator } from "./StatusIndicator"
import { ActionButtons } from "./ActionButtons"
import { SessionDropdown } from "./SessionDropdown"
import { TabBar } from "./TabBar"
import { HEADER_RIGHT_GAP } from "./utils"
import { sdk } from "../../lib/api/sdkClient"
import { useToast } from "../../state/ToastContext"
import { useTabStore } from "../../state/tabStore"

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
    updateSessionTitle,
    deleteSession,
    isLoading,
  } = useSession()
  const tabStore = useTabStore()
  const toast = useToast()

  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const [sharingSessionId, setSharingSessionId] = useState<string | null>(null)
  const prevSessionId = useRef<string | null>(null)
  const sessionsEverLoaded = useRef(false)
  if (isLoading) sessionsEverLoaded.current = true

  const isShared = !!currentSession?.share?.url

  const handleToggleShare = useCallback(async () => {
    if (!currentSession || currentSession.id.startsWith("virtual-")) return

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

  // Session dropdown management
  const dropdown = useSessionDropdown(sessions)

  // Session actions (edit, delete)
  const actions = useSessionActions({
    sessions,
    updateSessionTitle,
    deleteSession,
  })

  // Expose toggleSessionDropdown method via ref
  useImperativeHandle(
    ref,
    () => ({
      toggleSessionDropdown: dropdown.toggleDropdown,
    }),
    [dropdown.toggleDropdown],
  )

  const handleSessionSelect = useCallback(
    async (sessionId: string) => {
      const prev = tabStore.activeTab
      const existed = tabStore.openTabs.includes(sessionId)
      tabStore.openTab(sessionId)
      await switchSession(sessionId)
        .then(() => {
          dropdown.closeDropdown()
        })
        .catch(() => {
          if (!existed) tabStore.removeTab(sessionId)
          if (prev && prev !== sessionId) tabStore.setActiveTab(prev)
          toast.showToast("切换会话失败", { variant: "error" })
        })
    },
    [dropdown, switchSession, tabStore, toast],
  )

  const handleTabActivate = useCallback(
    async (sessionId: string) => {
      const prev = tabStore.activeTab
      tabStore.setActiveTab(sessionId)
      await switchSession(sessionId).catch(() => {
        if (prev && prev !== sessionId) tabStore.setActiveTab(prev)
        toast.showToast("切换会话失败", { variant: "error" })
      })
    },
    [switchSession, tabStore, toast],
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

      tabStore.closeTab(sessionId)

      if (activeTab) {
        await switchSession(activeTab)
        return
      }

      onNewSession()
    },
    [onNewSession, switchSession, tabStore],
  )

  const handleCloseOtherTabs = useCallback(
    async (sessionId: string) => {
      tabStore.closeOtherTabs(sessionId)
      await switchSession(sessionId)
    },
    [switchSession, tabStore],
  )

  const handleCloseTabsToRight = useCallback(
    async (sessionId: string) => {
      const idx = tabStore.openTabs.indexOf(sessionId)
      if (idx < 0) return
      const openTabs = tabStore.openTabs.slice(0, idx + 1)
      const activeTab = openTabs.includes(tabStore.activeTab) ? tabStore.activeTab : sessionId

      tabStore.closeTabsToRight(sessionId)
      await switchSession(activeTab)
    },
    [switchSession, tabStore],
  )

  const handleTabDelete = useCallback(
    (sessionId: string) => {
      actions.setDeleteConfirm(sessionId)
    },
    [actions],
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
    if (!tabStore.loaded) return
    if (tabStore.openTabs.length > 0) return

    if (currentSession?.id) {
      tabStore.openTab(currentSession.id)
      return
    }

    onNewSession()
  }, [currentSession?.id, onNewSession, tabStore])

  useEffect(() => {
    if (!tabStore.loaded) return
    if (!currentSession?.id) return
    if (tabStore.openTabs.includes(currentSession.id)) return
    tabStore.openTab(currentSession.id)
  }, [currentSession?.id, tabStore])

  useEffect(() => {
    const prev = prevSessionId.current
    const next = currentSession?.id || null
    if (prev && next && prev !== next && prev.startsWith("virtual-") && !next.startsWith("virtual-")) {
      tabStore.replaceTab(prev, next)
    }
    prevSessionId.current = next
  }, [currentSession?.id, tabStore])

  useEffect(() => {
    if (!tabStore.loaded || !sessionsEverLoaded.current || isLoading) return
    tabStore.pruneTabs(new Set(sessions.map((s) => s.id)))
  }, [sessions, tabStore.loaded, tabStore.openTabs, tabStore.pruneTabs, isLoading])

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
          <StatusIndicator connectionState={connectionState} />
          <ActionButtons
            theme={theme}
            toggleTheme={toggleTheme}
            onOpenCommandPalette={onOpenCommandPalette}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onNewSession={onNewSession}
            onToggleHistory={dropdown.toggleDropdown}
            isCreatingSession={isCreatingSession}
            isShared={isShared}
            isSharing={isSharing}
            onToggleShare={handleToggleShare}
          />

          <SessionDropdown
            sessions={sessions}
            currentSessionId={currentSession?.id}
            filteredSessions={dropdown.filteredSessions}
            isDropdownOpen={dropdown.isDropdownOpen}
            isSelectMode={dropdown.isSelectMode}
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
            onToggleShare={handleToggleShareSession}
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

      {/* Settings panel */}
      <SettingsPanel isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </>
  )
})

CompactHeader.displayName = "CompactHeader"

export { CompactHeader }
