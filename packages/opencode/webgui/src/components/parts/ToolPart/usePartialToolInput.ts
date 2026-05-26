import { useDeferredValue, useMemo } from "react"
import { parsePartialInput } from "../../../lib/partial-tool-input"

const STREAMABLE = new Set(["write", "edit", "apply_patch"])

export const isStreamableTool = (tool: string): boolean => STREAMABLE.has(tool)

/**
 * In `pending` status, returns a best-effort parse of the streaming
 * tool args from `state.raw`. Returns `null` outside of pending or for
 * non-streamable tools — callers can fall back to `state.input`.
 *
 * Uses `useDeferredValue` so a flood of `part.updated` events (each LLM
 * delta) is folded into a low-priority render queue, keeping scroll and
 * input interactions snappy.
 */
export function usePartialToolInput(
  tool: string,
  status: string,
  raw: string | undefined,
): Record<string, unknown> | null {
  const deferredRaw = useDeferredValue(raw ?? "")
  return useMemo(() => {
    if (status !== "pending") return null
    if (!isStreamableTool(tool)) return null
    if (!deferredRaw) return null
    return parsePartialInput(deferredRaw)
  }, [status, tool, deferredRaw])
}
