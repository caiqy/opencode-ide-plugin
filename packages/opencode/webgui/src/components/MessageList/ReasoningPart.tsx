import type { Part } from "../../state/MessagesContext"
import { CollapsiblePart } from "./CollapsiblePart"
import { usePartOpen } from "./PartOpenContext"

interface ReasoningPartProps {
  part: Part & { type: "reasoning" }
  durationMs?: number
}

export function ReasoningPart({ part, durationMs }: ReasoningPartProps) {
  const label = durationMs !== undefined ? `Thought for ${Math.max(1, Math.floor(durationMs / 1000))}s` : "Thinking..."
  const open = usePartOpen()
  const expanded = open.open?.type === "reasoning" && open.open.id === part.id

  return (
    <CollapsiblePart
      trigger={<span className="leading-none">{label}</span>}
      triggerClassName="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
      content={part.text || ""}
      contentClassName="mt-1 text-xs text-gray-600 dark:text-gray-400 pl-3 border-l-2 border-purple-300 dark:border-purple-700"
      expanded={expanded}
      onExpandedChange={(next) => {
        if (!next) {
          open.openManual(null)
          return
        }
        open.openManual({ type: "reasoning", id: part.id })
      }}
    />
  )
}
