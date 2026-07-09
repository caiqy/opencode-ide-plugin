import { parse, Allow } from "partial-json"

const ALLOWED = Allow.STR | Allow.OBJ | Allow.ARR

/**
 * Best-effort parse of a possibly-truncated JSON object emitted by an LLM
 * mid-stream. Returns the recovered fields, dropping anything that can't be
 * salvaged (half-typed field names, NaN, etc.). Always returns a plain object;
 * never throws.
 */
export function parsePartialInput(raw: string): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed = parse(raw, ALLOWED)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/**
 * Count newline-separated lines in a string. Empty / non-string inputs return
 * 0 so the caller can treat "no value yet" and "0 lines" identically.
 */
export function countLines(value: unknown): number {
  if (typeof value !== "string" || value.length === 0) return 0
  let count = 1
  for (let i = 0; i < value.length; i++) if (value.charCodeAt(i) === 10) count++
  return count
}
