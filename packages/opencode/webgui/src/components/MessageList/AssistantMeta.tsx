import { formatDuration } from "./turnMeta"

interface AssistantMetaProps {
  agent: string
  modelName: string
  variant?: string
  durationMs?: number
  interrupted?: boolean
}

export function AssistantMeta({ agent, modelName, variant, durationMs, interrupted }: AssistantMetaProps) {
  const agentLabel = agent ? agent[0].toUpperCase() + agent.slice(1) : ""
  const durationLabel = typeof durationMs === "number" && durationMs >= 0 ? formatDuration(durationMs) : ""

  const items = [agentLabel, modelName, variant || "", durationLabel, interrupted ? "interrupted" : ""].filter(Boolean)

  if (items.length === 0) return null

  return (
    <div className="pt-1 pb-2 text-xs text-gray-400 dark:text-gray-500" data-testid="assistant-meta">
      {items.join(" · ")}
    </div>
  )
}
