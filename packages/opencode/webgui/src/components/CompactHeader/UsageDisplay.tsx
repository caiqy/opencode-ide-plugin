import { useState, useRef, useEffect, useId } from "react"
import { formatK, formatKM, formatCost } from "./utils"

interface UsageData {
  contextUsed: number
  contextLimit: number
  tokens: number
  cost: number
  percentage: number
  breakdown: {
    input: number
    cacheWrite: number
    cacheRead: number
    output: number
    reasoning: number
  }
}

interface UsageDisplayProps {
  usage: UsageData
  variant?: "bar" | "ring"
}

function contextRingStroke(pct: number) {
  if (pct < 50) return
  const [from, to, progress] =
    pct <= 60 ? ["#fef3c7", "#facc15", (pct - 50) / 10] : ["#facc15", "#ef4444", Math.min((pct - 60) / 20, 1)]
  const start = Number.parseInt(from.slice(1), 16)
  const end = Number.parseInt(to.slice(1), 16)
  return `#${[16, 8, 0]
    .map((shift) => Math.round(((start >> shift) & 0xff) + ((((end >> shift) & 0xff) - ((start >> shift) & 0xff)) * progress)).toString(16).padStart(2, "0"))
    .join("")}`
}

export function UsageDisplay({ usage, variant = "bar" }: UsageDisplayProps) {
  const [showDetails, setShowDetails] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const detailsId = useId()

  const pct = Math.min(100, Math.max(0, usage.percentage))
  const circumference = 2 * Math.PI * 6
  const color = pct <= 40 ? "bg-green-500" : pct <= 60 ? "bg-yellow-500" : pct <= 75 ? "bg-orange-500" : "bg-red-500"
  const ringStroke = contextRingStroke(pct)

  // Close popup when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDetails(false)
      }
    }

    if (showDetails) {
      document.addEventListener("mousedown", handleClickOutside)
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [showDetails])

  return (
    <div
      ref={containerRef}
      className="relative flex items-center gap-1.5 text-xs text-gray-700 dark:text-gray-300 select-none min-w-0"
    >
      {variant === "ring" ? (
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800"
          aria-label={`上下文已用 ${Math.round(pct)}%`}
          aria-expanded={showDetails}
          aria-controls={detailsId}
          title={`上下文已用 ${Math.round(pct)}%`}
          data-tip={`上下文已用 ${Math.round(pct)}%`}
        >
          <svg className="h-4 w-4 -rotate-90" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle
              className="stroke-gray-300 dark:stroke-[rgba(255,255,255,.32)]"
              cx="8"
              cy="8"
              r="6"
              strokeWidth="2"
            />
            <circle
              className={ringStroke ? undefined : "stroke-gray-900 dark:stroke-white"}
              cx="8"
              cy="8"
              r="6"
              stroke={ringStroke}
              strokeWidth="2"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - pct / 100)}
            />
          </svg>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="group flex items-center gap-1.5 overflow-hidden whitespace-nowrap"
          aria-expanded={showDetails}
          aria-controls={detailsId}
          title="查看用量详情"
          data-tip="查看用量详情"
        >
          <div className="relative h-2.5 w-[40px] overflow-hidden rounded bg-gray-100 dark:bg-gray-800">
            <div className={`${color} h-3`} style={{ width: `${pct}%` }} />
            <span className="absolute inset-0 flex items-center justify-center text-[9px] leading-none text-gray-900 drop-shadow-sm dark:text-white/90">
              {Math.round(pct)}%
            </span>
          </div>
        </button>
      )}

      {showDetails && (
        <div
          id={detailsId}
          className="modern-card absolute bottom-full right-0 mb-1 w-64 max-w-[calc(100vw-16px)] z-50 overflow-hidden ring-1 ring-black/5 p-2 text-gray-900 dark:text-gray-100"
          data-testid="usage-details"
        >
          <div className="max-h-[calc(100vh-200px)] overflow-y-auto py-1 text-xs">
            <div className="flex items-center justify-between py-0.5">
              <span>上下文已用</span>
              <span className="tabular-nums">
                {formatK(usage.contextUsed)}/{formatK(usage.contextLimit)}
              </span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span>令牌总数</span>
              <span className="tabular-nums">{formatKM(usage.tokens)}</span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span>总费用</span>
              <span className="tabular-nums">{formatCost(usage.cost)}</span>
            </div>
            <div className="my-1 h-px bg-gray-200 dark:bg-gray-700" />
            <div className="flex items-center justify-between py-0.5">
              <span>输入令牌</span>
              <span className="tabular-nums">{formatK(usage.breakdown.input)}</span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span>缓存写入</span>
              <span className="tabular-nums">{formatK(usage.breakdown.cacheWrite)}</span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span>缓存读取</span>
              <span className="tabular-nums">{formatK(usage.breakdown.cacheRead)}</span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span>输出令牌</span>
              <span className="tabular-nums">{formatK(usage.breakdown.output)}</span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span>推理令牌</span>
              <span className="tabular-nums">{formatK(usage.breakdown.reasoning)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
