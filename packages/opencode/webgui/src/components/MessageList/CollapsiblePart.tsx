import { useState } from "react"
import { cn } from "../../utils/classNames"

interface CollapsiblePartProps {
  trigger: React.ReactNode
  triggerClassName?: string
  content: React.ReactNode
  contentClassName?: string
  defaultExpanded?: boolean
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
}

export function CollapsiblePart({
  trigger,
  triggerClassName,
  content,
  contentClassName,
  defaultExpanded = false,
  expanded,
  onExpandedChange,
}: CollapsiblePartProps) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded)
  const isExpanded = typeof expanded === "boolean" ? expanded : internalExpanded

  const toggle = () => {
    const next = !isExpanded
    if (typeof expanded === "boolean") {
      onExpandedChange?.(next)
      return
    }
    setInternalExpanded(next)
  }

  return (
    <div className="my-1">
      <button onClick={toggle} className={cn("relative inline-flex items-center gap-1 pr-4", triggerClassName)}>
        {trigger}
        <span className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 flex h-3 w-3 items-center justify-center text-gray-400">
          <svg
            viewBox="0 0 24 24"
            className={cn("w-3 h-3 transition-transform duration-150", isExpanded && "rotate-90")}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 5l7 7-7 7" />
          </svg>
        </span>
      </button>
      {isExpanded && <div className={contentClassName}>{content}</div>}
    </div>
  )
}
