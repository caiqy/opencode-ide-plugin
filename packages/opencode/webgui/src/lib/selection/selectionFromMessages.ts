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

/**
 * Optimistic placeholders and legacy entries can be missing the persisted
 * selection metadata. They are not valid selection sources; skipping them lets
 * restore fall back to an older complete user message.
 */
function isSelectableUser(message: UserMessage) {
  const model = (message as { model?: { providerID?: unknown; modelID?: unknown } }).model
  const agent = (message as { agent?: unknown }).agent
  return (
    typeof model?.providerID === "string" &&
    typeof model?.modelID === "string" &&
    typeof agent === "string" &&
    agent.length > 0
  )
}

export function selectionFromMessages(messages: Message[], revert?: RevertBoundary): MessageSelection | null {
  let latestUser: UserMessage | null = null

  for (const message of visibleMessages(messages, revert)) {
    if (!isUserMessage(message.info)) continue
    if (!isSelectableUser(message.info)) continue
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
