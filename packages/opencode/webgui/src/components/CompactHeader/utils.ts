// Re-export formatting utilities from central location
export { formatK, formatKM, formatCost, formatTimestamp } from "../../utils/formatting"

export const CONNECTION_COLORS: Record<string, string> = {
  connecting: "bg-yellow-500",
  connected: "bg-green-500",
  disconnected: "bg-gray-500",
  error: "bg-red-500",
}

export const CONNECTION_TOOLTIPS: Record<string, string> = {
  connecting: "连接中…",
  connected: "已连接",
  disconnected: "未连接",
  error: "连接错误",
}

export const TAB_WIDTH_CLASS = "min-w-[72px] max-w-[180px] flex-[1_1_150px]"
export const TAB_TEXT_INACTIVE = "text-gray-700 dark:text-gray-300"
export const TAB_TEXT_INACTIVE_DEFAULT = "text-gray-500 dark:text-gray-400"
export const HEADER_RIGHT_GAP = "ml-2"
