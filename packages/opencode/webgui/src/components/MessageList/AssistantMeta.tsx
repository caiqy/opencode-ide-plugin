import { formatRelativeDateTimeLabel } from "../../utils/formatting"
import { formatDuration } from "./turnMeta"

interface AssistantMetaProps {
  agent: string
  modelName: string
  variant?: string
  durationMs?: number
  completedAt?: number
  interrupted?: boolean
}

export function AssistantMeta({ agent, modelName, variant, durationMs, completedAt, interrupted }: AssistantMetaProps) {
  const agentLabel = agent ? agent[0].toUpperCase() + agent.slice(1) : ""
  const durationLabel = typeof durationMs === "number" && durationMs >= 0 ? formatDuration(durationMs) : ""
  const completedLabel = typeof completedAt === "number" ? formatRelativeDateTimeLabel(completedAt) : ""

  const items = [
    agentLabel,
    modelName,
    variant || "",
    durationLabel,
    completedLabel,
    interrupted ? "interrupted" : "",
  ].filter(Boolean)

  if (items.length === 0) return null

  return (
    <div className="flex items-center" data-testid="assistant-meta">
      <div className="flex-1 border-t border-gray-200 dark:border-gray-800" />
      <span className="mx-3 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{items.join(" · ")}</span>
      <div className="flex-1 border-t border-gray-200 dark:border-gray-800" />
    </div>
  )
}
