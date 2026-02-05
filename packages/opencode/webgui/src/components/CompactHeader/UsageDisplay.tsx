import { useState, useRef, useEffect } from "react"
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
}

export function UsageDisplay({ usage }: UsageDisplayProps) {
  const [showDetails, setShowDetails] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const pct = Math.min(100, Math.max(0, usage.percentage))
  const color = pct <= 40 ? "bg-green-500" : pct <= 60 ? "bg-yellow-500" : pct <= 75 ? "bg-orange-500" : "bg-red-500"

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
      <button
        onClick={() => setShowDetails((v) => !v)}
        className="flex items-center gap-1.5 group whitespace-nowrap overflow-hidden"
        title="Show usage details"
        data-tip="Show usage details"
      >
        <div className="w-[40px] h-2.5 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden relative">
          <div className={`${color} h-3`} style={{ width: `${pct}%` }} />
          <span className="absolute inset-0 flex items-center justify-center text-[9px] text-gray-900 dark:text-white/90 drop-shadow-sm leading-none">
            {Math.round(pct)}%
          </span>
        </div>
      </button>

      {showDetails && (
        <div className="modern-card absolute bottom-full right-0 mb-1 w-64 max-w-[calc(100vw-16px)] z-50 overflow-hidden ring-1 ring-black/5 p-2">
          <div className="max-h-[calc(100vh-200px)] overflow-y-auto py-1 text-xs">
            <div className="flex items-center justify-between py-0.5">
              <span>Context used</span>
              <span className="tabular-nums">
                {formatK(usage.contextUsed)}/{formatK(usage.contextLimit)}
              </span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span>Total tokens</span>
              <span className="tabular-nums">{formatKM(usage.tokens)}</span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span>Total cost</span>
              <span className="tabular-nums">{formatCost(usage.cost)}</span>
            </div>
            <div className="my-1 h-px bg-gray-200 dark:bg-gray-700" />
            <div className="flex items-center justify-between py-0.5">
              <span>Input tokens</span>
              <span className="tabular-nums">{formatK(usage.breakdown.input)}</span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span>Cache write</span>
              <span className="tabular-nums">{formatK(usage.breakdown.cacheWrite)}</span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span>Cache read</span>
              <span className="tabular-nums">{formatK(usage.breakdown.cacheRead)}</span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span>Output tokens</span>
              <span className="tabular-nums">{formatK(usage.breakdown.output)}</span>
            </div>
            <div className="flex items-center justify-between py-0.5">
              <span>Reasoning tokens</span>
              <span className="tabular-nums">{formatK(usage.breakdown.reasoning)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
