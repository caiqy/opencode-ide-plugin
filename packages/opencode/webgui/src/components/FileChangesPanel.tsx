import { useState } from "react"

interface FileChange {
  path: string
  linesAdded: number
  linesRemoved: number
}

interface FileChangesPanelProps {
  changes?: FileChange[]
}

export function FileChangesPanel({ changes = [] }: FileChangesPanelProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  const totalLines = changes.reduce((sum, c) => sum + c.linesAdded + c.linesRemoved, 0)

  if (changes.length === 0) {
    return null
  }

  return (
    <div className="border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900">
      {/* Collapsed header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full px-4 py-2 flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <span>
          {changes.length} file{changes.length !== 1 ? "s" : ""} changed • {totalLines} line
          {totalLines !== 1 ? "s" : ""}
        </span>
        <svg
          className={`w-3 h-3 transition-transform ${isExpanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded file list */}
      {isExpanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 max-h-40 overflow-y-auto">
          {changes.map((change, idx) => (
            <div
              key={idx}
              className="px-4 py-2 text-xs flex items-center justify-between hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <span className="text-gray-700 dark:text-gray-300 font-mono truncate flex-1">{change.path}</span>
              <div className="flex items-center gap-2 ml-2">
                {change.linesAdded > 0 && (
                  <span className="text-green-600 dark:text-green-400">+{change.linesAdded}</span>
                )}
                {change.linesRemoved > 0 && (
                  <span className="text-red-600 dark:text-red-400">-{change.linesRemoved}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
