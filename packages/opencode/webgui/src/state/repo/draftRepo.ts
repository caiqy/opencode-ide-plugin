import { scopedStateGetJSON, scopedStateSetJSON } from "../scopedStorage"
import type { AgentPart, FilePart, TextPart } from "@opencode-ai/sdk/v2/client"
import type { Message } from "../../types/messages"

const draftsKey = "opencode:webgui:workspace:drafts:v1"
const draftSessionKey = "opencode:webgui:workspace:draft_session:v1"
export type DraftPart =
  | Pick<TextPart, "type" | "text">
  | Pick<FilePart, "type" | "mime" | "filename" | "url" | "source">
  | Pick<AgentPart, "type" | "name" | "source">

export type Draft =
  | string
  | {
      parts: DraftPart[]
      agent: string
      model: { providerID: string; modelID: string; variant?: string } | undefined
    }

let cache: Record<string, Draft> | null = null
let dirty = false

function map(input: unknown): Record<string, Draft> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {}
  return Object.fromEntries(
    Object.entries(input).flatMap(([k, v]) => {
      const draft = parse(v)
      return draft === undefined ? [] : [[k, draft]]
    }),
  )
}

function parse(input: unknown): Draft | undefined {
  if (typeof input === "string") return input
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined
  const value = input as { parts?: unknown; agent?: unknown; model?: unknown }
  if (!Array.isArray(value.parts) || typeof value.agent !== "string") return undefined
  const parts: DraftPart[] = []
  for (const part of value.parts) {
    const parsed = parsePart(part)
    if (!parsed) return undefined
    parts.push(parsed)
  }
  if (parts.length === 0 || !validParts(parts)) return undefined
  const model = parseModel(value.model)
  if (value.model !== undefined && !model) return undefined
  return { parts, agent: value.agent, model }
}

function parsePart(input: unknown): DraftPart | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined
  const value = input as { type?: unknown; text?: unknown; mime?: unknown; filename?: unknown; url?: unknown; name?: unknown; source?: unknown }
  if (value.type === "text" && typeof value.text === "string") return { type: "text", text: value.text }
  if (value.type === "agent" && typeof value.name === "string") {
    const source = parseTextSource(value.source)
    if (value.source !== undefined && !source) return undefined
    return source ? { type: "agent", name: value.name, source } : { type: "agent", name: value.name }
  }
  if (value.type !== "file" || typeof value.mime !== "string" || typeof value.url !== "string") return undefined
  if (value.filename !== undefined && typeof value.filename !== "string") return undefined
  const source = parseFileSource(value.source)
  if (value.source !== undefined && !source) return undefined
  return source
    ? { type: "file", mime: value.mime, filename: value.filename, url: value.url, source }
    : { type: "file", mime: value.mime, filename: value.filename, url: value.url }
}

function parseTextSource(input: unknown): AgentPart["source"] | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined
  const value = input as { value?: unknown; start?: unknown; end?: unknown }
  const start = value.start
  const end = value.end
  if (
    typeof value.value !== "string" ||
    !safeInteger(start) ||
    !safeInteger(end) ||
    start < 0 ||
    end < start
  ) {
    return undefined
  }
  return { value: value.value, start, end }
}

function parseFileSource(input: unknown): FilePart["source"] | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined
  const value = input as { type?: unknown; path?: unknown; text?: unknown; range?: unknown; name?: unknown; kind?: unknown; clientName?: unknown; uri?: unknown }
  const text = parseTextSource(value.text)
  if (!text) return undefined
  if (value.type === "file" && typeof value.path === "string") return { type: "file", path: value.path, text }
  if (value.type === "resource" && typeof value.clientName === "string" && typeof value.uri === "string") {
    return { type: "resource", clientName: value.clientName, uri: value.uri, text }
  }
  if (
    value.type !== "symbol" ||
    typeof value.path !== "string" ||
    typeof value.name !== "string" ||
    !safeInteger(value.kind)
  ) {
    return undefined
  }
  if (!value.range || typeof value.range !== "object" || Array.isArray(value.range)) return undefined
  const range = value.range as { start?: unknown; end?: unknown }
  if (!validPosition(range.start) || !validPosition(range.end)) return undefined
  if (range.start.line > range.end.line || (range.start.line === range.end.line && range.start.character > range.end.character)) {
    return undefined
  }
  return { type: "symbol", path: value.path, name: value.name, kind: value.kind, text, range: { start: range.start, end: range.end } }
}

function validPosition(input: unknown): input is { line: number; character: number } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false
  const value = input as { line?: unknown; character?: unknown }
  const line = value.line
  const character = value.character
  return safeInteger(line) && line >= 0 && safeInteger(character) && character >= 0
}

function safeInteger(input: unknown): input is number {
  return Number.isSafeInteger(input)
}

function validParts(parts: DraftPart[]) {
  const texts = parts.flatMap((part, index) => (part.type === "text" ? [{ index, text: part.text }] : []))
  const ranges = new Map<number, Array<{ start: number; end: number }>>()
  for (const part of parts) {
    const source = part.type === "agent" || part.type === "file" ? part.source : undefined
    if (!source) continue
    const text = "text" in source ? source.text : source
    const matches = texts.filter((item) => {
      if (text.end > item.text.length) return false
      const value = part.type === "file" && part.source?.type === "resource" ? `[${part.filename || part.source.uri}]` : text.value
      return item.text.slice(text.start, text.end) === value
    })
    if (matches.length !== 1) return false
    const next = ranges.get(matches[0].index) ?? []
    next.push({ start: text.start, end: text.end })
    ranges.set(matches[0].index, next)
  }
  if ([...ranges.values()].some((items) => items.sort((a, b) => a.start - b.start).some((item, index) => index > 0 && item.start < items[index - 1].end))) return false
  return true
}

function parseModel(input: unknown): { providerID: string; modelID: string; variant?: string } | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined
  const value = input as { providerID?: unknown; modelID?: unknown; variant?: unknown }
  if (typeof value.providerID !== "string" || typeof value.modelID !== "string") return undefined
  if (value.variant !== undefined && typeof value.variant !== "string") return undefined
  return value.variant ? { providerID: value.providerID, modelID: value.modelID, variant: value.variant } : { providerID: value.providerID, modelID: value.modelID }
}

export function draftFromMessage(message: Message): Exclude<Draft, string> | undefined {
  if (message.info.role !== "user") return undefined
  const parts = message.parts.flatMap((part): DraftPart[] => {
    if (part.type === "text") {
      if ((part as { synthetic?: boolean }).synthetic) return []
      return [{ type: "text", text: part.text }]
    }
    if (part.type === "file") {
      return [{ type: "file", mime: part.mime, filename: part.filename, url: part.url, source: part.source }]
    }
    if (part.type === "agent") return [{ type: "agent", name: part.name, source: part.source }]
    return []
  })
  if (parts.length === 0) return undefined
  return { parts, agent: message.info.agent, model: message.info.model }
}

export function draftText(draft: Draft | undefined) {
  if (typeof draft === "string") return draft
  if (!draft) return ""
  return draft.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
}

function same(a: Record<string, Draft>, b: Record<string, Draft>) {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  return ak.every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]))
}

export function resetDraftRepoForTest() {
  cache = null
  dirty = false
}

export async function loadDrafts() {
  const next = map(await scopedStateGetJSON<unknown>("workspace", draftsKey, {}))
  if (!dirty) {
    cache = next
    return next
  }
  if (!cache) {
    cache = next
    dirty = false
    return next
  }
  if (same(cache, next)) {
    dirty = false
    return next
  }
  return cache
}

export async function saveDrafts(value: Record<string, Draft>) {
  const next = map(value)
  if (Object.keys(next).length !== Object.keys(value).length) return { ok: false, error: "invalid_draft" }
  cache = next
  dirty = true
  return scopedStateSetJSON("workspace", draftsKey, next)
}

export async function loadDraftSession() {
  const value = await scopedStateGetJSON<unknown>("workspace", draftSessionKey, null)
  if (typeof value === "string") return value
  return null
}

export async function saveDraftSession(value: string | null) {
  return scopedStateSetJSON("workspace", draftSessionKey, value)
}

export async function cleanupDeletedSessionDraft(session_id: string) {
  const drafts = await loadDrafts()
  if (session_id in drafts) {
    const next = { ...drafts }
    delete next[session_id]
    await saveDrafts(next)
  }

  const draftSession = await loadDraftSession()
  if (draftSession !== session_id) return
  await saveDraftSession(null)
}
