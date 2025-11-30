// Re-export formatting utilities from central location
export { formatK, formatKM, formatCost, formatTimestamp } from "../../utils/formatting"

export const CONNECTION_COLORS: Record<string, string> = {
  connecting: "bg-yellow-500",
  connected: "bg-green-500",
  disconnected: "bg-gray-500",
  error: "bg-red-500",
}

export const CONNECTION_TOOLTIPS: Record<string, string> = {
  connecting: "Connecting...",
  connected: "Connected",
  disconnected: "Disconnected",
  error: "Connection Error",
}
