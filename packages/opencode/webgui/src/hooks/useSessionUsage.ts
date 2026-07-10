import { useEffect, useMemo, useState } from "react"
import { sdk } from "../lib/api/sdkClient"
import { useMessages } from "../state/MessagesContext"
import { useSession } from "../state/SessionContext"
import { isAssistantMessage, type Message } from "../types/messages"

interface UsageBreakdown {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
}

export interface SessionUsage {
  tokens: number
  cost: number
  contextUsed: number
  contextLimit: number
  percentage: number
  breakdown: UsageBreakdown
}

function sumUsage(
  messages: Message[],
  sessionID: string,
): { tokens: number; cost: number; breakdown: UsageBreakdown; contextUsed: number } {
  let cost = 0
  let input = 0
  let output = 0
  let reasoning = 0
  let cacheRead = 0
  let cacheWrite = 0
  let contextUsed = 0

  // Consider only assistant messages from this session
  const assistants = messages
    .filter((m) => m.info.sessionID === sessionID && isAssistantMessage(m.info))
    .map((m) => m.info as any)

  // Sort by time.created if available
  assistants.sort((a: any, b: any) => {
    const ta = Number(a?.time?.created ?? 0)
    const tb = Number(b?.time?.created ?? 0)
    return ta - tb
  })

  for (const info of assistants) {
    const usage = info.tokens
    const c = info.cost
    if (typeof c === "number") cost += c
    if (!usage || !info.time || !info.time.completed) continue

    const uInput = Number(usage.input || 0)
    const uOutput = Number(usage.output || 0)
    const uReasoning = Number(usage.reasoning || 0)
    const uCacheRead = Number(usage.cache?.read || 0)
    const uCacheWrite = Number(usage.cache?.write || 0)

    if (uInput + uOutput + uReasoning + uCacheRead + uCacheWrite <= 0) continue

    // contextUsed is the latest input value
    contextUsed = uInput + uCacheRead + uCacheWrite + uOutput

    input += uInput
    output += uOutput
    reasoning += uReasoning
    cacheRead += uCacheRead
    cacheWrite += uCacheWrite
  }

  // Total tokens = new input + cache.read + cache.write + output + reasoning
  const tokens = input + cacheRead + cacheWrite + output + reasoning

  return { tokens, cost, contextUsed, breakdown: { input, output, reasoning, cacheRead, cacheWrite } }
}

export function useSessionUsage(targetSessionID?: string): SessionUsage {
  const { messages } = useMessages()
  const { currentSession, selectedProviderId, selectedModelId } = useSession()
  const sessionID = targetSessionID || currentSession?.id || ""

  const { tokens, cost, contextUsed, breakdown } = useMemo(() => sumUsage(messages, sessionID), [messages, sessionID])

  const [contextLimit, setContextLimit] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function loadLimit() {
      try {
        const res = await sdk.config.providers()
        const explicit = res.data?.providers.some(
          (provider) => provider.id === selectedProviderId && selectedModelId !== undefined && provider.models[selectedModelId],
        )
          ? { providerId: selectedProviderId!, modelId: selectedModelId! }
          : undefined
        const fallback = res.data?.providers.flatMap((provider) => {
          const modelId = res.data?.default?.[provider.id]
          return modelId && provider.models[modelId] ? [{ providerId: provider.id, modelId }] : []
        })[0]
        const providerId = explicit?.providerId ?? fallback?.providerId
        const modelId = explicit?.modelId ?? fallback?.modelId
        if (!providerId || !modelId) {
          if (!cancelled) setContextLimit(0)
          return
        }
        const provider = res.data?.providers.find((p) => p.id === providerId)
        const model = provider?.models?.[modelId]
        const limit = Number(model?.limit?.context || 0)
        if (!cancelled) setContextLimit(limit)
      } catch (_err) {
        if (!cancelled) setContextLimit(0)
      }
    }
    loadLimit()
    return () => {
      cancelled = true
    }
  }, [selectedProviderId, selectedModelId, sessionID])

  const percentage = contextLimit > 0 ? (contextUsed / contextLimit) * 100 : 0

  return {
    tokens,
    cost,
    contextUsed,
    contextLimit,
    percentage,
    breakdown,
  }
}
