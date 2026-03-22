import { useMemo } from "react"
import type { Message, QuestionRequest } from "../../../state/MessagesContext"

type Permission = {
  sessionID: string
  tool?: {
    messageID: string
    callID: string
  }
}

type Msg = {
  id: string
  kind: "history-message" | "history-summary" | "tail-message"
  msg: Message
  reason?: "permission" | "question" | "typing"
}

type Question = {
  id: string
  kind: "tail-question"
  question: QuestionRequest
}

type Typing = {
  id: string
  kind: "tail-typing"
}

export type HistoryBlock = Msg
export type TailBlock = Msg | Question | Typing

export function useHistoryBlocks(input: {
  sessionID?: string | null
  messages: Message[]
  questions: QuestionRequest[]
  permissions?: Permission[]
  isTyping: boolean
}) {
  return useMemo(() => {
    const pin = new Map<string, "permission" | "question" | "typing">()
    for (const item of input.permissions ?? []) {
      if (item.sessionID !== input.sessionID) continue
      const id = item.tool?.messageID
      if (!id) continue
      pin.set(id, "permission")
    }

    const last = input.messages.at(-1)?.info.id
    if (last && input.questions.length > 0 && !pin.has(last)) pin.set(last, "question")
    if (last && input.isTyping && !pin.has(last)) pin.set(last, "typing")

    const history: HistoryBlock[] = []
    const tail: TailBlock[] = []
    const start = input.messages.findIndex((msg) => pin.has(msg.info.id))
    const split = start >= 0 ? start : input.messages.length - 1

    for (const [index, msg] of input.messages.entries()) {
      const why = pin.get(msg.info.id)
      if (split >= 0 && index >= split) {
        tail.push({ id: msg.info.id, kind: "tail-message", msg, reason: why })
        continue
      }
      const summary = (msg.info as { summary?: boolean }).summary === true
      history.push({ id: msg.info.id, kind: summary ? "history-summary" : "history-message", msg })
    }

    for (const question of input.questions) {
      tail.push({ id: `question:${question.id}`, kind: "tail-question", question })
    }

    if (input.isTyping && input.sessionID) {
      tail.push({ id: `typing:${input.sessionID}`, kind: "tail-typing" })
    }

    return { history, tail }
  }, [input.isTyping, input.messages, input.permissions, input.questions, input.sessionID])
}
