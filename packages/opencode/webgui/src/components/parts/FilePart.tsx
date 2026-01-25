import { useCallback, type KeyboardEvent } from "react"
import { useOpenFile } from "../../hooks/useOpenFile"

interface FilePartProps {
  part: {
    id: string
    type: "file"
    mime: string
    filename?: string
    url: string
    source?: {
      type: "file" | "symbol"
      text: {
        value: string
        start: number
        end: number
      }
      path: string
      range?: {
        start: { line: number; character: number }
        end: { line: number; character: number }
      }
      name?: string
      kind?: number
    }
  }
}

export function FilePart({ part }: FilePartProps) {
  const openFile = useOpenFile()
  const isSymbol = part.source?.type === "symbol"
  const displayName = isSymbol && part.source?.name ? part.source.name : part.filename || part.source?.path || "file"
  const effectivePath = part.source?.path || part.filename || part.url
  const range = part.source?.range

  const handleOpen = useCallback(() => {
    if (!effectivePath) return
    openFile({
      path: effectivePath,
      display: displayName,
      range,
    })
  }, [displayName, effectivePath, openFile, range])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLSpanElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        handleOpen()
      }
    },
    [handleOpen],
  )

  const getFileIcon = () => {
    if (isSymbol) {
      return (
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
          />
        </svg>
      )
    }
    return (
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
    )
  }

  return (
    <span
      className="inline-flex items-center gap-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded px-1.5 py-0.5 text-xs font-medium cursor-pointer hover:bg-blue-200/80 dark:hover:bg-blue-900/60"
      role="button"
      tabIndex={0}
      onClick={handleOpen}
      onKeyDown={handleKeyDown}
      title={part.source?.path || part.filename}
      data-tip={part.source?.path || part.filename}
    >
      {getFileIcon()}
      <span className="font-mono">{displayName}</span>
      {isSymbol && part.source?.range && (
        <span className="text-[10px] opacity-75">:{part.source.range.start.line + 1}</span>
      )}
    </span>
  )
}
