# Windows opencode Test Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the unchanged `packages/opencode` default test command exit 0 deterministically on Windows without retries, sleeps, skips, timeout increases, or Windows-only production behavior.

**Architecture:** First make the Windows ripgrep-backed file index publish its real completion boundary: retain the existing scoped initial-scan Fiber and join it before reading the in-memory index. Then use an unchanged full-suite baseline plus Bun's native isolation diagnostics to distinguish cross-file test-state leakage from a child-process lifecycle defect; only the confirmed boundary may change. Keep file-search and any remaining test-runner or Git lifecycle correction in separate commits.

**Tech Stack:** TypeScript, Bun `1.3.14`, Node.js `22.23.1`, Effect v4, Bun test, Git, ripgrep.

## Global Constraints

- Run package commands through `vfox exec bun@1.3.14 nodejs@22.23.1 --`.
- Run tests and `bun typecheck` from package directories, never from the repository root.
- Keep the acceptance command exactly `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test` from `packages/opencode`.
- Do not change the existing 30-second package timeout or the affected tests' local timeouts.
- Do not add retries, sleeps, skips, forced exits, cleanup retries, or Windows-only production shims.
- Do not delete tests or weaken existing assertions.
- Treat `--max-concurrency` and `--isolate` runs as diagnostics until their evidence identifies the owning boundary.
- Do not modify or stage the user-owned dirty paths recorded in the approved design and baseline report.
- Keep generated Client output unchanged; this work does not alter public Protocol or Server `HttpApi`.
- Stop before any production or fixture change that lacks a focused failing reproduction.

---

## Existing Evidence

- Default package baseline: `3517 pass / 58 skip / 1 todo / 9 fail / 1 error` after about 56 minutes.
- All seven affected files in one fresh process: `89 pass / 14 skip / 0 fail` in `252.17s`.
- Prompt owner alone: `42 pass / 14 skip / 0 fail` in `47.31s`.
- Windows sets `Flag.OPENCODE_DISABLE_FFF` to `true`, so the affected indexed searches use `FileSystemSearch.ripgrepLayer`; do not change FFF for this task.
- `ripgrepLayer` forks its initial scan and immediately exposes empty state. Direct `Ripgrep.glob/find` calls consume streams and wait for process close, so their aggregate failures require separate evidence.

### Task 1: Freeze The Reproduction Boundary

**Files:**
- Modify after the commands finish: `docs/superpowers/reports/2026-07-27-upstream-test-baseline.md`
- Reference: `docs/superpowers/specs/2026-07-28-windows-test-stability-design.md`

**Interfaces:**
- Consumes: the unchanged default package command and the seven affected owner files.
- Produces: exact failure text, process telemetry, and a binary decision about local owner concurrency versus cumulative suite state.

- [x] **Step 1: Run all affected owners in one fresh process**

Run from `packages/opencode`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/server/httpapi-file.test.ts test/server/httpapi-sdk.test.ts test/session/prompt.test.ts test/tool/glob.test.ts test/tool/skill.test.ts test/server/httpapi-session.test.ts test/server/project-copy.test.ts --timeout 30000 --only-failures
```

Observed: exit 0, `89 pass / 14 skip / 0 fail`. This rules out a failure intrinsic to the seven-file owner set.

- [ ] **Step 2: Complete one unchanged default-suite baseline**

Run from `packages/opencode`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test
```

Expected for the pre-fix baseline: exit nonzero with the exact aggregate signatures preserved. Record every failed test name, the first causal stack frame, stderr from child processes, total duration, pass/skip/todo/fail/error counts, and Bun process working set/private bytes/handle count near the first failure.

- [ ] **Step 3: Run the required native concurrency diagnostic once**

Run the same seven owners with Bun's minimum test concurrency:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/server/httpapi-file.test.ts test/server/httpapi-sdk.test.ts test/session/prompt.test.ts test/tool/glob.test.ts test/tool/skill.test.ts test/server/httpapi-session.test.ts test/server/project-copy.test.ts --timeout 30000 --only-failures --max-concurrency=1
```

Expected: exit 0. If both the default-concurrency and single-concurrency owner processes pass, do not use `--max-concurrency` as a fix; the remaining boundary is cumulative cross-file state.

- [ ] **Step 4: Record the diagnostic evidence**

Append a `Windows Test Stability` section to `docs/superpowers/reports/2026-07-27-upstream-test-baseline.md` containing:

```markdown
## Windows Test Stability

- Baseline HEAD: `345db4e976ddf9cc2ce485a13899c9c20dec7794`
- Default suite: copy the exact exit code, counts, and elapsed time printed by Step 2.
- Seven-owner process: exit 0, 89 pass / 14 skip / 0 fail, 252.17s
- Seven-owner max-concurrency=1 process: copy the exact exit code, counts, and elapsed time printed by Step 3.
- Process telemetry at first failure: copy the sampled working set, private bytes, handle count, and child-process counts.
- Classification: state exactly one evidence-backed boundary: indexed-search readiness, cumulative cross-file state, or a confirmed child-process phase.
```

Do not commit the report yet; include it with the final evidence commit after the two acceptance runs.

### Task 2: Make Ripgrep Index Readiness Observable

**Files:**
- Modify: `packages/core/test/location-filesystem.test.ts`
- Modify: `packages/core/src/filesystem/search.ts`

**Interfaces:**
- Consumes: `Ripgrep.Service.find(...)`, its existing `onEntry` callback, and the location layer's `Scope.Scope`.
- Produces: one shared `Fiber<void>` whose completion is joined by `FileSystemSearch.Service.find(...)` before it reads `state.files` or `state.directories`.

- [ ] **Step 1: Add a deterministic failing readiness test**

In `packages/core/test/location-filesystem.test.ts`, add `Deferred`, `Fiber`, and `Scope` to the Effect import and import `Flag` plus `Ripgrep`:

```ts
import { Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
```

Add this test inside `describe("FileSystem", ...)`:

```ts
it.live("waits for the initial search scan before finding files", () =>
  withTmp((directory) =>
    Effect.gen(function* () {
      const previous = Flag.OPENCODE_DISABLE_FFF
      Flag.OPENCODE_DISABLE_FFF = true
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          Flag.OPENCODE_DISABLE_FFF = previous
        }),
      )

      const started = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const completed = yield* Deferred.make<void>()
      const entry = FileSystem.Entry.make({ path: RelativePath.make("ready.txt"), type: "file" })
      const ripgrep = Layer.mock(Ripgrep.Service, {
        find: (input) =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(input.onEntry?.(entry) ?? Effect.void),
            Effect.as([entry]),
          ),
      })

      return yield* Effect.gen(function* () {
        const service = yield* FileSystem.Service
        const scope = yield* Scope.Scope
        yield* Deferred.await(started)
        const found = yield* service
          .find({ query: "ready", type: "file", limit: 10 })
          .pipe(Effect.tap(() => Deferred.succeed(completed, undefined)), Effect.forkIn(scope))

        yield* Effect.yieldNow
        expect(yield* Deferred.isDone(completed)).toBe(false)

        yield* Deferred.succeed(release, undefined)
        expect((yield* Fiber.join(found)).map((item) => item.path)).toEqual([entry.path])
      }).pipe(
        Effect.provide(
          LayerNode.compile(FileSystem.node, [
            [
              Location.node,
              Layer.succeed(
                Location.Service,
                Location.Service.of(location({ directory: AbsolutePath.make(directory) })),
              ),
            ],
            [Ripgrep.node, ripgrep],
          ]),
        ),
      )
    }),
  ),
)
```

- [ ] **Step 2: Run the readiness test and verify RED**

Run from `packages/core`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/location-filesystem.test.ts --only-failures
```

Expected: exit 1 because `find` completes while the mocked initial scan is still blocked, so `Deferred.isDone(completed)` is `true` instead of `false`.

- [ ] **Step 3: Join the existing scoped initial scan**

In `packages/core/src/filesystem/search.ts`, add `Fiber` to the Effect import:

```ts
import { Context, Effect, Fiber, Layer, Scope } from "effect"
```

Retain the Fiber returned by the existing initial scan:

```ts
const scan = yield* ripgrep
  .find({
    cwd: location.directory,
    pattern: "*",
    limit: location.vcs ? Number.MAX_SAFE_INTEGER : 100_000,
    onEntry: (entry) =>
      Effect.sync(() => {
        state.files.push(entry.path)
        const parts = entry.path.split("/")
        parts.slice(0, -1).forEach((_, index) => directories.add(parts.slice(0, index + 1).join("/") + path.sep))
        state.directories = Array.from(directories)
      }),
  })
  .pipe(Effect.orDie, Effect.asVoid, Effect.forkIn(scope))
```

At the start of the existing `find` generator, wait for the same Fiber:

```ts
find: (input) =>
  Effect.gen(function* () {
    yield* Fiber.join(scan)
    const items =
      input.type === "file"
        ? state.files
        : input.type === "directory"
          ? state.directories
          : [...state.files, ...state.directories]
    return fuzzysort.go(input.query, items, { limit: input.limit ?? 50 }).map((item) => {
      const relative = item.target
      const type = relative.endsWith(path.sep) ? ("directory" as const) : ("file" as const)
      return FileSystem.Entry.make({
        path: RelativePath.make(relative),
        type,
      })
    })
  }),
```

Do not change `fffLayer`, `Ripgrep.run`, scan limits, timeout behavior, or the eager prewarm policy in this task.

- [ ] **Step 4: Run focused verification**

Run from `packages/core`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/location-filesystem.test.ts test/ripgrep.test.ts --only-failures
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun typecheck
```

Expected: both commands exit 0.

Run from `packages/opencode`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/server/httpapi-file.test.ts test/server/httpapi-sdk.test.ts --timeout 30000 --only-failures
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun typecheck
```

Expected: both commands exit 0 with unchanged test timeouts.

- [ ] **Step 5: Commit only the readiness correction**

```powershell
git add packages/core/src/filesystem/search.ts packages/core/test/location-filesystem.test.ts
git commit -m "fix(core): await file search readiness"
```

### Task 3: Resolve Only The Confirmed Aggregate Boundary

**Files:**
- Diagnostic candidate: `packages/opencode/package.json`
- Diagnostic reference: `packages/opencode/test/fixture/fixture.ts`
- Diagnostic reference: `packages/core/src/cross-spawn-spawner.ts`
- Test owners: `packages/opencode/test/server/httpapi-session.test.ts`
- Test owners: `packages/opencode/test/server/project-copy.test.ts`
- Test owners: `packages/opencode/test/session/prompt.test.ts`
- Test owners: `packages/opencode/test/tool/glob.test.ts`
- Test owners: `packages/opencode/test/tool/skill.test.ts`

**Interfaces:**
- Consumes: the post-Task-2 unchanged full-suite result and Bun's `--isolate` boundary.
- Produces: either one confirmed native test-file isolation change, or an explicit stop with no speculative code change and exact evidence for a revised root-specific task.

- [ ] **Step 1: Run the unchanged default suite once after Task 2**

Run from `packages/opencode`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test
```

Decision:

- Exit 0: skip the rest of Task 3; the indexed-search lifecycle correction removed the aggregate pressure and no Git/test-runner change is justified.
- Exit nonzero with only the original aggregate direct-ripgrep/Git signatures: continue to Step 2.
- Any new signature: stop, revert no committed work, and return to root-cause investigation for that signature before changing another file.

- [ ] **Step 2: Run one full test-file isolation diagnostic**

Run from `packages/opencode` without editing `package.json`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test --isolate --timeout 30000 --only-failures
```

Decision:

- Exit 0 while Step 1 reproduces only the known aggregate signatures: Bun's shared test-file global/handle boundary is confirmed; continue to Step 3.
- Exit nonzero with the same signatures: do not edit `package.json`, `fixture.ts`, or `cross-spawn-spawner.ts`. Record the first child-process `spawn -> streams -> close -> scope finalizer` phase that failed and replace this task with a focused RED plus its root-specific implementation before proceeding.

- [ ] **Step 3: Make native test-file isolation part of the existing default script**

Change only the `test` script in `packages/opencode/package.json`:

```json
"test": "bun test --isolate --timeout 30000 --only-failures"
```

This preserves the user-facing acceptance command and every timeout while asking Bun to release each file's globals and leaked handles at the boundary Bun owns.

- [ ] **Step 4: Re-run the seven affected owners through the package environment**

Run from `packages/opencode`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test --isolate test/server/httpapi-file.test.ts test/server/httpapi-sdk.test.ts test/session/prompt.test.ts test/tool/glob.test.ts test/tool/skill.test.ts test/server/httpapi-session.test.ts test/server/project-copy.test.ts --timeout 30000 --only-failures
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun typecheck
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit only the confirmed aggregate-boundary correction**

```powershell
git add packages/opencode/package.json
git commit -m "test(opencode): isolate test files"
```

Do not create this commit if Step 2 did not exit 0.

### Task 4: Run The Reliability Gate And Close The Work

**Files:**
- Modify: `docs/superpowers/reports/2026-07-27-upstream-test-baseline.md`
- Verify only: all files changed by Tasks 2 and 3.

**Interfaces:**
- Consumes: the final implementation and the unchanged external acceptance command.
- Produces: two independent exit-0 suite runs, package typechecks, cleanup evidence, boundary audits, and final review evidence.

- [ ] **Step 1: Run the first clean acceptance process**

From `packages/opencode`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test
```

Expected: exit 0. A failure is not retried; return to the failing owner's root-cause task.

- [ ] **Step 2: Verify process and temporary-resource cleanup**

After the first process exits, confirm there is no descendant or test-owned Bun, Node.js, Git, or ripgrep process and no `opencode-test-*` or test-owned worktree directory. Record the result in the report.

- [ ] **Step 3: Run the second independent acceptance process**

Start a new process from `packages/opencode`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test
```

Expected: exit 0. This is the reliability gate, not a retry of Step 1.

- [ ] **Step 4: Run final typechecks**

From `packages/core`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun typecheck
```

From `packages/opencode`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun typecheck
```

Expected: both exit 0.

- [ ] **Step 5: Run boundary audits**

From the repository root:

```powershell
git diff --check
git diff -- packages/client/src/generated packages/client/src/generated-effect
git status --short
```

Expected: whitespace check exits 0, generated diff is empty, staged paths contain only the intended task commit inputs, and the pre-existing user-owned dirty paths are unchanged.

Search the final diff for prohibited workarounds and confirm there are no added retry loops, fixed sleeps, skip markers, forced exits, cleanup retries, timeout increases, lower default concurrency, or Windows-only production branches.

- [ ] **Step 6: Complete final review**

Request a read-only review over the task's commit range. Require zero Critical and zero Important findings. Fix findings in new commits and repeat the owning focused checks plus both acceptance processes when runtime behavior changes.

- [ ] **Step 7: Finalize and commit the evidence report**

Update `docs/superpowers/reports/2026-07-27-upstream-test-baseline.md` with exact command lines, commits, counts, durations, cleanup results, audit results, and review disposition.

```powershell
git add docs/superpowers/reports/2026-07-27-upstream-test-baseline.md
git commit -m "docs(test): record Windows suite stability"
```

The work is complete only after both unchanged acceptance commands exit 0.
