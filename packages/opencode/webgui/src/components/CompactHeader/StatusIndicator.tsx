import type { RefObject } from "react"
import type { ConnectionState } from "../../lib/api/events"
import { CONNECTION_COLORS, CONNECTION_TOOLTIPS } from "./utils"

interface StatusIndicatorProps {
  connectionState: ConnectionState
  open?: boolean
  onToggle?: () => void
  controls?: string
  buttonRef?: RefObject<HTMLButtonElement | null>
}

export function StatusIndicator({
  connectionState,
  open,
  onToggle,
  controls = "status-popover",
  buttonRef,
}: StatusIndicatorProps) {
  const tip = CONNECTION_TOOLTIPS[connectionState]
  const dot = (
    <span
      className={`h-2 w-2 rounded-full ${CONNECTION_COLORS[connectionState]} ${
        connectionState === "connecting" || connectionState === "error" ? "animate-pulse" : ""
      }`}
    />
  )

  if (!onToggle) {
    return (
      <div
        className="flex h-5 w-5 items-center justify-center"
        title={tip}
        data-tip={tip}
        aria-label={`连接状态：${tip}`}
      >
        {dot}
      </div>
    )
  }

  return (
    <button
      ref={buttonRef}
      type="button"
      className="flex h-5 w-5 items-center justify-center"
      title={tip}
      data-tip={tip}
      aria-label={`连接状态：${tip}`}
      aria-haspopup="dialog"
      aria-expanded={open ?? false}
      aria-controls={controls}
      onClick={onToggle}
    >
      {dot}
    </button>
  )
}
