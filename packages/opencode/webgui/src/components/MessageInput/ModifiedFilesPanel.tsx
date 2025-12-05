import { useCallback, type KeyboardEvent } from "react"
import { useOpenFile } from "../../hooks/useOpenFile"
import { normalizePath } from "../../utils/path"

interface ModifiedFilesListProps {
  files: string[]
}

export function ModifiedFilesList({ files }: ModifiedFilesListProps) {
  const openFile = useOpenFile()

  const handleFileClick = useCallback(
    (path: string) => {
      openFile({ path })
    },
    [openFile],
  )

  const handleKeyDown = useCallback(
    (path: string) => (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault()
        handleFileClick(path)
      }
    },
    [handleFileClick],
  )

  return (
    <div className="flex flex-wrap gap-1">
      {files.map((path) => (
        <span
          key={path}
          role="button"
          tabIndex={0}
          onClick={() => handleFileClick(path)}
          onKeyDown={handleKeyDown(path)}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-mono bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-900/60"
          title={path}
        >
          {normalizePath(path).split("/").pop()}
        </span>
      ))}
    </div>
  )
}
