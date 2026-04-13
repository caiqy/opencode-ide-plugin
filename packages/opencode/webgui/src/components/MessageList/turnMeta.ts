import type { Message } from "../../types/messages"
import { isAssistantMessage } from "../../types/messages"
import type { AssistantMessage } from "../../types/messages"

export interface TurnMeta {
  turnDurationMs: number | undefined
  lastAssistantID: string | undefined
}

/**
 * 计算最后一轮 turn 的 duration 和最后一条 assistant message ID。
 * turn = 最后一条 user message → 其后所有 assistant messages。
 */
export function computeTurnMeta(messages: Message[]): TurnMeta {
  const sorted = [...messages].sort((a, b) => a.info.time.created - b.info.time.created)

  // ES2022 兼容替代 findLast
  const lastUser = [...sorted].reverse().find((m: Message) => m.info.role === "user")
  if (!lastUser) return { turnDurationMs: undefined, lastAssistantID: undefined }

  const turnAssistants = sorted.filter(
    (m: Message) => isAssistantMessage(m.info) && m.info.time.created >= lastUser.info.time.created,
  )
  if (turnAssistants.length === 0) return { turnDurationMs: undefined, lastAssistantID: undefined }

  const completedTimes = turnAssistants
    .map((m: Message) => (m.info as AssistantMessage).time.completed)
    .filter((t: number | undefined): t is number => typeof t === "number" && t > 0)

  const lastCompleted = completedTimes.length > 0 ? Math.max(...completedTimes) : undefined
  const turnDurationMs =
    lastCompleted !== undefined && lastCompleted >= lastUser.info.time.created
      ? lastCompleted - lastUser.info.time.created
      : undefined

  const lastAssistantID = turnAssistants[turnAssistants.length - 1]?.info.id

  return { turnDurationMs, lastAssistantID }
}

/**
 * 将毫秒格式化为人类可读的时长字符串。
 * < 60s → "Xs"，≥ 60s → "Xm Ys"
 */
export function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000)
  if (total < 0) return ""
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}m ${seconds}s`
}
