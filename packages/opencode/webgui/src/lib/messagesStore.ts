/**
 * Centralized message state mutation utilities
 * Eliminates duplicate array cloning logic and type casting from MessagesProvider
 */

import type { Message, WebguiPart, SDKMessage, TextPart } from "../types/messages"

/**
 * Upsert a message (add new or update existing)
 */
export function upsertMessage(messages: Message[], message: Message): Message[] {
  const index = messages.findIndex((m) => m.info.id === message.info.id)

  if (index >= 0) {
    const updated = [...messages]
    updated[index] = message
    return updated
  }

  return [...messages, message]
}

/**
 * Update message info while preserving parts
 */
export function updateMessageInfo(messages: Message[], messageID: string, info: SDKMessage): Message[] {
  const index = messages.findIndex((m) => m.info.id === messageID)

  if (index >= 0) {
    const updated = [...messages]
    updated[index] = { ...updated[index], info }
    return updated
  }

  // Create new message if not found
  return [...messages, { info, parts: [] }]
}

/**
 * Update message with partial data
 */
export function updateMessage(messages: Message[], messageID: string, update: Partial<Message>): Message[] {
  const index = messages.findIndex((m) => m.info.id === messageID)

  if (index < 0) return messages

  const updated = [...messages]
  updated[index] = { ...updated[index], ...update }
  return updated
}

/**
 * Remove a message by ID
 */
export function removeMessage(messages: Message[], messageID: string): Message[] {
  return messages.filter((m) => m.info.id !== messageID)
}

/**
 * Upsert a part in a message (add new or update existing)
 */
export function upsertPart(messages: Message[], messageID: string, part: WebguiPart): Message[] {
  const messageIndex = messages.findIndex((m) => m.info.id === messageID)

  if (messageIndex < 0) return messages

  const updated = [...messages]
  const message = updated[messageIndex]
  const partIndex = message.parts.findIndex((p) => p.id === part.id)

  if (partIndex >= 0) {
    // Update existing part
    const updatedParts = [...message.parts]
    updatedParts[partIndex] = part
    updated[messageIndex] = { ...message, parts: updatedParts }
  } else {
    // Add new part
    updated[messageIndex] = { ...message, parts: [...message.parts, part] }
  }

  return updated
}

/**
 * Apply a text delta to a part (for streaming)
 */
export function applyPartDelta(messages: Message[], messageID: string, part: WebguiPart, delta: string): Message[] {
  if (part.type !== "text") {
    // For non-text parts, just upsert normally
    return upsertPart(messages, messageID, part)
  }

  const messageIndex = messages.findIndex((m) => m.info.id === messageID)

  if (messageIndex < 0) return messages

  const updated = [...messages]
  const message = updated[messageIndex]
  const partIndex = message.parts.findIndex((p) => p.id === part.id)

  if (partIndex >= 0) {
    // Append delta to existing text part
    const existingPart = message.parts[partIndex]
    if (existingPart.type === "text") {
      const updatedParts = [...message.parts]
      updatedParts[partIndex] = {
        ...existingPart,
        text: (existingPart.text || "") + delta,
      }
      updated[messageIndex] = { ...message, parts: updatedParts }
    }
  } else {
    // New part with delta as initial text
    const newPart: TextPart = { ...(part as TextPart), text: delta }
    updated[messageIndex] = { ...message, parts: [...message.parts, newPart] }
  }

  return updated
}

/**
 * Update a specific part in a message
 */
export function updatePart(
  messages: Message[],
  messageID: string,
  partID: string,
  update: Partial<WebguiPart>,
): Message[] {
  const messageIndex = messages.findIndex((m) => m.info.id === messageID)

  if (messageIndex < 0) return messages

  const updated = [...messages]
  const message = updated[messageIndex]
  const partIndex = message.parts.findIndex((p) => p.id === partID)

  if (partIndex < 0) return messages

  const updatedParts = [...message.parts]
  updatedParts[partIndex] = { ...updatedParts[partIndex], ...update } as WebguiPart
  updated[messageIndex] = { ...message, parts: updatedParts }

  return updated
}

/**
 * Remove a part from a message
 */
export function removePart(messages: Message[], messageID: string, partID: string): Message[] {
  const messageIndex = messages.findIndex((m) => m.info.id === messageID)

  if (messageIndex < 0) return messages

  const updated = [...messages]
  const message = updated[messageIndex]
  updated[messageIndex] = {
    ...message,
    parts: message.parts.filter((p) => p.id !== partID),
  }

  return updated
}

/**
 * Get messages for a specific session
 */
export function getMessagesBySession(messages: Message[], sessionID: string): Message[] {
  return messages.filter((m) => m.info.sessionID === sessionID)
}

const OPTIMISTIC_PREFIX = "optimistic-"

/**
 * Create an optimistic user message for immediate local display.
 * Will be replaced when the real message arrives via SSE.
 */
export function createOptimisticUserMessage(sessionID: string, text: string): Message {
  const id = `${OPTIMISTIC_PREFIX}${sessionID}-${Date.now()}`
  return {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created: Date.now() },
    } as SDKMessage,
    parts: [
      {
        id: `part-${id}`,
        type: "text",
        text,
        sessionID,
        messageID: id,
      } as WebguiPart,
    ],
  }
}

/**
 * Check whether a message is an optimistic placeholder.
 */
export function isOptimisticMessage(message: Message): boolean {
  return message.info.id.startsWith(OPTIMISTIC_PREFIX)
}

/**
 * Remove all optimistic messages for a given session.
 * Returns the same array reference when nothing was removed.
 */
export function removeOptimisticMessages(messages: Message[], sessionID: string): Message[] {
  const hasAny = messages.some((m) => m.info.sessionID === sessionID && isOptimisticMessage(m))
  if (!hasAny) return messages
  return messages.filter((m) => !(m.info.sessionID === sessionID && isOptimisticMessage(m)))
}

/**
 * Like updateMessageInfo, but when a real user message arrives,
 * first removes any optimistic placeholders for that session.
 */
export function updateMessageInfoCleaningOptimistic(
  messages: Message[],
  messageID: string,
  info: SDKMessage,
): Message[] {
  const cleaned = info.role === "user" ? removeOptimisticMessages(messages, info.sessionID) : messages
  return updateMessageInfo(cleaned, messageID, info)
}
