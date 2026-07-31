# Session Title Regeneration Repair

## Goal

Restore manual session title regeneration so it derives a new title from the complete visible conversation instead of silently returning the existing title after multiple user turns.

## Root Cause

`SessionPrompt.regenerateTitle()` calls the automatic title generator with `force: true`, but the generator still returns early unless history contains exactly one real user message. The endpoint then returns the unchanged session as a successful response, so the WebGUI closes the menu without showing an update or an error.

## Design

Keep one title-generation path and give `force` its original meaning:

- Automatic title generation remains unchanged: it only runs for a default root-session title with exactly one non-synthetic user message, and uses history through that first message.
- Manual regeneration accepts any history containing a non-synthetic user message, uses the complete history as model context, and uses the last real user message as the focused user message.
- Existing subtask-only prompt handling remains intact. When the focused user message contains only subtask parts, preserve their prompt text in the model input.
- The HTTP route, generated SDK, WebGUI click wiring, and response shape remain unchanged.

## Error Handling

Preserve existing transport behavior. Missing sessions and model lookup failures continue through the declared endpoint errors. This repair only removes the incorrect multi-turn early return; it does not add a new public error contract.

## Verification

Add a backend regression that creates a session with multiple real user turns and invokes title regeneration through the existing route or service boundary. The test must fail on the current implementation because no title request is made, then pass after the repair by proving the title model receives the complete history and the persisted session title changes.

Run the focused backend title-regeneration test, the existing WebGUI `SessionContext` and tab-menu tests, package typecheck, and scoped `git diff --check`.

## Scope

No UI redesign, retries, loading state, API generation, or title prompt changes are included.
