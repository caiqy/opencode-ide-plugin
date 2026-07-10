import type { ReactElement } from "react"

const TOOL_LABELS: Record<string, string> = {
  bash: "执行命令",
  read: "查看",
  write: "写入",
  edit: "编辑",
  apply_patch: "文件补丁",
  list: "浏览目录",
  glob: "路径匹配",
  grep: "文本查找",
  webfetch: "抓取网页",
  websearch: "网页搜索",
  codesearch: "代码搜索",
  lsp: "语言服务器查询",
  image_generation: "模型内置生图",
  generate_image: "图片生成",
  batch: "批量工具调用",
  plan_enter: "进入计划模式",
  plan_exit: "退出计划模式",
  task: "委派子任务",
  question: "提问",
  todoread: "查看任务列表",
  todowrite: "更新任务列表",
  skill: "加载技能",
  invalid: "无效工具调用",
  invalidTool: "无效工具调用",
}

export function getToolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool
}

export function getSubtaskStatusLabel(input: { currentToolLabel: string | null; isParentCompleted: boolean }) {
  if (input.currentToolLabel) return input.currentToolLabel
  return input.isParentCompleted ? "已完成" : "思考中"
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

export function getBorderColor(
  status: "pending" | "running" | "completed" | "error",
  hasPermission: boolean,
  blocked?: "permission" | "question" | null,
) {
  switch (status) {
    case "error":
      return "border-red-300 dark:border-red-700"
    default:
      if (blocked === "permission") return "border-amber-400 dark:border-amber-600"
      if (blocked === "question") return "border-blue-500 dark:border-blue-600"
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
    const normalizedTitle =
      tool === "skill"
        ? title
            .replace(/^Loaded skill:\s*/i, "")
            .replace(/^Loading skill:\s*/i, "")
            .replace(/^加载技能[:：]\s*/, "")
        : title

    if (normalizedTitle === tool || normalizedTitle === toolLabel) {
      return toolLabel
    }

    let display = `${toolLabel}：${normalizedTitle}`

    // Special handling for todowrite/todoread to show completed/total
    if ((tool === "todowrite" || tool === "todoread") && output) {
      try {
        const todos = JSON.parse(output)
        if (Array.isArray(todos)) {
          const completed = todos.filter((t: Todo) => t.status === "completed").length
          const total = todos.length
          display = completed === 0 ? `${toolLabel}：共 ${total} 项` : `${toolLabel}：已完成 ${completed}/${total}`
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
    case "bash": {
      const desc = input.description
      return typeof desc === "string" && desc.length > 0 ? `${toolLabel}：${desc}` : toolLabel
    }
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
    case "write":
    case "read":
      return input.filePath ? `${toolLabel}：${input.filePath}` : toolLabel
    default:
      return toolLabel
  }
}

export function getBlockedIcon(type: "permission" | "question"): ReactElement {
  if (type === "permission") {
    return (
      <svg className="w-3.5 h-3.5 animate-pulse text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
        />
      </svg>
    )
  }
  return (
    <svg className="w-3.5 h-3.5 animate-pulse text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  )
}

export function getBlockedClasses(type: "permission" | "question") {
  if (type === "permission") {
    return "bg-amber-50/50 dark:bg-amber-900/10 text-amber-700 dark:text-amber-300"
  }
  return "bg-blue-50/50 dark:bg-blue-900/10 text-blue-700 dark:text-blue-300"
}
