import { isAssistantMessage, type AssistantMessage, type Message } from "../../types/messages"
export { formatDuration } from "../../utils/formatting"

export interface TurnMeta {
  turnDurationMs: number | undefined
  lastAssistantID: string | undefined
}

/**
 * 每个 turn 的 meta 信息，以 lastAssistantID 为 key。
 * `get(messageID)` 返回该消息所属 turn 的 meta（仅当它是该 turn 最后一条 assistant 时）。
 */
export interface TurnMetaMap {
  get(messageID: string): TurnMeta | undefined
}

export function getMessageLastActivityAt(message: Message): number {
  return message.parts.reduce((latest, part) => {
    const direct = (part as { time?: { start?: number; end?: number } }).time
    // Legacy tool records may carry activity time on the part as well as its state.
    const state: { start?: number; end?: number } | undefined =
      part.type === "tool" && part.state.status !== "pending" ? part.state.time : undefined
    return Math.max(latest, direct?.end ?? direct?.start ?? latest, state?.end ?? state?.start ?? latest)
  }, message.info.time.created)
}

/**
 * 计算所有 turn 的 meta。
 * 一个 turn = 一条 user message + 其后直到下一条 user message 之前的所有 assistant messages。
 * 返回一个 map，key 是每个 turn 最后一条 assistant message 的 ID。
 */
export function computeAllTurnMetas(messages: Message[], interrupted = false): TurnMetaMap {
  const sorted = [...messages].sort((a, b) => a.info.time.created - b.info.time.created)

  // 按 user message 分割为多个 turn
  const turns: Array<{ user: Message; assistants: Message[] }> = []
  let current: { user: Message; assistants: Message[] } | null = null

  for (const msg of sorted) {
    if (msg.info.role === "user") {
      current = { user: msg, assistants: [] }
      turns.push(current)
    } else if (isAssistantMessage(msg.info) && current) {
      current.assistants.push(msg)
    }
  }

  // 计算每个 turn 的 meta，以最后一条 assistant ID 为 key
  const map = new Map<string, TurnMeta>()

  for (const turn of turns) {
    if (turn.assistants.length === 0) continue

    const completedTimes = turn.assistants
      .map((m) => (m.info as AssistantMessage).time.completed)
      .filter((t): t is number => typeof t === "number" && t > 0)

    const lastAssistant = turn.assistants[turn.assistants.length - 1]
    const lastCompleted = completedTimes.length > 0 ? Math.max(...completedTimes) : undefined
    const completedAt =
      interrupted && (lastAssistant.info as AssistantMessage).time.completed === undefined
        ? Math.max(lastCompleted ?? 0, getMessageLastActivityAt(lastAssistant))
        : lastCompleted
    const turnDurationMs =
      completedAt !== undefined && completedAt >= turn.user.info.time.created
        ? completedAt - turn.user.info.time.created
        : undefined

    const lastAssistantID = lastAssistant.info.id
    map.set(lastAssistantID, { turnDurationMs, lastAssistantID })
  }

  return {
    get(messageID: string) {
      return map.get(messageID)
    },
  }
}
