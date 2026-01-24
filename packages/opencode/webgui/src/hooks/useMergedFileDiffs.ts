import { useMemo } from "react"
import type { FileDiff } from "@opencode-ai/sdk/client"
import { useProject } from "../state/ProjectContext"
import { toDisplayPath } from "../utils/path"

export function useMergedFileDiffs(diffs: FileDiff[] = [], fallbackFiles: string[] = []) {
  const { worktree } = useProject()

  return useMemo(() => {
    if (fallbackFiles.length === 0) return diffs
    // sessionDiff entries (diffs) are primary
    // Use toDisplayPath to normalize both absolute and relative paths to a consistent format
    const sessionPaths = new Set(diffs.map((d) => toDisplayPath(d.file, worktree)))
    const fallbackOnly = fallbackFiles
      .filter((f) => !sessionPaths.has(toDisplayPath(f, worktree)))
      .map((file) => ({
        file,
        before: "",
        after: "",
        additions: 0,
        deletions: 0,
      }))
    return [...diffs, ...fallbackOnly]
  }, [diffs, fallbackFiles, worktree])
}
