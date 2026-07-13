# Binary File Mention Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore binary file mentions as model-visible path references without reading their contents or failing the session.

**Architecture:** Adapt the original `2ea9557db4` behavior at the current `SessionPrompt` file-part boundary. Reuse `classifyAttachment`; leave explicit `Read` tool behavior unchanged.

**Tech Stack:** TypeScript, Effect, Bun test

## Global Constraints

- Do not add spreadsheet parsing or dependencies.
- Do not change explicit `Read` calls for binary files.
- Keep the change limited to prompt admission and its focused regression tests.

---

### Task 1: Restore binary mention degradation

**Files:**
- Modify: `packages/opencode/src/session/prompt.ts:790`
- Test: `packages/opencode/test/session/prompt.test.ts`

**Interfaces:**
- Consumes: `classifyAttachment(filepath: string, bytes: Uint8Array, fallbackMime: string)` from `packages/opencode/src/util/media.ts`
- Produces: a synthetic text part with `Referenced binary file path without reading contents: <path>` while preserving the original file part

- [x] **Step 1: Restore focused failing tests**

Port the two cases from commit `2ea9557db4` to the current prompt test harness:

```typescript
it.live("keeps binary file references as plain path mentions without read failures", () => /* current harness */)
it.live("keeps binary-only file references model-visible without read failures", () => /* current harness */)
```

Each test creates a binary fixture, submits a file part, and asserts:

```typescript
expect(text.some((value) => value.includes("Cannot read binary file"))).toBe(false)
expect(text).toContain(`Referenced binary file path without reading contents: ${binaryPath}`)
expect(errors).toEqual([])
```

- [x] **Step 2: Run the tests and verify the regression**

Run from `packages/opencode`:

```bash
bun test test/session/prompt.test.ts --timeout 30000
```

Expected: the restored binary mention cases fail because the current pipeline invokes `Read`.

- [x] **Step 3: Implement the minimum current-pipeline adaptation**

In `SessionPrompt`, sample non-directory file parts before the `text/plain` automatic-read branch, classify them with the existing media utility, and return:

```typescript
[
  {
    messageID: info.id,
    sessionID: input.sessionID,
    type: "text" as const,
    synthetic: true,
    text: `Referenced binary file path without reading contents: ${part.source?.path ?? filepath}`,
  },
  { ...part, messageID: info.id, sessionID: input.sessionID },
]
```

Use the existing Effect filesystem service and a 4096-byte sample. Read failures fall through to the existing behavior; only a confirmed `binary` classification changes the path.

- [x] **Step 4: Verify focused behavior**

Run from `packages/opencode`:

```bash
bun test test/session/prompt.test.ts --timeout 30000
bun test test/util/media.test.ts test/tool/read.test.ts --timeout 30000
bun typecheck
```

Expected: all commands pass; direct binary `Read` tests continue expecting `Cannot read binary file`.

- [x] **Step 5: Review the final diff**

Run:

```bash
git diff --check
```

Expected: no whitespace errors and no unrelated changes.
