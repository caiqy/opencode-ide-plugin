import type { ReactElement } from "react"

const TOOL_LABELS: Record<string, string> = {
  bash: "执行命令",
  read: "查看",
  write: "写入",
  edit: "编辑",
  multiedit: "批量编辑",
  apply_patch: "文件补丁",
  list: "浏览目录",
  glob: "路径匹配",
  grep: "文本查找",
  webfetch: "抓取网页",
  todoread: "查看任务列表",
  todowrite: "更新任务列表",
}

export function getToolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool
}

export function getLanguageFromFilename(filename?: string | unknown): string {
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

export function getStatusIcon(status: "pending" | "running" | "completed" | "error"): ReactElement {
  switch (status) {
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

export function getStatusClasses(status: "pending" | "running" | "completed" | "error") {
  if (status === "error") {
    return "bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300"
  }

  if (status === "pending") {
    return "bg-gray-50 dark:bg-gray-900 text-gray-600 dark:text-gray-300"
  }

  return "bg-gray-50 dark:bg-gray-900 text-gray-700 dark:text-gray-100"
}

export function getBorderColor(status: "pending" | "running" | "completed" | "error", hasPermission: boolean) {
  switch (status) {
    case "error":
      return "border-red-300 dark:border-red-700"
    default:
      return hasPermission ? "border-amber-400 dark:border-amber-600" : "border-gray-200 dark:border-gray-700"
  }
}

export interface Todo {
  id?: string
  content: string
  status: "completed" | "in_progress" | "pending" | "cancelled"
  priority?: "high" | "medium" | "low"
}

export function getToolDisplayName(
  tool: string,
  input: Record<string, unknown> | undefined,
  title: string | undefined,
  output: string | undefined,
): string {
  const toolLabel = getToolLabel(tool)

  // If we have a title, use it with the tool name
  if (title) {
    let display = `${toolLabel}：${title}`

    // Special handling for todowrite/todoread to show completed/total
    if ((tool === "todowrite" || tool === "todoread") && output) {
      try {
        const todos = JSON.parse(output)
        if (Array.isArray(todos)) {
          const completed = todos.filter((t: Todo) => t.status === "completed").length
          const total = todos.length
          display = completed === 0 ? `${toolLabel}：共 ${total}` : `${toolLabel}：已完成 ${completed}/${total}`
        }
      } catch {
        // If parsing fails, keep original title
      }
    }

    // Add useful extra arguments for specific tools
    if (tool === "grep" && input?.include) {
      display += ` (${input.include})`
    }

    return display
  }

  // No title - build from input parameters
  if (!input) return toolLabel

  switch (tool) {
    case "list":
      return input.path ? `${toolLabel}：${input.path}` : toolLabel
    case "glob":
      return input.pattern ? `${toolLabel}：${input.pattern}` : toolLabel
    case "grep": {
      let grepDisplay = toolLabel
      if (input.pattern) grepDisplay += `：${input.pattern}`
      if (input.include) grepDisplay += ` (${input.include})`
      return grepDisplay
    }
    case "webfetch":
      return input.url ? `${toolLabel}：${input.url}` : toolLabel
    case "edit":
    case "multiedit":
    case "write":
    case "read":
      return input.filePath ? `${toolLabel}：${input.filePath}` : toolLabel
    default:
      return toolLabel
  }
}
