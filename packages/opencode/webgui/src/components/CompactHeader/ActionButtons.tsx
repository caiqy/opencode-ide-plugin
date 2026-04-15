import { useState, useRef, useEffect } from "react"

interface ActionButtonsProps {
  theme: string
  toggleTheme: () => void
  onOpenCommandPalette: () => void
  onOpenConfigFile: () => void
  displayVersion?: string
  isCheckingForUpdates?: boolean
  onCheckForUpdates?: () => void
  canRestart?: boolean
  onRestart?: () => void
  onOpenSettings: () => void
  onNewSession: () => void
  onToggleHistory: () => void
  isCreatingSession: boolean
  isShared: boolean
  isSharing: boolean
  onToggleShare: () => void
  menuOpen?: boolean
  onMenuOpenChange?: (open: boolean) => void
}

export function ActionButtons({
  theme,
  toggleTheme,
  onOpenCommandPalette,
  onOpenConfigFile,
  displayVersion = __APP_VERSION__,
  isCheckingForUpdates = false,
  onCheckForUpdates,
  canRestart = false,
  onRestart,
  onOpenSettings,
  onNewSession,
  onToggleHistory,
  isCreatingSession,
  isShared,
  isSharing,
  onToggleShare,
  menuOpen,
  onMenuOpenChange,
}: ActionButtonsProps) {
  const [local, setLocal] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const open = menuOpen ?? local

  const setOpen = (value: boolean) => {
    if (onMenuOpenChange) onMenuOpenChange(value)
    if (!onMenuOpenChange) setLocal(value)
  }

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }

    if (open) {
      document.addEventListener("mousedown", handleClickOutside)
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [open, onMenuOpenChange])

  const handleMenuItemClick = (action: () => void) => {
    action()
    setOpen(false)
  }

  return (
    <div className="flex items-center gap-1">
      {/* New session button */}
      <button
        onClick={onNewSession}
        disabled={isCreatingSession}
        className="w-5 h-5 flex items-center justify-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
        title="新建会话（Cmd/Ctrl+N）"
        data-tip="新建会话（Cmd/Ctrl+N）"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>

      <button
        onClick={onToggleHistory}
        className="w-5 h-5 flex items-center justify-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
        title="历史会话"
        data-tip="历史会话"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      </button>

      {/* More menu button */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setOpen(!open)}
          className="w-5 h-5 flex items-center justify-center text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
          title="更多选项"
          data-tip="更多选项"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
            />
          </svg>
        </button>

        {/* Dropdown menu */}
        {open && (
          <div className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 py-1">
            {/* Theme toggle */}
            <button
              onClick={() => handleMenuItemClick(toggleTheme)}
              className="w-full px-3 py-2 text-xs text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
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
              <span>{theme === "light" ? "深色模式" : "浅色模式"}</span>
            </button>

            {/* Command Palette */}
            <button
              onClick={() => handleMenuItemClick(onOpenCommandPalette)}
              className="w-full px-3 py-2 text-xs text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              <span>命令面板</span>
              <span className="ml-auto text-gray-400 dark:text-gray-500">⌘K</span>
            </button>

            {/* Config File */}
            <button
              onClick={() => handleMenuItemClick(onOpenConfigFile)}
              className="w-full px-3 py-2 text-xs text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              <span>配置文件</span>
            </button>

            {canRestart && onRestart && (
              <button
                onClick={() => handleMenuItemClick(onRestart)}
                className="w-full px-3 py-2 text-xs text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                <span>重启插件</span>
              </button>
            )}

            {/* Settings */}
            <button
              onClick={() => handleMenuItemClick(onOpenSettings)}
              className="w-full px-3 py-2 text-xs text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              <span>设置</span>
              <span className="ml-auto text-gray-400 dark:text-gray-500">⌘,</span>
            </button>

            <div className="my-1 h-px bg-gray-200 dark:bg-gray-700" />

            {/* Share/Unshare */}
            <button
              onClick={() => handleMenuItemClick(onToggleShare)}
              disabled={isSharing}
              className="w-full px-3 py-2 text-xs text-left text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isShared ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                  />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                  />
                </svg>
              )}
              <span>{isShared ? "取消分享会话" : "分享会话"}</span>
            </button>

            <div className="my-1 h-px bg-gray-200 dark:bg-gray-700" />

            {/* Version */}
            <div className="px-3 py-1.5 text-xs text-gray-700 dark:text-gray-300 flex items-center justify-center gap-2 select-none">
              <span>v{displayVersion}</span>
              {onCheckForUpdates ? (
                <button
                  onClick={onCheckForUpdates}
                  disabled={isCheckingForUpdates}
                  className="flex h-4 w-4 items-center justify-center text-gray-500 transition hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-100"
                  title="检查更新"
                  data-tip="检查更新"
                >
                  <svg
                    className={`h-3.5 w-3.5 ${isCheckingForUpdates ? "animate-spin" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
