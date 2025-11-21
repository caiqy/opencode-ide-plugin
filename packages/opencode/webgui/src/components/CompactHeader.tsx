import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from "react"
import type { ConnectionState } from "../lib/api/events"
import { useTheme } from "../state/ThemeContext"
import { useSession, isDefaultTitle } from "../state/SessionContext"
import { ConfirmModal } from "./ConfirmModal"
import { SettingsPanel } from "./SettingsPanel"
import { useSessionUsage } from "../hooks/useSessionUsage"

interface CompactHeaderProps {
  connectionState: ConnectionState
  onNewSession: () => void
  isCreatingSession: boolean
  onOpenCommandPalette: () => void
}

const CONNECTION_COLORS: Record<ConnectionState, string> = {
  connecting: "bg-yellow-500",
  connected: "bg-green-500",
  disconnected: "bg-gray-500",
  error: "bg-red-500",
}

const CONNECTION_TOOLTIPS: Record<ConnectionState, string> = {
  connecting: "Connecting...",
  connected: "Connected",
  disconnected: "Disconnected",
  error: "Connection Error",
}

const CompactHeader = forwardRef<
  {
    toggleSessionDropdown: () => void
  },
  CompactHeaderProps
>(({ connectionState, onNewSession, isCreatingSession, onOpenCommandPalette }, ref) => {
  const { theme, toggleTheme } = useTheme()
  const { currentSession, sessions, switchSession, updateSessionTitle, deleteSession } = useSession()

  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState("")
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [selectedSessionIndex, setSelectedSessionIndex] = useState(0)
  const [isSelectMode, setIsSelectMode] = useState(false)
  const [selectedSessions, setSelectedSessions] = useState<Set<string>>(new Set())
  const [showUsageDetails, setShowUsageDetails] = useState(false)
  const usage = useSessionUsage()

  const dropdownRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const sessionListRef = useRef<HTMLDivElement>(null)
  const selectedSessionRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false)
        setEditingSessionId(null)
        setIsSelectMode(false)
        setSelectedSessions(new Set())
      }
    }

    if (isDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside)
      return () => document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [isDropdownOpen])

  // Focus edit input when editing starts
  useEffect(() => {
    if (editingSessionId && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [editingSessionId])

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isDropdownOpen && searchInputRef.current) {
      searchInputRef.current.focus()
      setSelectedSessionIndex(0)
      setIsSelectMode(false)
      setSelectedSessions(new Set())
    }
  }, [isDropdownOpen])

  // Reset selected index when search query changes
  useEffect(() => {
    setSelectedSessionIndex(0)
  }, [searchQuery])

  // Scroll selected session into view
  useEffect(() => {
    if (selectedSessionRef.current) {
      selectedSessionRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      })
    }
  }, [selectedSessionIndex])

  // Expose toggleSessionDropdown method via ref
  useImperativeHandle(
    ref,
    () => ({
      toggleSessionDropdown: () => setIsDropdownOpen((prev) => !prev),
    }),
    [],
  )

  // Filter sessions by search query
  const filteredSessions = sessions.filter((session) => {
    const title = session.title || "Untitled"
    return title.toLowerCase().includes(searchQuery.toLowerCase())
  })

  const handleSessionSelect = async (sessionId: string) => {
    await switchSession(sessionId)
    setIsDropdownOpen(false)
    setSearchQuery("")
  }

  // Handle keyboard navigation for session list
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isDropdownOpen || filteredSessions.length === 0) return

    // Disable keyboard navigation when in select mode
    if (isSelectMode) return

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setSelectedSessionIndex((prev) => Math.min(prev + 1, filteredSessions.length - 1))
    }
    if (e.key === "ArrowUp") {
      e.preventDefault()
      if (selectedSessionIndex === 0) {
        // Move focus to search input
        searchInputRef.current?.focus()
      } else {
        setSelectedSessionIndex((prev) => Math.max(prev - 1, 0))
      }
    }
    if (e.key === "Enter") {
      e.preventDefault()
      if (filteredSessions[selectedSessionIndex]) {
        handleSessionSelect(filteredSessions[selectedSessionIndex].id)
      }
    }
    if (e.key === "Escape") {
      e.preventDefault()
      setIsDropdownOpen(false)
    }
  }

  // Handle session selection for bulk operations
  const handleSessionCheckboxChange = (sessionId: string, checked: boolean) => {
    setSelectedSessions((prev) => {
      const newSet = new Set(prev)
      if (checked) {
        newSet.add(sessionId)
      } else {
        newSet.delete(sessionId)
      }
      return newSet
    })
  }

  const handleEditStart = (sessionId: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingSessionId(sessionId)
    setEditingTitle(currentTitle || "Untitled")
  }

  const handleEditSave = async (sessionId: string) => {
    if (editingTitle.trim() && editingTitle !== (sessions.find((s) => s.id === sessionId)?.title || "Untitled")) {
      await updateSessionTitle(sessionId, editingTitle.trim())
    }
    setEditingSessionId(null)
  }

  const handleEditCancel = () => {
    setEditingSessionId(null)
    setEditingTitle("")
  }

  const handleDeleteStart = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setDeleteConfirm(sessionId)
    setIsDropdownOpen(false)
  }

  const handleBulkDeleteStart = () => {
    setDeleteConfirm("bulk")
    setIsDropdownOpen(false)
  }

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm) return

    setIsDeleting(true)
    let success = true

    if (deleteConfirm === "bulk") {
      // Handle bulk delete
      for (const sessionId of selectedSessions) {
        const result = await deleteSession(sessionId)
        if (!result) {
          success = false
          break
        }
      }

      if (success) {
        setSelectedSessions(new Set())
        setIsSelectMode(false)
      }
    } else {
      // Handle single session delete
      success = await deleteSession(deleteConfirm)
    }

    setIsDeleting(false)

    if (success) {
      setDeleteConfirm(null)
    }
  }

  const currentTitle = currentSession?.title || "Untitled"
  const truncatedTitle = currentTitle.length > 30 ? currentTitle.slice(0, 30) + "..." : currentTitle
  const currentHasDefaultTitle = isDefaultTitle(currentTitle)

  // Format timestamp as YYYY-MM-DD HH:mm
  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, "0")
    const day = String(date.getDate()).padStart(2, "0")
    const hours = String(date.getHours()).padStart(2, "0")
    const minutes = String(date.getMinutes()).padStart(2, "0")
    return `${year}-${month}-${day} ${hours}:${minutes}`
  }

  return (
    <>
      <header className="h-9 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex items-center justify-between px-2 flex-shrink-0 relative">
        {/* Left: Session dropdown */}
        <div className="flex items-center gap-1.5" ref={dropdownRef}>
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
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
          <div className="relative flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300 select-none min-w-0">
            {(() => {
              const pct = Math.min(100, Math.max(0, usage.percentage))
              const color =
                pct <= 40 ? "bg-green-500" : pct <= 60 ? "bg-yellow-500" : pct <= 75 ? "bg-orange-500" : "bg-red-500"
              return (
                <button
                  onClick={() => setShowUsageDetails((v) => !v)}
                  className="flex items-center gap-1.5 group whitespace-nowrap overflow-hidden"
                  title="Show usage details"
                >
                  <div className="w-[80px] h-2.5 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden relative">
                    <div className={`${color} h-3`} style={{ width: `${pct}%` }} />
                    <span className="absolute inset-0 flex items-center justify-center text-[10px] text-gray-900 dark:text-white drop-shadow-sm">
                      {Math.round(pct)}%
                    </span>
                  </div>
                  <span className="tabular-nums">
                    {formatK(usage.contextUsed)}/{formatK(usage.contextLimit)}
                  </span>
                  <span className="tabular-nums">{formatKM(usage.tokens)}</span>
                  <span className="tabular-nums">{formatCost(usage.cost)}</span>
                </button>
              )
            })()}

            {showUsageDetails && (
              <div className="modern-card absolute top-full left-0 mt-1 w-64 z-50 overflow-hidden ring-1 ring-black/5 p-2">
                <div className="max-h-[calc(100vh-200px)] overflow-y-auto py-1">
                  <div className="flex items-center justify-between py-0.5">
                    <span>Context used</span>
                    <span className="tabular-nums">
                      {formatK(usage.contextUsed)}/{formatK(usage.contextLimit)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between py-0.5">
                    <span>Input tokens</span>
                    <span className="tabular-nums">{formatK(usage.breakdown.input)}</span>
                  </div>
                  <div className="flex items-center justify-between py-0.5">
                    <span>Cache write</span>
                    <span className="tabular-nums">{formatK(usage.breakdown.cacheWrite)}</span>
                  </div>
                  <div className="flex items-center justify-between py-0.5">
                    <span>Cache read</span>
                    <span className="tabular-nums">{formatK(usage.breakdown.cacheRead)}</span>
                  </div>
                  <div className="flex items-center justify-between py-0.5">
                    <span>Output tokens</span>
                    <span className="tabular-nums">{formatK(usage.breakdown.output)}</span>
                  </div>
                  <div className="flex items-center justify-between py-0.5">
                    <span>Reasoning tokens</span>
                    <span className="tabular-nums">{formatK(usage.breakdown.reasoning)}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Dropdown menu */}
          {isDropdownOpen && (
            <div className="absolute top-full left-0 right-0 w-full bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shadow-lg z-50 max-h-96 flex flex-col">
              {/* Search input and select mode toggle */}
              <div className="p-2 border-b border-gray-200 dark:border-gray-800">
                <div className="flex gap-2">
                  <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search sessions..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowDown" && filteredSessions.length > 0) {
                        e.preventDefault()
                        setSelectedSessionIndex(0)
                        selectedSessionRef.current?.focus()
                      }
                    }}
                    className="flex-1 px-2 py-1 text-sm bg-gray-50 dark:bg-gray-950 border border-gray-200 dark:border-gray-800 rounded outline-none focus:border-blue-500 dark:focus:border-blue-500 text-gray-900 dark:text-gray-100"
                  />
                  <button
                    onClick={() => setIsSelectMode(!isSelectMode)}
                    className={`px-2 h-[30px] flex items-center justify-center rounded border ${
                      isSelectMode
                        ? "bg-blue-500 text-white border-blue-500"
                        : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-600"
                    }`}
                    title={isSelectMode ? "Cancel selection" : "Select multiple sessions"}
                  >
                    {isSelectMode ? (
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    ) : (
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                        />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Session list */}
              <div className="overflow-y-auto flex-1" ref={sessionListRef}>
                {filteredSessions.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400 text-center">
                    {sessions.length === 0 ? "No sessions yet" : "No matching sessions"}
                  </div>
                ) : (
                  filteredSessions.map((session, index) => {
                    const isActive = session.id === currentSession?.id
                    const isEditing = editingSessionId === session.id
                    const displayTitle = session.title || "Untitled"
                    const hasDefaultTitle = isDefaultTitle(displayTitle)

                    return (
                      <div
                        key={session.id}
                        ref={index === selectedSessionIndex ? selectedSessionRef : null}
                        tabIndex={-1}
                        className={`group px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-between outline-none ${
                          index === selectedSessionIndex && !isSelectMode
                            ? "bg-blue-50 dark:bg-blue-950"
                            : isActive
                              ? "bg-blue-50 dark:bg-blue-950"
                              : ""
                        }`}
                        onClick={() => !isEditing && !isSelectMode && handleSessionSelect(session.id)}
                        onKeyDown={handleKeyDown}
                      >
                        {isEditing ? (
                          <input
                            ref={editInputRef}
                            type="text"
                            value={editingTitle}
                            onChange={(e) => setEditingTitle(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                handleEditSave(session.id)
                              } else if (e.key === "Escape") {
                                handleEditCancel()
                              }
                            }}
                            onBlur={() => handleEditSave(session.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="flex-1 px-1 py-0.5 text-sm bg-white dark:bg-gray-950 border border-blue-500 rounded outline-none text-gray-900 dark:text-gray-100"
                          />
                        ) : (
                          <>
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              {/* Checkbox for selection mode */}
                              {isSelectMode && (
                                <input
                                  type="checkbox"
                                  checked={selectedSessions.has(session.id)}
                                  onChange={(e) => handleSessionCheckboxChange(session.id, e.target.checked)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-3 h-3 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
                                />
                              )}

                              {isActive && !isSelectMode && (
                                <svg
                                  className="w-3 h-3 text-blue-600 dark:text-blue-400 flex-shrink-0"
                                  fill="currentColor"
                                  viewBox="0 0 20 20"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              )}
                              <span
                                className={`truncate ${
                                  hasDefaultTitle
                                    ? "text-gray-500 dark:text-gray-500 italic"
                                    : isActive && !isSelectMode
                                      ? "text-blue-900 dark:text-blue-100 font-medium"
                                      : "text-gray-700 dark:text-gray-300"
                                }`}
                              >
                                {displayTitle}
                              </span>
                            </div>

                            {/* Edit and Delete buttons (hidden in select mode) */}
                            {!isSelectMode && (
                              <div className="ml-auto flex items-center gap-2 flex-shrink-0">
                                {/* Timestamp (hidden on hover or when active) */}
                                <span
                                  className={`text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap ${isActive ? "hidden" : "block group-hover:hidden"}`}
                                >
                                  {formatTimestamp(session.time.created)}
                                </span>

                                {/* Edit and Delete buttons (visible on hover or when active) */}
                                <div className={`${isActive ? "flex" : "hidden group-hover:flex"} items-center gap-1`}>
                                  <button
                                    onClick={(e) => handleEditStart(session.id, displayTitle, e)}
                                    className="p-1 text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400"
                                    title="Edit title"
                                  >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                                      />
                                    </svg>
                                  </button>
                                  <button
                                    onClick={(e) => handleDeleteStart(session.id, e)}
                                    className="p-1 text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                                    title="Delete session"
                                  >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                      />
                                    </svg>
                                  </button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })
                )}
              </div>

              {/* Bulk delete button (shown in select mode when sessions are selected) */}
              {isSelectMode && selectedSessions.size > 0 && (
                <div className="p-2 border-t border-gray-200 dark:border-gray-800">
                  <button
                    onClick={handleBulkDeleteStart}
                    className="w-full px-3 py-2 text-sm bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Delete {selectedSessions.size} Session{selectedSessions.size > 1 ? "s" : ""}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Connection status, theme toggle, and new session button */}
        <div className="flex items-center gap-1">
          {/* Connection status dot */}
          <div
            className={`w-2 h-2 rounded-full ${CONNECTION_COLORS[connectionState]} ${
              connectionState === "connecting" || connectionState === "error" ? "animate-pulse" : ""
            }`}
            title={CONNECTION_TOOLTIPS[connectionState]}
          />

          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="modern-icon-button w-7 h-7 flex items-center justify-center"
            title={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          >
            {theme === "light" ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
            )}
          </button>

          {/* Command Palette button */}
          <button
            onClick={onOpenCommandPalette}
            className="modern-icon-button w-7 h-7 flex items-center justify-center"
            title="Command Palette (Cmd/Ctrl+K)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </button>

          {/* Settings button */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="modern-icon-button w-7 h-7 flex items-center justify-center"
            title="Settings (Cmd/Ctrl+,)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          {/* New session button */}
          <button
            onClick={onNewSession}
            disabled={isCreatingSession}
            className="w-5 h-5 flex items-center justify-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
            title="New Session (Cmd/Ctrl+N)"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </header>

      {/* Delete confirmation modal */}
      <ConfirmModal
        isOpen={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        onConfirm={handleDeleteConfirm}
        title={deleteConfirm === "bulk" ? "Delete Sessions" : "Delete Session"}
        message={
          deleteConfirm === "bulk"
            ? `Are you sure you want to delete ${selectedSessions.size} session${selectedSessions.size > 1 ? "s" : ""}? This action cannot be undone.`
            : "Are you sure you want to delete this session? This action cannot be undone."
        }
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        isLoading={isDeleting}
      />

      {/* Settings panel */}
      <SettingsPanel isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </>
  )
})

function formatK(n: number) {
  if (!n) return "0"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(Math.floor(n))
}

function formatKM(n: number) {
  if (!n) return "0"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`
  return String(Math.floor(n))
}

function formatCost(n: number) {
  return `$${(n || 0).toFixed(2)}`
}

CompactHeader.displayName = "CompactHeader"

export { CompactHeader }
