# Session Title Regeneration Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore manual session title regeneration for multi-turn conversations while leaving automatic first-turn naming unchanged.

**Architecture:** Keep the existing `SessionPrompt` title-generation path. Interpret `force: true` as a full-history manual request: select the last real user message as the focus and pass complete history to the model; preserve the existing first-turn guard and context for automatic naming.

**Tech Stack:** TypeScript, Effect v4, Bun `1.3.14`, Node.js `22.23.1`, Bun test, existing `TestLLMServer`.

## Global Constraints

- Use vfox-managed Bun `1.3.14` and Node.js `22.23.1`.
- Do not change the public Protocol, `HttpApi`, generated SDK, WebGUI click wiring, or title prompt text.
- Do not add dependencies, retries, loading state, or unrelated refactors.
- Run tests from package directories, never from the repository root.
- Follow TDD: observe the focused regression failing before editing production code.

---

### Task 1: Restore Full-History Manual Title Generation

**Files:**
- Modify: `packages/opencode/test/session/prompt.test.ts`
- Modify: `packages/opencode/src/session/prompt.ts:210-270`

**Interfaces:**
- Consumes: `SessionPrompt.Interface.regenerateTitle(sessionID: SessionID)` and the existing `force?: boolean` title-generation input.
- Produces: manual regeneration that uses complete history and returns the persisted session with its new title; automatic generation behavior remains unchanged.

- [ ] **Step 1: Add the failing multi-turn regression**

Add this test near the other `SessionPrompt` title/loop tests in `packages/opencode/test/session/prompt.test.ts`:

```ts
it.instance("regenerateTitle uses complete history after multiple user turns", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const { prompt, sessions, chat } = yield* boot({ title: "Old title" })
    yield* user(chat.id, "first request")
    yield* user(chat.id, "latest correction")

    const updated = yield* prompt.regenerateTitle(chat.id)

    expect(updated.title).toBe("E2E Title")
    expect((yield* sessions.get(chat.id)).title).toBe("E2E Title")
    const titleInput = (yield* llm.inputs).find((input) =>
      JSON.stringify(input).includes("Generate a title for this conversation"),
    )
    expect(JSON.stringify(titleInput)).toContain("first request")
    expect(JSON.stringify(titleInput)).toContain("latest correction")
  }),
)
```

- [ ] **Step 2: Run the focused test and verify RED**

Run from `packages/opencode`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/session/prompt.test.ts -t "regenerateTitle uses complete history" --timeout 30000
```

Expected: FAIL because `updated.title` remains `"Old title"`; the current multi-user guard returns before the title LLM request.

- [ ] **Step 3: Implement the minimum full-history branch**

In `packages/opencode/src/session/prompt.ts`, replace the current real-user selection, one-user guard, context selection, focused-user selection, and `msgs` construction inside `title(...)` with:

```ts
const realUserIndexes = input.history.flatMap((message, index) => {
  if (message.info.role !== "user") return []
  if (message.parts.every((part) => "synthetic" in part && part.synthetic)) return []
  return [index]
})
if (realUserIndexes.length === 0) return
if (!input.force && realUserIndexes.length !== 1) return

const focusIndex = input.force ? realUserIndexes[realUserIndexes.length - 1] : realUserIndexes[0]
if (focusIndex === undefined) return
const context = input.force ? input.history : input.history.slice(0, focusIndex + 1)
const focusUser = input.history[focusIndex]
if (!focusUser || focusUser.info.role !== "user") return
const firstInfo = focusUser.info

const subtasks = focusUser.parts.filter((part): part is SessionV1.SubtaskPart => part.type === "subtask")
const onlySubtasks = subtasks.length > 0 && focusUser.parts.every((part) => part.type === "subtask")
```

After model resolution, construct messages as:

```ts
const msgs =
  onlySubtasks && !input.force
    ? [{ role: "user" as const, content: subtasks.map((part) => part.prompt).join("\n") }]
    : yield* MessageV2.toModelMessagesEffect(context, mdl).pipe(
        Effect.map((messages) =>
          onlySubtasks
            ? [...messages, { role: "user" as const, content: subtasks.map((part) => part.prompt).join("\n") }]
            : messages,
        ),
      )
```

Keep the existing LLM request, title cleanup, persistence, and `regenerateTitle()` service method unchanged.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the Step 2 command again.

Expected: `1 pass`, `0 fail`; the recorded title request contains both user messages and the stored title is `"E2E Title"`.

- [ ] **Step 5: Run related backend and WebGUI regressions**

Run from `packages/opencode`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/session/prompt.test.ts test/server/session-regenerate-title.test.ts --timeout 30000
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun typecheck
```

Run from `packages/opencode/webgui`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run -- src/state/SessionContext.test.tsx src/components/CompactHeader/index.test.tsx src/components/CompactHeader/TabBar.test.tsx src/components/CompactHeader/TabContextMenu.test.tsx
```

Expected: all commands exit `0`; the existing automatic title and tab click behavior remain green.

- [ ] **Step 6: Check the scoped diff**

Run from the repository root:

```powershell
git diff --check -- packages/opencode/src/session/prompt.ts packages/opencode/test/session/prompt.test.ts
git diff --stat -- packages/opencode/src/session/prompt.ts packages/opencode/test/session/prompt.test.ts
```

Expected: `diff --check` has no errors and only the two planned implementation files are changed.

- [ ] **Step 7: Commit the repair**

```powershell
git add packages/opencode/src/session/prompt.ts packages/opencode/test/session/prompt.test.ts
git commit -m "fix(opencode): restore session title regeneration"
```
