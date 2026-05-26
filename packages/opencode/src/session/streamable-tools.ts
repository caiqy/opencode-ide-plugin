/**
 * Tools whose `tool-input-delta` events should be accumulated into
 * `ToolStatePending.raw` so clients can render partial input while it is
 * still being streamed.
 *
 * Limited to write-class tools where args may be large (file content,
 * patches). Adding a tool here is cheap; both the session processor and
 * the webgui import this constant.
 */
export const STREAMABLE_TOOLS = new Set<string>(["write", "edit", "apply_patch"])
