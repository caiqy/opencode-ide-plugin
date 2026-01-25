import { useMemo } from "react"
import type { FileDiff } from "@opencode-ai/sdk/client"
import { useOpenFile } from "../hooks/useOpenFile"
import { useProject } from "../state/ProjectContext"
import { normalizePath, toDisplayPath } from "../utils/path"
import { useMergedFileDiffs } from "../hooks/useMergedFileDiffs"

interface FileChangesPanelProps {
  diffs?: FileDiff[]
  fallbackFiles?: string[]
}

export function FileChangesPanel({ diffs = [], fallbackFiles = [] }: FileChangesPanelProps) {
  const openFile = useOpenFile()
  const { worktree } = useProject()
  const mergedDiffs = useMergedFileDiffs(diffs, fallbackFiles)

  const { modified, deleted, totalAdditions, totalDeletions, netChange } = useMemo(() => {
    const sortByBasename = (a: FileDiff, b: FileDiff) => {
      const aPath = normalizePath(a.file)
      const bPath = normalizePath(b.file)
      const aBasename = (aPath.split("/").pop() || aPath).toLowerCase()
      const bBasename = (bPath.split("/").pop() || bPath).toLowerCase()
      const nameCompare = aBasename.localeCompare(bBasename)
      if (nameCompare !== 0) return nameCompare
      return aPath.localeCompare(bPath)
    }

    const modifiedEntries = mergedDiffs.filter((diff) => diff.after != null).sort(sortByBasename)
    const deletedEntries = mergedDiffs.filter((diff) => diff.after == null).sort(sortByBasename)
    const totals = mergedDiffs.reduce(
      (sum, diff) => {
        sum.additions += diff.additions
        sum.deletions += diff.deletions
        return sum
      },
      { additions: 0, deletions: 0 },
    )
    return {
      modified: modifiedEntries,
      deleted: deletedEntries,
      totalAdditions: totals.additions,
      totalDeletions: totals.deletions,
      netChange: totals.additions - totals.deletions,
    }
  }, [mergedDiffs])

  if (mergedDiffs.length === 0) {
    return null
  }

  return (
    <div className="bg-gray-50 dark:bg-gray-900">
      {/* File list */}
      <div className="max-h-40 overflow-y-auto">
        <div className="px-3 py-1.5 text-xs text-gray-600 dark:text-gray-400 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>
            {mergedDiffs.length} file{mergedDiffs.length !== 1 ? "s" : ""}
          </span>
          <span>
            {modified.length} modified • {deleted.length} deleted
          </span>
          {totalAdditions > 0 && <span className="text-green-600 dark:text-green-400">+{totalAdditions}</span>}
          {totalDeletions > 0 && <span className="text-red-600 dark:text-red-400">-{totalDeletions}</span>}
          <span className="text-gray-500 dark:text-gray-500">
            net {netChange >= 0 ? "+" : ""}
            {netChange}
          </span>
        </div>
        {modified.length > 0 && (
          <div className="px-3 py-1.5 flex flex-wrap items-center gap-1.5">
            {modified.map((diff) => {
              const displayPath = toDisplayPath(diff.file, worktree) || normalizePath(diff.file)
              const baseName = displayPath.split("/").pop() || displayPath
              return (
                <span
                  key={diff.file}
                  role="button"
                  tabIndex={0}
                  onClick={() => openFile({ path: diff.file, display: displayPath || diff.file })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      openFile({ path: diff.file, display: displayPath || diff.file })
                    }
                  }}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-mono bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-900/60"
                  title={displayPath || diff.file}
                  data-tip={displayPath || diff.file}
                >
                  {baseName}
                  {diff.additions > 0 && (
                    <span className="text-green-600 dark:text-green-400 text-[10px]">+{diff.additions}</span>
                  )}
                  {diff.deletions > 0 && (
                    <span className="text-red-600 dark:text-red-400 text-[10px]">-{diff.deletions}</span>
                  )}
                </span>
              )
            })}
          </div>
        )}

        {deleted.length > 0 && (
          <div className="border-t border-gray-200 dark:border-gray-800 px-3 py-1.5 flex flex-wrap items-center gap-1.5">
            {deleted.map((diff) => {
              const displayPath = toDisplayPath(diff.file, worktree) || normalizePath(diff.file)
              const baseName = displayPath.split("/").pop() || displayPath
              return (
                <span
                  key={diff.file}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-mono bg-gray-100 dark:bg-gray-800/50 text-gray-500 dark:text-gray-500 rounded line-through"
                  title={displayPath || diff.file}
                  data-tip={displayPath || diff.file}
                >
                  {baseName}
                  {diff.additions > 0 && (
                    <span className="text-green-600 dark:text-green-400 text-[10px] no-underline">
                      +{diff.additions}
                    </span>
                  )}
                  {diff.deletions > 0 && (
                    <span className="text-red-600 dark:text-red-400 text-[10px] no-underline">-{diff.deletions}</span>
                  )}
                </span>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
