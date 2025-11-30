import { useMemo } from "react"
import { computeDiffLines } from "./utils"

interface DiffViewerProps {
  before: string
  after: string
  viewMode: "split" | "unified"
  fileName: string
}

export function DiffViewer({ before, after, viewMode, fileName }: DiffViewerProps) {
  return (
    <div className="p-4">
      {/* File path header */}
      <div className="mb-3 pb-2 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <svg
            className="w-4 h-4 text-gray-500 dark:text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
          <span className="text-sm font-mono text-gray-700 dark:text-gray-300">{fileName}</span>
        </div>
      </div>

      {/* Diff content */}
      {viewMode === "unified" ? (
        <UnifiedDiffView before={before} after={after} />
      ) : (
        <SplitDiffView before={before} after={after} />
      )}
    </div>
  )
}

// Unified diff view component
function UnifiedDiffView({ before, after }: { before: string; after: string }) {
  const { changes } = useMemo(() => computeDiffLines(before, after), [before, after])

  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded overflow-hidden font-mono text-xs">
      {changes.map((change, index) => {
        const lines = change.value.split("\n").filter((line, i, arr) => i < arr.length - 1 || line !== "")

        return lines.map((line, lineIndex) => {
          const bgClass = change.added
            ? "bg-green-100 dark:bg-green-900/30"
            : change.removed
              ? "bg-red-100 dark:bg-red-900/30"
              : "bg-white dark:bg-gray-950"

          const textClass = change.added
            ? "text-green-800 dark:text-green-300"
            : change.removed
              ? "text-red-800 dark:text-red-300"
              : "text-gray-700 dark:text-gray-300"

          const prefix = change.added ? "+" : change.removed ? "-" : " "

          return (
            <div key={`${index}-${lineIndex}`} className={`flex ${bgClass}`}>
              <span
                className={`px-3 py-0.5 text-gray-500 dark:text-gray-400 select-none min-w-[3rem] text-right border-r border-gray-200 dark:border-gray-800`}
              >
                {prefix}
              </span>
              <pre className={`px-3 py-0.5 flex-1 ${textClass} overflow-x-auto`}>{line || " "}</pre>
            </div>
          )
        })
      })}
    </div>
  )
}

// Split diff view component
function SplitDiffView({ before, after }: { before: string; after: string }) {
  const { leftLines, rightLines } = useMemo(() => computeDiffLines(before, after), [before, after])

  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded overflow-hidden font-mono text-xs grid grid-cols-2 divide-x divide-gray-200 dark:divide-gray-800">
      {/* Left side (before) */}
      <div>
        {leftLines.map((line, index) => {
          const bgClass =
            line.type === "removed"
              ? "bg-red-100 dark:bg-red-900/30"
              : line.type === "empty"
                ? "bg-gray-50 dark:bg-gray-900/50"
                : "bg-white dark:bg-gray-950"

          const textClass =
            line.type === "removed" ? "text-red-800 dark:text-red-300" : "text-gray-700 dark:text-gray-300"

          return (
            <div key={index} className={`flex ${bgClass}`}>
              <span className="px-3 py-0.5 text-gray-500 dark:text-gray-400 select-none min-w-[3rem] text-right border-r border-gray-200 dark:border-gray-800">
                {line.type !== "empty" ? index + 1 : ""}
              </span>
              <pre className={`px-3 py-0.5 flex-1 ${textClass} overflow-x-auto`}>{line.content || " "}</pre>
            </div>
          )
        })}
      </div>

      {/* Right side (after) */}
      <div>
        {rightLines.map((line, index) => {
          const bgClass =
            line.type === "added"
              ? "bg-green-100 dark:bg-green-900/30"
              : line.type === "empty"
                ? "bg-gray-50 dark:bg-gray-900/50"
                : "bg-white dark:bg-gray-950"

          const textClass =
            line.type === "added" ? "text-green-800 dark:text-green-300" : "text-gray-700 dark:text-gray-300"

          return (
            <div key={index} className={`flex ${bgClass}`}>
              <span className="px-3 py-0.5 text-gray-500 dark:text-gray-400 select-none min-w-[3rem] text-right border-r border-gray-200 dark:border-gray-800">
                {line.type !== "empty" ? index + 1 : ""}
              </span>
              <pre className={`px-3 py-0.5 flex-1 ${textClass} overflow-x-auto`}>{line.content || " "}</pre>
            </div>
          )
        })}
      </div>
    </div>
  )
}
