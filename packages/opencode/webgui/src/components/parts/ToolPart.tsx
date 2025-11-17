import { useState, useMemo, useEffect, useRef, useCallback } from "react"
import { CodeBlock } from "../CodeBlock"
import { DiffModal } from "../DiffModal"
import { useOpenFile } from "../../hooks/useOpenFile"
import { useMessages } from "../../state/MessagesContext"
import { useProject } from "../../state/ProjectContext"
import { toDisplayPath } from "../../lib/path"

interface ToolPartProps {
  part: {
    id: string
    type: "tool"
    callID: string
    tool: string
    state: {
      status: "pending" | "running" | "completed" | "error"
      input?: Record<string, unknown>
      output?: string
      title?: string
      error?: string
      metadata?: Record<string, unknown>
      time?: {
        start: number
        end?: number
      }
    }
  }
  sessionID?: string
  messageID?: string
  associatedPatch?: {
    id: string
    type: "patch"
    hash: string
    files: string[]
  }
}

export function ToolPart({ part, sessionID, messageID, associatedPatch }: ToolPartProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [showDiffModal, setShowDiffModal] = useState(false)
  const [showDetails, setShowDetails] = useState(false)
  const [isResponding, setIsResponding] = useState<"once" | "always" | "reject" | null>(null)

  const { getPermissionForCall, respondPermission } = useMessages()
  const permission = useMemo(() => {
    return sessionID ? getPermissionForCall(sessionID, part.callID) : undefined
  }, [getPermissionForCall, sessionID, part.callID])

  const lastPermissionID = useRef<string | null>(null)
  useEffect(() => {
    if (permission && permission.id !== lastPermissionID.current) {
      lastPermissionID.current = permission.id
      setIsExpanded(true)
      setShowDetails(true)
    }
  }, [permission])

  const getStatusIcon = () => {
    switch (part.state.status) {
      case "pending":
        return (
          <svg className="w-3 h-3 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        )
      case "running":
        return (
          <svg className="w-3 h-3 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        )
      case "completed":
        return (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        )
      case "error":
        return (
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        )
    }
  }

  const getStatusClasses = () => {
    if (part.state.status === "error") {
      return "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
    }

    if (part.state.status === "pending") {
      return "bg-[#f9fbff] dark:bg-gray-900 text-gray-600 dark:text-gray-300"
    }

    return "bg-[#fcfdff] dark:bg-gray-900 text-gray-700 dark:text-gray-100"
  }

  const getBorderColor = () => {
    switch (part.state.status) {
      case "error":
        return "border-red-300 dark:border-red-700"
      default:
        return permission ? "border-amber-400 dark:border-amber-600" : "border-[#e4e9f2] dark:border-gray-700"
    }
  }

  // Build tool display name with useful arguments
  const getToolDisplayName = () => {
    const base = part.tool
    const input = part.state.input as Record<string, unknown> | undefined

    // If we have a title, use it with the tool name
    if (part.state.title) {
      let display = `${base}: ${part.state.title}`

      // Special handling for todowrite/todoread to show completed/total
      if ((base === "todowrite" || base === "todoread") && part.state.output) {
        try {
          const todos = JSON.parse(part.state.output)
          if (Array.isArray(todos)) {
            const completed = todos.filter((t: Todo) => t.status === "completed").length
            const total = todos.length
            // Show only total if none completed, otherwise show completed/total
            display = completed === 0 ? `${base}: ${total} todos` : `${base}: ${completed}/${total} todos`
          }
        } catch {
          // If parsing fails, keep original title
        }
      }

      // Add useful extra arguments for specific tools
      if (base === "grep" && input?.include) {
        display += ` (${input.include})`
      }

      return display
    }

    // No title - build from input parameters
    if (!input) return base

    switch (base) {
      case "list":
        return input.path ? `${base}: ${input.path}` : base
      case "glob":
        return input.pattern ? `${base}: ${input.pattern}` : base
      case "grep": {
        let grepDisplay = base
        if (input.pattern) grepDisplay += `: ${input.pattern}`
        if (input.include) grepDisplay += ` (${input.include})`
        return grepDisplay
      }
      case "webfetch":
        return input.url ? `${base}: ${input.url}` : base
      case "edit":
      case "multiedit":
      case "write":
        return input.filePath ? `${base}: ${input.filePath}` : base
      default:
        return base
    }
  }

  const toolName = getToolDisplayName()
  const openFile = useOpenFile()
  const filePath = (part.state.input?.filePath as string | undefined) || undefined
  const { worktree } = useProject()
  const displayPath = filePath ? toDisplayPath(filePath, worktree) : ""
  const handleOpenPath = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (!filePath) return
      openFile({ path: filePath, display: displayPath || filePath })
    },
    [filePath, displayPath, openFile],
  )
  const handlePathKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLSpanElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        handleOpenPath(e)
      }
    },
    [handleOpenPath],
  )
  const showOutput = part.state.status === "completed" && Boolean(part.state.output)
  const showWriteContent =
    part.tool === "write" && part.state.status === "completed" && Boolean(part.state.input?.content)
  const showDiff = part.tool === "edit" && part.state.status === "completed" && Boolean(part.state.metadata?.diff)
  const showError = part.state.status === "error" && Boolean(part.state.error)

  const onRespond = async (response: "once" | "always" | "reject") => {
    if (!permission || !sessionID) return
    setIsResponding(response)
    await respondPermission(sessionID, permission.id, response)
    setIsResponding(null)
    setShowDetails(false)
    setIsExpanded(false)
  }

  return (
    <div className={`my-0.5 border rounded-lg ${getBorderColor()} overflow-hidden bg-[#fbfdff] dark:bg-gray-900`}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${getStatusClasses()} hover:bg-[#f1f4fa] dark:hover:bg-gray-800 transition-colors`}
      >
        {getStatusIcon()}
        {filePath &&
        (part.tool === "read" || part.tool === "write" || part.tool === "edit" || part.tool === "multiedit") ? (
          <span className="text-xs font-medium flex-1">
            {`${part.tool}: `}
            <span
              role="button"
              tabIndex={0}
              onClick={handleOpenPath}
              onKeyDown={handlePathKeyDown}
              className="underline decoration-dotted cursor-pointer hover:opacity-80"
              title={displayPath || filePath}
            >
              {displayPath || filePath}
            </span>
          </span>
        ) : (
          <span className="text-xs font-medium flex-1">{toolName}</span>
        )}
        <svg
          viewBox="0 0 24 24"
          className={`w-3 h-3 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 5l7 7-7 7" />
        </svg>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-[#e4e9f2] dark:border-gray-800 bg-[#fbfdff] dark:bg-gray-950">
          {/* Permission banner */}
          {permission && (
            <div className="px-3 py-2 border-b border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20">
              <div className="text-xs text-amber-800 dark:text-amber-200 font-medium mb-1">
                {permission.type === "doom-loop" ? permission.title : "Permission required to run this tool"}
              </div>
              <div className="flex gap-1.5">
                <button
                  className="px-2 py-1 text-xs rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRespond("once")
                  }}
                  disabled={isResponding !== null}
                >
                  Accept once
                </button>
                <button
                  className="px-2 py-1 text-xs rounded bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRespond("always")
                  }}
                  disabled={isResponding !== null}
                >
                  Always
                </button>
                <button
                  className="ml-auto px-2 py-1 text-xs rounded bg-gray-200 dark:bg-gray-800 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-700 disabled:opacity-50"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRespond("reject")
                  }}
                  disabled={isResponding !== null}
                >
                  Reject
                </button>
              </div>
            </div>
          )}
          {/* Output/Result - FIRST (most important) */}
          {showOutput && (
            <div className="px-3 py-1.5 border-b border-gray-100 dark:border-gray-800">
              <div className="text-[10px] uppercase font-semibold text-gray-500 dark:text-gray-400 mb-1">Output</div>
              <div className="text-xs bg-white dark:bg-gray-900 rounded p-1.5 overflow-x-auto max-h-60 overflow-y-auto">
                {/* Special rendering for specific tools */}
                {part.tool === "bash" && Boolean(part.state.metadata?.output) ? (
                  <pre className="font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                    {String(part.state.metadata?.output)}
                  </pre>
                ) : part.tool === "read" && Boolean(part.state.metadata?.preview) ? (
                  <CodeBlock
                    language={getLanguageFromFilename(part.state.input?.filePath as string)}
                    value={String(part.state.metadata?.preview)}
                  />
                ) : part.tool === "todoread" || part.tool === "todowrite" ? (
                  renderTodoList(part.state.output)
                ) : (
                  <pre className="font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                    {String(part.state.output)}
                  </pre>
                )}
              </div>
            </div>
          )}

          {/* Content preview for write tool */}
          {showWriteContent && (
            <div className="px-3 py-1.5 border-b border-gray-100 dark:border-gray-800">
              <div className="text-[10px] uppercase font-semibold text-gray-500 dark:text-gray-400 mb-1">Content</div>
              <div className="text-xs bg-white dark:bg-gray-900 rounded p-1.5 overflow-x-auto max-h-60 overflow-y-auto">
                <CodeBlock
                  language={getLanguageFromFilename(part.state.input?.filePath as string)}
                  value={String(part.state.input?.content)}
                />
              </div>
            </div>
          )}

          {/* Diff view for edit tool */}
          {showDiff && (
            <div className="px-3 py-1.5 border-b border-gray-100 dark:border-gray-800">
              <div className="text-[10px] uppercase font-semibold text-gray-500 dark:text-gray-400 mb-1">Changes</div>
              <div className="text-xs bg-white dark:bg-gray-900 rounded p-1.5 overflow-x-auto max-h-60 overflow-y-auto">
                <pre className="font-mono text-[11px] whitespace-pre">
                  {String(part.state.metadata?.diff || "")
                    .split("\n")
                    .map((line, i) => {
                      let className = "text-gray-700 dark:text-gray-300"
                      if (line.startsWith("+") && !line.startsWith("+++")) {
                        className = "text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800"
                      }
                      if (line.startsWith("-") && !line.startsWith("---")) {
                        className = "text-gray-700 dark:text-gray-300 bg-gray-200 dark:bg-gray-900"
                      }
                      if (line.startsWith("@@")) {
                        className = "text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800"
                      }
                      return (
                        <div key={i} className={className}>
                          {line || " "}
                        </div>
                      )
                    })}
                </pre>
              </div>
            </div>
          )}

          {/* Associated Patch (for write/edit tools) */}
          {associatedPatch && (part.tool === "write" || part.tool === "edit") && (
            <div className="border-t border-gray-200 dark:border-gray-700">
              {/* File list */}
              <div className="px-3 py-1.5">
                <div className="text-[10px] uppercase font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
                  Modified Files
                </div>
                <div className="space-y-0.5">
                  {associatedPatch.files.map((file) => (
                    <div key={file} className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300">
                      <svg
                        className="w-3 h-3 text-gray-500 dark:text-gray-400 flex-shrink-0"
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
                      <span className="font-mono text-gray-700 dark:text-gray-300">{file}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Patch hash */}
              <div className="px-3 py-1.5 bg-gray-100 dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800">
                <div className="text-[10px] text-gray-500 dark:text-gray-400 font-mono">
                  Patch: {associatedPatch.hash.substring(0, 8)}
                </div>
              </div>

              {/* View Diff button */}
              {sessionID && messageID && (
                <div className="px-3 py-1.5 border-t border-gray-100 dark:border-gray-800">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowDiffModal(true)
                    }}
                    className="w-full px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded hover:bg-gray-100 dark:hover:bg-gray-800/70 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                      />
                    </svg>
                    View Diff
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Error */}
          {showError && (
            <div className="px-3 py-1.5 bg-red-50 dark:bg-red-900/10">
              <div className="text-[10px] uppercase font-semibold text-red-600 dark:text-red-400 mb-1">Error</div>
              <div className="text-xs text-red-700 dark:text-red-300 font-mono">{part.state.error}</div>
            </div>
          )}

          {/* Details toggle (Input + Metadata) */}
          {((part.state.input && Object.keys(part.state.input).length > 0) ||
            (part.state.metadata &&
              Object.keys(part.state.metadata).filter((k) => k !== "output" && k !== "preview").length > 0)) && (
            <div className="border-t border-gray-100 dark:border-gray-800">
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="w-full px-3 py-1.5 flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
              >
                <span className="font-medium">Details</span>
                <svg
                  viewBox="0 0 24 24"
                  className={`w-3 h-3 transition-transform duration-150 ${showDetails ? "rotate-90" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M9 5l7 7-7 7" />
                </svg>
              </button>

              {showDetails && (
                <div className="border-t border-gray-100 dark:border-gray-800">
                  {/* Input arguments */}
                  {part.state.input && Object.keys(part.state.input).length > 0 && (
                    <div className="px-3 py-1.5 border-b border-gray-100 dark:border-gray-800">
                      <div className="text-[10px] uppercase font-semibold text-gray-500 dark:text-gray-400 mb-1">
                        Input
                      </div>
                      <div className="text-xs bg-white dark:bg-gray-900 rounded p-1.5 overflow-x-auto">
                        <pre className="font-mono text-gray-700 dark:text-gray-300">
                          {JSON.stringify(part.state.input, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Metadata */}
                  {part.state.metadata &&
                    Object.keys(part.state.metadata).filter((k) => k !== "output" && k !== "preview").length > 0 && (
                      <div className="px-3 py-1.5">
                        <div className="text-[10px] uppercase font-semibold text-gray-500 dark:text-gray-400 mb-1">
                          Metadata
                        </div>
                        <div className="text-xs bg-white dark:bg-gray-900 rounded p-1.5 overflow-x-auto max-h-40 overflow-y-auto">
                          <pre className="font-mono text-gray-700 dark:text-gray-300">
                            {JSON.stringify(
                              Object.fromEntries(
                                Object.entries(part.state.metadata).filter(([k]) => k !== "output" && k !== "preview"),
                              ),
                              null,
                              2,
                            )}
                          </pre>
                        </div>
                      </div>
                    )}
                </div>
              )}
            </div>
          )}

          {/* Timing */}
          {part.state.time && (
            <div className="px-3 py-1.5 bg-gray-50 dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800">
              <div className="text-[10px] text-gray-500 dark:text-gray-400">
                {part.state.time.end
                  ? `Completed in ${((part.state.time.end - part.state.time.start) / 1000).toFixed(2)}s`
                  : `Started ${new Date(part.state.time.start).toLocaleTimeString()}`}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Diff Modal */}
      {showDiffModal && associatedPatch && sessionID && messageID && (
        <DiffModal
          isOpen={showDiffModal}
          onClose={() => setShowDiffModal(false)}
          sessionID={sessionID}
          messageID={messageID}
          patchHash={associatedPatch.hash}
        />
      )}
    </div>
  )
}

interface Todo {
  id?: string
  content: string
  status: "completed" | "in_progress" | "pending" | "cancelled"
  priority?: "high" | "medium" | "low"
}

function renderTodoList(output?: string) {
  if (!output) return null

  try {
    const todos = JSON.parse(output)
    if (!Array.isArray(todos)) {
      return <pre className="font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{output}</pre>
    }

    const getStatusIcon = (status: string) => {
      switch (status) {
        case "completed":
          return (
            <svg
              className="w-4 h-4 text-green-600 dark:text-green-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          )
        case "in_progress":
          return (
            <svg
              className="w-4 h-4 text-blue-600 dark:text-blue-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          )
        case "cancelled":
          return (
            <svg
              className="w-4 h-4 text-gray-400 dark:text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          )
        default: // pending
          return (
            <svg
              className="w-4 h-4 text-gray-400 dark:text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12a9 9 0 1118 0 9 9 0 01-18 0z"
              />
            </svg>
          )
      }
    }

    const getPriorityBadge = (priority: string) => {
      const colors = {
        high: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300",
        medium: "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300",
        low: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
      }
      return (
        <span
          className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${colors[priority as keyof typeof colors] || colors.low}`}
        >
          {priority}
        </span>
      )
    }

    return (
      <div className="space-y-1.5">
        {todos.map((todo: Todo, index: number) => (
          <div
            key={todo.id || index}
            className="flex items-center gap-2 px-2 py-1.5 rounded bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700"
          >
            <div className="flex-shrink-0">{getStatusIcon(todo.status)}</div>
            <div className="flex-1 min-w-0 flex items-center gap-2">
              <p
                className={`text-xs flex-1 truncate ${todo.status === "completed" ? "line-through text-gray-500 dark:text-gray-500" : "text-gray-700 dark:text-gray-300"}`}
              >
                {todo.content}
              </p>
              {todo.id && (
                <span className="text-[10px] text-gray-400 dark:text-gray-600 font-mono flex-shrink-0">{todo.id}</span>
              )}
              {todo.priority && <div className="flex-shrink-0">{getPriorityBadge(todo.priority)}</div>}
            </div>
          </div>
        ))}
      </div>
    )
  } catch {
    return <pre className="font-mono text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{output}</pre>
  }
}

function getLanguageFromFilename(filename?: string | unknown): string {
  if (typeof filename !== "string") return "text"
  const ext = filename.split(".").pop()?.toLowerCase()
  const languageMap: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    php: "php",
    sh: "bash",
    yaml: "yaml",
    yml: "yaml",
    json: "json",
    xml: "xml",
    html: "html",
    css: "css",
    md: "markdown",
  }
  return languageMap[ext || ""] || "text"
}
