import type { Part } from "../../state/MessagesContext"
import { CollapsiblePart } from "./CollapsiblePart"
import { usePartOpen } from "./PartOpenContext"
import { MarkdownRenderer } from "../MarkdownRenderer"

interface ReasoningPartProps {
  part: Part & { type: "reasoning" }
  durationMs?: number
  interrupted?: boolean
}

export function ReasoningPart({ part, durationMs, interrupted }: ReasoningPartProps) {
  const label =
    durationMs !== undefined
      ? `思考了 ${Math.max(1, Math.floor(durationMs / 1000))} 秒`
      : interrupted
        ? "思考已中断"
        : "思考中…"
  const open = usePartOpen()
  const expanded = open.isOpen(part.id)

  const text = (part.text || "").replace(/\\?<!--[\s\S]*?(?:-->|$)/g, "").trim()
  if (!text) {
    return (
      <div>
        <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      </div>
    )
  }

  return (
    <CollapsiblePart
      trigger={<span className="leading-none">{label}</span>}
      triggerClassName="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
      content={<MarkdownRenderer tone="muted">{text}</MarkdownRenderer>}
      contentClassName="mt-1 text-xs text-gray-600 dark:text-gray-400 pl-3"
      expanded={expanded}
      onExpandedChange={(next) => open.setOpen(part.id, next)}
    />
  )
}
