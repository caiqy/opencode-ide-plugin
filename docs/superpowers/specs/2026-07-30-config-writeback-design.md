# Config Writeback Repair Design

## Goal

Make project and global configuration writes survive reloads without persisting resolved environment values, file contents, or absolute plugin paths. Preserve comments in retained JSONC files and serialize global read-modify-write operations.

## Raw And Resolved Views

Writeback uses two views of each persisted source:

- The raw view parses JSONC, removes legacy TUI keys with `normalizeLoadedConfig()`, and validates with `ConfigV1.Info`. It does not substitute `{env:...}` or `{file:...}` values and does not resolve relative plugin paths.
- The resolved view applies the normal substitutions and plugin resolution to a fresh disk read.

Incoming values are recursively compared with the matching resolved values using `isDeepStrictEqual`. An equal subtree reuses the corresponding raw subtree. Changed records recurse by key. Changed arrays first reserve exact matches from still-unused resolved indices and reuse those raw sources; only then may an unmatched element recurse against its still-unused original index. This supports insertion, deletion, reordering, and duplicates without shifting raw secrets by position. Elements with no reliable source keep the real incoming value.

## Project Config

`Config.update()` acquires an `EffectFlock` lock keyed by the project directory, then selects the highest-priority existing file in that directory: `opencode.jsonc`, then `opencode.json`; if neither exists it creates `opencode.json`. Inside the lock it fresh-reads both raw and resolved views of that target, reads the complete `Config.get()` resolved view, applies the reconciled patch with JSONC edits, and reloads instance state.

The raw comparison remains target-only. Therefore an unchanged value inherited from lower project or global config compares equal to the complete resolved view but maps to raw `undefined`; JSONC patching does not copy it into the target. This intentionally favors non-persistence when the API cannot distinguish an explicit literal from an unchanged inherited value. Leaf edits retain unrelated nested comments and target-owned raw env, file, and plugin representations.

Project arrays use an explicit three-view provenance rule. Complete resolved arrays identify inherited values only; their indices are never used to read target raw. Target-resolved and target-raw arrays are loaded from the same target source and are the only index-aligned pair. Reconciliation reserves exact target-owned matches and restores their raw entries, omits exact inherited matches, cautiously reconciles unmatched values only against unused target entries, and otherwise persists the real new input. Undefined target sources are omitted rather than serialized.

This produces source-correct behavior for both array merge models. `instructions` inherited from global/lower project files continue to reappear through concat/dedupe, while target-owned and new instructions remain in target order. `plugin` entries continue to reappear through plugin-origin dedupe, while target path/file tokens remain raw and new target plugins persist. A requested cross-source order is normalized back to source merge order after reload because project writeback does not copy inherited entries into the target.

## Global Config

Global files still merge in increasing priority:

1. `config.json`
2. `opencode.json`
3. `opencode.jsonc`

Each `updateGlobal()` or `replaceGlobal()` operation acquires one `EffectFlock` lock keyed by the active global config directory. Inside that lock it:

1. Fresh-reads and merges raw global files.
2. Fresh-reads and merges resolved global files.
3. Reconciles the incoming value against those views.
4. Applies update semantics, including full replacement for supplied `agent` and `provider`, or replace semantics.
5. Selects the existing highest-priority target, defaulting to `opencode.jsonc`.
6. Recursively synchronizes the final raw config into the target.
7. Writes the target before deleting obsolete global files.

Recursive JSONC sync skips deeply equal values, edits records one key at a time, and replaces only changed arrays or primitives. It materializes effective lower-priority values and removes stale or legacy keys while preserving comments under unchanged objects.

## Failure And Cache Handling

The target write precedes obsolete cleanup, so a target-write failure cannot remove source files. Cleanup failures remain operation failures. Cache invalidation is an `ensuring` finalizer inside the lock, so a successful target write is observable even when later cleanup fails.

Project and global lock acquisition errors are defects via `Effect.orDie`, matching adjacent `EffectFlock` usage and leaving the public error types unchanged.

## Tests

Regression coverage verifies:

- Project JSONC priority, reload behavior, raw env/file/plugin retention, and nested-comment retention.
- Full project payloads not copying lower-project or global secrets into the target.
- Mixed-source project `instructions` and `plugin` edits preserving target raw tokens, omitting inherited values, producing valid schema, and reloading with their native merge semantics.
- Concurrent project patches retaining both independent fields.
- Global update and replace retention of raw env/file/plugin values, including a whole resolved provider patch.
- Plugin array insertion, deletion, reordering, and duplicate source matching without resolved path persistence.
- Fresh global reads after cache warmup and external disk edits.
- Cache invalidation after target success followed by obsolete cleanup failure.
- Concurrent updates retaining both independent fields.
- Unrelated global JSONC updates retaining nested provider and permission comments.
- Existing consolidation, replacement, failure ordering, legacy-key cleanup, and `FileChangesPanel` behavior.

Run focused config tests, `bun typecheck` from `packages/opencode`, and scoped `git diff --check`. WebGUI verification is only required when WebGUI files change.

## Non-Goals

- No new configuration filename, dependency, or public API.
- No automatic consolidation during reads or startup.
- No preservation of comments from files explicitly removed during consolidation.
