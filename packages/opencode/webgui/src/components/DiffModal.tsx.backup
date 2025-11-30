import { useEffect, useState, useMemo } from "react"
import * as Diff from "diff"
import { sdk } from "../lib/api/sdkClient"
import type { FileDiff } from "@opencode-ai/sdk/client"

function useSessionDiff(sessionID: string, messageID: string, isOpen: boolean) {
  const [diffs, setDiffs] = useState<FileDiff[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return

    const controller = new AbortController()
    const fetchDiff = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const response = await sdk.session.diff({
          path: { id: sessionID },
          query: { messageID },
        })

        if (controller.signal.aborted) return

        if (response.error) {
          const errorMessage =
            typeof response.error === "object" && "message" in response.error
              ? String(response.error.message)
              : "Unknown error"
          setError("Failed to load diff: " + errorMessage)
        } else if (response.data) {
          setDiffs(response.data)
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError("Failed to load diff: " + String(err))
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      }
    }

    fetchDiff()
    return () => controller.abort()
  }, [isOpen, sessionID, messageID])

  return { diffs, isLoading, error }
}

type DiffLine = { content: string; type: "added" | "removed" | "unchanged" | "empty" }

function computeDiffLines(before: string, after: string) {
  const changes = Diff.diffLines(before, after)
  const leftLines: DiffLine[] = []
  const rightLines: DiffLine[] = []

  changes.forEach((change) => {
    const lines = change.value.split("\n").filter((line, i, arr) => i < arr.length - 1 || line !== "")

    if (change.added) {
      lines.forEach((line) => {
        leftLines.push({ content: "", type: "empty" })
        rightLines.push({ content: line, type: "added" })
      })
    } else if (change.removed) {
      lines.forEach((line) => {
        leftLines.push({ content: line, type: "removed" })
        rightLines.push({ content: "", type: "empty" })
      })
    } else {
      lines.forEach((line) => {
        leftLines.push({ content: line, type: "unchanged" })
        rightLines.push({ content: line, type: "unchanged" })
      })
    }
  })

  return { leftLines, rightLines, changes }
}

interface DiffModalProps {
  isOpen: boolean
  onClose: () => void
  sessionID: string
  messageID: string
  patchHash: string
}

export function DiffModal({ isOpen, onClose, sessionID, messageID, patchHash }: DiffModalProps) {
  const { diffs, isLoading, error } = useSessionDiff(sessionID, messageID, isOpen)
  const [viewMode, setViewMode] = useState<"split" | "unified">("split")
  const [selectedFile, setSelectedFile] = useState<number>(0)

  // Reset UI state when diffs change
  useEffect(() => {
    if (diffs.length > 0) {
      setViewMode("split")
      setSelectedFile(0)
    }
  }, [diffs])

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const currentDiff = diffs[selectedFile]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-lg w-full max-w-6xl h-[90vh] flex flex-col border border-gray-200 dark:border-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
          <div className="flex items-center gap-3">
            <svg
              className="w-5 h-5 text-amber-600 dark:text-amber-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">File Diff</h3>
            <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">{patchHash.substring(0, 8)}</span>
          </div>

          <div className="flex items-center gap-2">
            {/* View mode toggle */}
            {!isLoading && diffs.length > 0 && (
              <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded p-0.5">
                <button
                  onClick={() => setViewMode("split")}
                  className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                    viewMode === "split"
                      ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                      : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                  }`}
                  title="Split view"
                >
                  Split
                </button>
                <button
                  onClick={() => setViewMode("unified")}
                  className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                    viewMode === "unified"
                      ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                      : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
                  }`}
                  title="Unified view"
                >
                  Unified
                </button>
              </div>
            )}

            {/* Close button */}
            <button
              onClick={onClose}
              className="p-1 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded"
              title="Close (Esc)"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* File tabs (if multiple files) */}
        {!isLoading && diffs.length > 1 && (
          <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-200 dark:border-gray-800 overflow-x-auto bg-gray-50 dark:bg-gray-950">
            {diffs.map((diff, index) => (
              <button
                key={index}
                onClick={() => setSelectedFile(index)}
                className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap transition-colors ${
                  selectedFile === index
                    ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm"
                    : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-900"
                }`}
                title={diff.file}
              >
                {diff.file.split("/").pop() || diff.file}
              </button>
            ))}
          </div>
        )}

        {/* Content area */}
        <div className="flex-1 overflow-auto">
          {isLoading && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 dark:border-gray-100 mb-2"></div>
                <p className="text-sm text-gray-600 dark:text-gray-400">Loading diff...</p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-full">
              <div className="max-w-md text-center">
                <svg
                  className="w-12 h-12 text-red-500 dark:text-red-400 mx-auto mb-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p className="text-sm text-gray-700 dark:text-gray-300">{error}</p>
              </div>
            </div>
          )}

          {!isLoading && !error && diffs.length === 0 && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <svg
                  className="w-12 h-12 text-gray-400 dark:text-gray-600 mx-auto mb-3"
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
                <p className="text-sm text-gray-600 dark:text-gray-400">No changes found</p>
              </div>
            </div>
          )}

          {!isLoading && !error && currentDiff && (
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
                  <span className="text-sm font-mono text-gray-700 dark:text-gray-300">{currentDiff.file}</span>
                </div>
              </div>

              {/* Diff viewer */}
              {viewMode === "unified" ? (
                <UnifiedDiffView before={currentDiff.before} after={currentDiff.after} />
              ) : (
                <SplitDiffView before={currentDiff.before} after={currentDiff.after} />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-gray-50 dark:bg-gray-950 rounded-b-lg border-t border-gray-200 dark:border-gray-800">
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {!isLoading && diffs.length > 0 && (
                <span>{diffs.length === 1 ? "1 file changed" : `${diffs.length} files changed`}</span>
              )}
            </div>
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Close
            </button>
          </div>
        </div>
      </div>
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
