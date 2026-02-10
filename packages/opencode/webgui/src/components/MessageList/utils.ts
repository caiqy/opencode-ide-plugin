import type { Message, Part, WebguiPart } from "../../state/MessagesContext"

const PART_TYPE_PRIORITY: Record<string, number> = {
  reasoning: 0,
  text: 1,
  tool: 2,
}

export function partPriority(type: string): number {
  return PART_TYPE_PRIORITY[type] ?? 2
}

export function sortParts<T extends { part: WebguiPart }>(items: T[]): T[] {
  return [...items].sort((a, b) => partPriority(a.part.type) - partPriority(b.part.type))
}

export function getPartStart(part: Part): number | undefined {
  const time = (part as { time?: { start?: number } }).time
  return typeof time?.start === "number" ? time.start : undefined
}

export function getPartEnd(part: Part): number | undefined {
  const time = (part as { time?: { end?: number } }).time
  return typeof time?.end === "number" ? time.end : undefined
}

export function getUserMessagePlainText(message: Message): string | null {
  if (message.info.role !== "user") return null
  const chunks: string[] = []
  for (const part of message.parts) {
    if (part.type !== "text") continue
    const synthetic = (part as { synthetic?: boolean }).synthetic
    if (synthetic) continue
    const text = (part as { text?: string }).text
    if (typeof text === "string" && text.length > 0) {
      chunks.push(text)
    }
  }
  const joined = chunks.join("\n")
  const trimmed = joined.trim()
  return trimmed.length > 0 ? trimmed : null
}
