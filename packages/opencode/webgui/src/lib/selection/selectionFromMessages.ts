import { isUserMessage } from "../../types/messages"
import type { Message, UserMessage } from "../../types/messages"

export interface MessageSelection {
  providerId: string
  modelId: string
  agent: string
  variant: string | null
}

export function selectionFromMessages(messages: Message[]): MessageSelection | null {
  let latestUser: UserMessage | null = null

  for (const message of messages) {
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
    variant: latestUser.variant ?? null,
  }
}
