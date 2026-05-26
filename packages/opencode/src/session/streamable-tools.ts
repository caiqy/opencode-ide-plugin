/**
 * Tools whose `tool-input-delta` events should be accumulated into
 * `ToolStatePending.raw` so clients can render partial input while it is
 * still being streamed.
 *
 * Limited to write-class tools where args may be large (file content,
 * patches).
 *
 * The webgui keeps its own mirror of this list at
 * `packages/opencode/webgui/src/components/parts/ToolPart/usePartialToolInput.ts`
 * (it cannot import backend `src/` directly). When adding a tool here,
 * update that file too.
 */
export const STREAMABLE_TOOLS = new Set<string>(["write", "edit", "apply_patch"])
