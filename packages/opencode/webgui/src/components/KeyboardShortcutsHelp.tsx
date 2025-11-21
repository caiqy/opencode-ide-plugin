import { KEYBOARD_SHORTCUTS } from "../config/shortcuts"

interface KeyboardShortcutsHelpProps {
  isOpen: boolean
  onClose: () => void
}

export function KeyboardShortcutsHelp({ isOpen, onClose }: KeyboardShortcutsHelpProps) {
  if (!isOpen) return null

  const categories = Array.from(new Set(KEYBOARD_SHORTCUTS.map((s) => s.category)))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-help-title"
    >
      <div
        className="modern-card max-h-[80vh] w-full max-w-2xl overflow-y-auto p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-2 flex items-center justify-between">
          <h2 id="shortcuts-help-title" className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Keyboard Shortcuts
          </h2>
          <button onClick={onClose} className="modern-icon-button" aria-label="Close">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Shortcuts by category */}
        <div className="space-y-4">
          {categories.map((category) => {
            const categoryShortcuts = KEYBOARD_SHORTCUTS.filter((s) => s.category === category)
            return (
              <div key={category}>
                <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {category}
                </h3>
                <div className="space-y-2">
                  {categoryShortcuts.map((shortcut, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between rounded border border-gray-200 bg-gray-50 px-3 py-1.5 dark:border-gray-800 dark:bg-gray-800/50"
                    >
                      <span className="text-sm text-gray-900 dark:text-gray-100">{shortcut.description}</span>
                      <div className="flex gap-1">
                        {shortcut.keys.map((key, keyIdx) => (
                          <kbd
                            key={keyIdx}
                            className="rounded border border-gray-300 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-gray-700 shadow-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
                          >
                            {key}
                          </kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* Footer note */}
        <div className="mt-4 rounded border border-blue-200 bg-blue-50 p-2 dark:border-blue-900 dark:bg-blue-950/30">
          <p className="text-sm text-blue-800 dark:text-blue-200">
            <strong>Tip:</strong> Use{" "}
            <kbd className="rounded border border-blue-300 bg-white px-1.5 py-0.5 text-xs font-semibold dark:border-blue-700 dark:bg-blue-900">
              ?
            </kbd>{" "}
            to quickly access this help dialog anytime.
          </p>
        </div>
      </div>
    </div>
  )
}
