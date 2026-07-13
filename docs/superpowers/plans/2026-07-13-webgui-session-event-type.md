# WebGUI Session Event Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the local WebGUI session event type match the server's `properties.info` payload.

**Architecture:** Add one compile-time contract fixture, confirm the current declaration rejects it, then rename the two stale fields. No runtime code changes.

**Tech Stack:** TypeScript, Vitest

## Global Constraints

- Change only `session.created` and `session.updated` type declarations.
- Do not change runtime event parsing or consumers.

---

### Task 1: Align the session event type

**Files:**
- Create: `packages/opencode/webgui/src/lib/api/events.type.test.ts`
- Modify: `packages/opencode/webgui/src/lib/api/events.ts:7`

- [x] Add typed `session.created` and `session.updated` fixtures using `properties.info`.
- [x] Run a focused TypeScript check; confirm it rejects `info` before the fix.
- [x] Rename the two union fields from `session` to `info`.
- [x] Run `bun run test:run -- src/lib/api/events.type.test.ts` and `bun run build:dev`; confirm both pass.
- [x] Run `git diff --check` and inspect the scoped diff.
