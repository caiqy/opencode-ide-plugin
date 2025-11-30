import { useState, forwardRef, useImperativeHandle } from "react"
import type { ConnectionState } from "../../lib/api/events"
import { useTheme } from "../../state/ThemeContext"
import { useSession, isDefaultTitle } from "../../state/SessionContext"
import { useSessionUsage } from "../../hooks/useSessionUsage"
import { ConfirmModal } from "../ConfirmModal"
import { SettingsPanel } from "../SettingsPanel"
import { useSessionDropdown } from "./hooks/useSessionDropdown"
import { useSessionActions } from "./hooks/useSessionActions"
import { StatusIndicator } from "./StatusIndicator"
import { ActionButtons } from "./ActionButtons"
import { UsageDisplay } from "./UsageDisplay"
import { SessionDropdown } from "./SessionDropdown"

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
  const { currentSession, sessions, switchSession, updateSessionTitle, deleteSession } = useSession()
  const usage = useSessionUsage()

  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

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

  const handleSessionSelect = async (sessionId: string) => {
    await switchSession(sessionId)
    dropdown.closeDropdown()
  }

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

  const currentTitle = currentSession?.title || "Untitled"
  const truncatedTitle = currentTitle.length > 30 ? currentTitle.slice(0, 30) + "..." : currentTitle
  const currentHasDefaultTitle = isDefaultTitle(currentTitle)

  return (
    <>
      <header className="h-9 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex items-center justify-between px-2 flex-shrink-0 relative">
        {/* Left: Session dropdown */}
        <div className="flex items-center gap-1.5" ref={dropdown.dropdownRef}>
          <button
            onClick={dropdown.toggleDropdown}
            className={`flex items-center gap-1 text-sm hover:text-gray-900 dark:hover:text-gray-100 ${
              currentHasDefaultTitle ? "text-gray-500 dark:text-gray-500 italic" : "text-gray-700 dark:text-gray-300"
            }`}
            title={currentTitle}
          >
            <span>{currentSession ? truncatedTitle : "No Session"}</span>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Usage summary in header */}
          <UsageDisplay usage={usage} />

          {/* Dropdown menu */}
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
          />
        </div>

        {/* Right: Connection status, theme toggle, and new session button */}
        <div className="flex items-center gap-1">
          <StatusIndicator connectionState={connectionState} />
          <ActionButtons
            theme={theme}
            toggleTheme={toggleTheme}
            onOpenCommandPalette={onOpenCommandPalette}
            onOpenSettings={() => setIsSettingsOpen(true)}
            onNewSession={onNewSession}
            isCreatingSession={isCreatingSession}
          />
        </div>
      </header>

      {/* Delete confirmation modal */}
      <ConfirmModal
        isOpen={!!actions.deleteConfirm}
        onClose={actions.handleDeleteCancel}
        onConfirm={handleDeleteConfirm}
        title={actions.deleteConfirm === "bulk" ? "Delete Sessions" : "Delete Session"}
        message={
          actions.deleteConfirm === "bulk"
            ? `Are you sure you want to delete ${dropdown.selectedSessions.size} session${dropdown.selectedSessions.size > 1 ? "s" : ""}? This action cannot be undone.`
            : "Are you sure you want to delete this session? This action cannot be undone."
        }
        confirmText="Delete"
        cancelText="Cancel"
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
