import { isUserMessage } from "../../types/messages"
import type { Message, UserMessage } from "../../types/messages"

export interface MessageSelection {
  providerId: string
  modelId: string
  agent: string
  variant: string | null
}

type RevertBoundary = {
  messageID: string
} | null

function userVariant(message: UserMessage) {
  const nested = (message as { model?: { variant?: unknown } }).model?.variant
  if (typeof nested === "string") return nested

  const legacy = (message as { variant?: unknown }).variant
  return typeof legacy === "string" ? legacy : null
}

function visibleMessages(messages: Message[], revert?: RevertBoundary) {
  if (!revert?.messageID) return messages
  const index = messages.findIndex((message) => message.info.id === revert.messageID)
  if (index === -1) return []
  return messages.slice(0, index)
}

export function selectionFromMessages(messages: Message[], revert?: RevertBoundary): MessageSelection | null {
  let latestUser: UserMessage | null = null

  for (const message of visibleMessages(messages, revert)) {
    if (!isUserMessage(message.info)) continue
    if (!latestUser || message.info.time.created >= latestUser.time.created) {
      latestUser = message.info
    }
  }

  if (!latestUser) return null

  return {
    providerId: latestUser.model.providerID,
    modelId: latestUser.model.modelID,
    agent: latestUser.agent,
    variant: userVariant(latestUser),
  }
}
