# Config Writeback Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project and global config writes survive reloads, consolidate conflicting global files on explicit writes, and cover the remaining `FileChangesPanel` interactions.

**Architecture:** Keep all config behavior in `Config.Service`. Project writes use a project-directory `EffectFlock`, target the highest-priority file, and reconcile complete resolved state against an index-aligned target-resolved/target-raw pair. Global update and replace share a global-directory `EffectFlock` writer that fresh-reads, reconciles, recursively syncs the retained target, then removes obsolete candidates. Array reconciliation tracks exact unused sources before positional fallback.

**Tech Stack:** TypeScript, Effect v4, Bun test, React Testing Library, Vitest.

## Global Constraints

- Use vfox-managed Bun `1.3.14` and Node.js `22.23.1`.
- Do not add dependencies or change public Protocol/HttpApi contracts.
- Do not edit generated files.
- Do not stage, commit, push, merge, or revert unrelated working-tree changes.
- Follow TDD: run each new regression test and observe the expected failure before changing production code.

---

### Task 1: Project Config Writeback

**Files:**
- Modify: `packages/opencode/test/config/config.test.ts`
- Modify: `packages/opencode/src/config/config.ts`

**Interfaces:**
- Consumes: `Config.Interface.update(config: Config.Info)` and `Config.Interface.reload()`.
- Produces: project updates persisted in the existing highest-priority `opencode.jsonc` or `opencode.json`, defaulting to `opencode.json`, and visible after reload without materializing raw tokens.

- [ ] **Step 1: Add project reload, inheritance, and raw-preservation regressions**

Cover the default `opencode.json` target and an existing `opencode.jsonc` target. The JSONC case must update a same-name field, remain effective after reload, retain env/file/plugin source text, and retain an unrelated nested comment. Full `Config.get()` payload regressions must not copy lower-project env/file tokens or global env secrets into the target. Mixed-source `instructions` and `plugin` regressions must edit complete arrays, retain target raw tokens and new entries, omit inherited entries from the target, validate with `ConfigV1.Info`, and verify reload merge order.

- [ ] **Step 2: Run the focused test and verify RED**

Run from `packages/opencode`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/config/config.test.ts --timeout 30000
```

Expected: FAIL because `Config.update()` does not select the existing highest-priority file, target-only resolved comparison misclassifies inherited values, and concurrent project writes are not serialized.

- [ ] **Step 3: Implement raw-aware project writeback**

Acquire an `EffectFlock` keyed by the project directory. Inside it, select `opencode.jsonc` over `opencode.json`, default to `opencode.json`, fresh-read target raw and target-resolved, compare against complete `Config.get()`, reconcile, apply with `patchJsonc()`, and reload. Only target-resolved and target-raw arrays share indices. Complete resolved arrays identify inherited values, which are omitted from the target; exact target matches restore raw entries and unmatched new values remain literal. Apply `Effect.orDie` to lock errors.

- [ ] **Step 4: Add and run a concurrent project update regression**

Start two project updates for different fields concurrently and verify both survive. Run the Step 2 command and expect all tests in `config.test.ts` to pass.

- [ ] **Step 5: Run the config test and verify GREEN**

Run the Step 2 command. Expected: all tests in `config.test.ts` pass.

---

### Task 2: Safe Global Config Consolidation

**Files:**
- Modify: `packages/opencode/test/config/config.test.ts`
- Modify: `packages/opencode/src/config/config.ts`

**Interfaces:**
- Consumes: `Config.Interface.getGlobal()`, `updateGlobal(config)`, and `replaceGlobal(config)`.
- Produces: `{ info, changed }` based on one retained global file, with no lower-priority values able to reappear and no unchanged resolved secret or plugin value materialized.

- [ ] **Step 1: Add failing raw-preservation regressions**

For both update and replace, start from env/file tokens and a relative plugin path. Send back resolved values, including the whole provider object, while changing one unrelated field. Verify persisted text retains every raw representation and reload still resolves them.

- [ ] **Step 2: Add failing freshness, failure, concurrency, and comment regressions**

Cover cache warmup followed by an external disk edit, target success followed by obsolete cleanup failure, two concurrent updates of different fields, and an unrelated JSONC update preserving nested provider and permission comments. Keep the existing consolidation, target-ordering, and legacy-key tests.

- [ ] **Step 3: Run focused config tests and verify RED**

Run the Task 1 Step 2 command. Expected: the new tests fail for resolved-value materialization, stale-cache overwrite, missing failure invalidation, lost concurrent fields, comment replacement, and the wrong project target.

- [ ] **Step 4: Add raw loaders and recursive reconciliation**

Parse raw files with JSONC, `normalizeLoadedConfig()`, and `ConfigV1.Info` without substitution or plugin resolution. Fresh-merge raw and resolved global views in existing low-to-high priority order. Reconcile records by key. For arrays, reserve exact matches from unused resolved indices before using an available original index for cautious recursive fallback; keep unmatched input unchanged and never reuse an index for duplicates.

- [ ] **Step 5: Add recursive JSONC synchronization**

Skip deeply equal values. For records, add, remove, or recurse one key at a time. Replace only changed arrays and primitives. Validate the final raw `ConfigV1.Info` before writing so lower-priority values materialize, stale and legacy keys disappear, and unchanged nested comments survive.

- [ ] **Step 6: Serialize the complete global mutation**

Acquire `EffectFlock` using a key based on `Global.Path.config`. Keep fresh reads, reconciliation, target selection, target write, and obsolete deletion inside the lock. Apply `Effect.orDie` to lock errors and add `EffectFlock.node` to `Config.node` dependencies.

- [ ] **Step 7: Guarantee invalidation and source ordering**

Write the target before deleting obsolete files. Put `invalidate()` in an `ensuring` finalizer inside the lock so cleanup failure remains an operation failure while subsequent `getGlobal()` reloads the successfully written target.

- [ ] **Step 8: Run focused tests and verify GREEN**

Run the Task 1 Step 2 command. Expected: `118 pass`, `0 fail`.

- [ ] **Step 9: Run package typecheck**

Run from `packages/opencode`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun typecheck
```

Expected: exit code `0`.

---

### Task 3: FileChangesPanel Interaction Coverage

**Files:**
- Modify: `packages/opencode/webgui/src/components/FileChangesPanel.test.tsx`

**Interfaces:**
- Consumes: the added-file element's button role and `useOpenFile()` callback.
- Produces: regression coverage for aggregate counts and mouse/keyboard activation; no production change.

- [ ] **Step 1: Add aggregate assertions**

In the existing updating test, add:

```ts
expect(screen.getByText("3 files")).toBeInTheDocument()
expect(screen.getByText("+2")).toBeInTheDocument()
expect(screen.getByText("-1")).toBeInTheDocument()
expect(screen.getByText("net +1")).toBeInTheDocument()
```

- [ ] **Step 2: Add an added-file interaction test**

Import `fireEvent` from React Testing Library and add:

```ts
it("opens an added file with mouse and keyboard", () => {
  render(<FileChangesPanel diffs={[]} />)
  const added = screen.getByTitle("src/new.ts")

  fireEvent.click(added)
  fireEvent.keyDown(added, { key: "Enter" })
  fireEvent.keyDown(added, { key: " " })

  expect(mocks.openFile).toHaveBeenCalledTimes(3)
  expect(mocks.openFile).toHaveBeenNthCalledWith(1, { path: "src/new.ts", display: "src/new.ts" })
  expect(mocks.openFile).toHaveBeenNthCalledWith(2, { path: "src/new.ts", display: "src/new.ts" })
  expect(mocks.openFile).toHaveBeenNthCalledWith(3, { path: "src/new.ts", display: "src/new.ts" })
})
```

- [ ] **Step 3: Run the focused component test**

Run from `packages/opencode/webgui`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run src/components/FileChangesPanel.test.tsx
```

Expected: `5/5` tests pass. These tests cover existing behavior, so an initial RED run is not required; no production code is added.

---

### Task 4: Final Verification

**Files:**
- Verify only; do not modify generated output.

**Interfaces:**
- Consumes: all changes from Tasks 1-3.
- Produces: test, typecheck, build, and whitespace evidence.

- [ ] **Step 1: Run the owning package config test**

Run from `packages/opencode`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/config/config.test.ts --timeout 30000
```

Expected: all tests pass.

- [ ] **Step 2: Run the full WebGUI suite**

Run from `packages/opencode/webgui`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test:run
```

Expected: all test files pass.

- [ ] **Step 3: Run the WebGUI production build**

Run from `packages/opencode/webgui`:

```powershell
vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run build
```

Expected: exit code `0`; the existing large-chunk warning may remain.

- [ ] **Step 4: Check the scoped diff**

Run from the repository root:

```powershell
git diff --check -- packages/opencode/src/config/config.ts packages/opencode/test/config/config.test.ts packages/opencode/webgui/src/components/FileChangesPanel.test.tsx docs/superpowers/specs/2026-07-30-config-writeback-design.md docs/superpowers/plans/2026-07-30-config-writeback.md
```

Expected: exit code `0` with no whitespace errors.
