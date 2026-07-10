import { useMemo } from "react"
import type { SnapshotFileDiff } from "@opencode-ai/sdk/v2/client"
import { useProject } from "../state/ProjectContext"
import { toDisplayPath } from "../utils/path"

export function useMergedFileDiffs(diffs: SnapshotFileDiff[] = [], fallbackFiles: string[] = []) {
  const { worktree } = useProject()

  return useMemo(() => {
    const entries = diffs.filter(
      (diff): diff is SnapshotFileDiff & { file: string } => typeof diff.file === "string" && diff.file.length > 0,
    )
    if (fallbackFiles.length === 0) return entries
    // sessionDiff entries (diffs) are primary
    // Use toDisplayPath to normalize both absolute and relative paths to a consistent format
    const sessionPaths = new Set(entries.map((diff) => toDisplayPath(diff.file, worktree)))
    const fallbackOnly = fallbackFiles
      .filter((f) => !sessionPaths.has(toDisplayPath(f, worktree)))
      .map((file) => ({
        file,
        patch: "",
        status: "modified" as const,
        additions: 0,
        deletions: 0,
      }))
    return [...entries, ...fallbackOnly]
  }, [diffs, fallbackFiles, worktree])
}
