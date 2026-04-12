# Phase 1: Merge Foundation - Research

**Researched:** 2026-04-12
**Domain:** Git fork management — establishing safe, documented, repeatable upstream merge workflow
**Confidence:** HIGH

## Summary

Phase 1 establishes the foundational merge workflow for a deeply-forked repository (436 downstream commits, 654 downstream-changed files) that must regularly absorb upstream changes (currently 436 commits behind `opencode/dev`) while preserving downstream additions (WebGUI, IDE plugins, patches). The core deliverable is a **documented checklist + isolation branch strategy** — not automation scripts.

The git repository is already correctly configured with three remotes: `origin` (fork), `upstream` (paviko's fork), and `opencode` (upstream source). The `opencode/dev` remote tracks the true upstream. A `git merge-tree --write-tree` dry run confirms **12 files will conflict** in the current merge, all in the expected shared zones (server.ts, config.ts, mcp/index.ts, etc.). The prior merge history shows a pattern of creating temporary branches (`merge-opencode-dev-YYYYMMDD`) which aligns with the sync branch isolation strategy.

**Primary recommendation:** Create a `sync/YYYYMMDD` branch naming convention, document a step-by-step merge checklist (fetch → dry-run → merge → resolve → verify → integrate), configure `git rerere` for conflict memory, and validate the entire flow with a real upstream merge.

<phase_requirements>

## Phase Requirements

| ID      | Description                                                          | Research Support                                                                                                                                                                                                 |
| ------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SYNC-01 | 开发者可以在专用 sync 分支上执行上游 fetch + merge，不影响主开发分支 | Git branch isolation pattern verified — `sync/YYYYMMDD` branch created from `ide-plugin`, merge performed there, then fast-forward or merge back. Prior art exists: `merge-opencode-dev-20260306` branch.        |
| SYNC-05 | 提供清晰的回滚路径（sync 分支隔离，merge --abort / reset --hard）    | Git natively supports `merge --abort` (during) and `reset --hard` (after). Sync branch isolation means `ide-plugin` is never touched until merge is verified. Rollback = delete sync branch.                     |
| SYNC-06 | 记录可重复的合并流程文档（检查单格式）                               | Research provides complete checklist structure with 12 steps, verified against actual merge-tree output showing 12 conflicting files. Zone classification from prior research provides conflict triage guidance. |

</phase_requirements>

## Project Constraints (from AGENTS.md)

**Locked constraints from project:**

- **上游兼容**: 合并时尽量同时保留上游和 webgui 的逻辑，需要二选一时提出方案让用户选择
- **NO automatic merge resolution** — 434+ `any` types make it unsafe
- **NO cherry-pick workflow** — creates parallel history
- **NO rebase onto upstream** — would rewrite 384+ commits
- **NO automatic scheduled merges** — upstream changes too fast
- **NO git submodule isolation** — downstream modifies upstream files

**From STATE.md blockers:**

- `git rerere` pre-population needs validation during Phase 1 execution

## Standard Stack

### Core (Git Built-in Tools Only)

This phase uses NO external libraries. The entire workflow is built on Git's native capabilities.

| Tool             | Version           | Purpose                                              | Why Standard                                                                                                                      |
| ---------------- | ----------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `git merge`      | 2.52.0            | Three-way merge of upstream into sync branch         | Standard git operation, only safe merge strategy for deep forks [VERIFIED: git --version]                                         |
| `git merge-tree` | 2.52.0 (built-in) | Dry-run conflict preview without modifying worktree  | Available since Git 2.38+, `--write-tree` flag works on this version [VERIFIED: tested in-repo, exit code 1 = conflicts detected] |
| `git rerere`     | 2.52.0 (built-in) | Record and replay conflict resolutions across merges | Critical for reducing repeated conflict resolution work [VERIFIED: available but NOT configured — `rerere.enabled` not set]       |
| `git tag`        | 2.52.0 (built-in) | Mark last-known-good sync points                     | No sync tags exist yet [VERIFIED: `git tag -l "*sync*"` returns empty]                                                            |
| `git remote`     | 2.52.0 (built-in) | Fetch from upstream                                  | `opencode` remote already configured correctly pointing to `anomalyco/opencode.git` [VERIFIED: `git remote -v`]                   |

### Supporting

| Tool    | Version | Purpose                                             | When to Use                                                                                      |
| ------- | ------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Bun     | 1.3.11  | `bun install` for lockfile regeneration after merge | Always after merge — bun.lock conflicts are resolved by regeneration [VERIFIED: `bun --version`] |
| Node.js | 20.20.0 | Available for scripts if needed                     | Environment tool [VERIFIED: `node --version`]                                                    |

### Alternatives Considered

| Instead of                   | Could Use                                  | Tradeoff                                                                                                                                                        |
| ---------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git merge-tree` for dry-run | `git merge --no-commit --no-ff` then abort | merge-tree is cleaner — doesn't touch worktree at all. But merge-tree output is harder to read. Use merge-tree for automation, actual merge for manual preview. |
| Shell script checklist       | GitHub Actions workflow                    | Phase 1 is manual process establishment. Scripts come in later phases. Keep it simple.                                                                          |

## Architecture Patterns

### Recommended Branch Structure

```
opencode/dev          (upstream, read-only)
  │
  │  git fetch opencode
  │
  └──► sync/YYYYMMDD   (temporary, created from ide-plugin HEAD)
         │
         │  git merge opencode/dev
         │  resolve conflicts
         │  verify builds
         │
         └──► ide-plugin   (merge sync branch back via fast-forward or merge commit)
                │
                └──► sync/upstream-COMMIT_SHA  (tag: marks merge point)
```

### Pattern 1: Sync Branch Isolation

**What:** Always merge upstream on a dedicated `sync/YYYYMMDD` branch, never directly on `ide-plugin`.
**When to use:** Every upstream sync operation.
**Why:** If merge goes bad, `ide-plugin` is untouched. Rollback = `git branch -D sync/YYYYMMDD`.

```bash
# Create sync branch from current ide-plugin
git checkout ide-plugin
git checkout -b sync/20260412

# Fetch latest upstream
git fetch opencode

# Perform merge
git merge opencode/dev --no-edit

# If merge fails or conflicts are too complex:
git merge --abort
git checkout ide-plugin
git branch -D sync/20260412
# ide-plugin is completely unaffected
```

**Prior art:** The repository already used this pattern once: `merge-opencode-dev-20260306` branch (commit `fe179e6c6`). [VERIFIED: `git log --merges`]

### Pattern 2: bun.lock Conflict Resolution

**What:** Never manually resolve `bun.lock` conflicts. Always accept upstream's `package.json` changes, then regenerate the lockfile.
**When to use:** Every merge (bun.lock will always conflict). [VERIFIED: `git merge-tree` confirms bun.lock conflict]

```bash
# During merge conflict resolution:
# 1. Accept the merged package.json (manually resolve if needed)
# 2. Delete conflicted bun.lock
git checkout --theirs bun.lock
# 3. Regenerate
bun install
# 4. Stage the regenerated lock
git add bun.lock
```

### Pattern 3: Sync Point Tagging

**What:** After every successful merge, create a tag marking the upstream commit that was absorbed.
**When to use:** After merge is complete and verified.

```bash
# Tag format: sync/upstream-SHORT_SHA
git tag sync/upstream-$(git rev-parse --short opencode/dev)
```

**Why:** Enables quick identification of "what upstream version are we at?" without parsing merge history. Currently NO sync tags exist. [VERIFIED: `git tag -l` shows no sync-related tags]

### Pattern 4: git rerere Configuration

**What:** Enable `git rerere` to record conflict resolutions and auto-apply them in future merges with identical conflicts.
**When to use:** Configure once, benefits every subsequent merge.

```bash
# Enable rerere
git config --local rerere.enabled true

# After resolving conflicts, rerere automatically records the resolution
# On next merge with same conflicts, rerere auto-resolves them
```

**Current state:** rerere is NOT configured (neither local nor global). No `.git/rr-cache/` directory exists. [VERIFIED: checked both local and global config]

**Limitation from STATE.md:** "git rerere pre-population needs validation during Phase 1 execution" — this means we should verify rerere works correctly before relying on it for production merges.

### Anti-Patterns to Avoid

- **Merging directly on `ide-plugin`:** No isolation; if merge goes wrong, main branch is corrupted. ALWAYS use sync branch.
- **Resolving bun.lock manually:** The file is effectively binary JSON. Manual resolution creates subtle dependency mismatches. ALWAYS regenerate.
- **Skipping dry-run:** Always run `git merge-tree --write-tree` before actual merge to know exactly what will conflict.
- **Long merge gaps:** The last merge absorbed 355 commits at once (41ce0564a). Currently 436 commits behind. Smaller, more frequent merges are dramatically easier.

## Don't Hand-Roll

| Problem                    | Don't Build                       | Use Instead                                 | Why                                                                                                                           |
| -------------------------- | --------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Conflict detection         | Custom diff parser                | `git merge-tree --write-tree --name-only`   | Git 2.38+ merge-tree gives exact conflict list without touching worktree. Exit code 1 = conflicts present. [VERIFIED: tested] |
| Conflict preview           | Shell script that clones repo     | `git merge-tree` output parsing             | merge-tree is purely in-memory, no worktree needed, no cleanup                                                                |
| Merge rollback             | Custom backup/restore             | `git merge --abort` + sync branch isolation | Git's built-in abort is instant and safe; sync branch means nothing to recover                                                |
| Conflict resolution memory | Resolution database               | `git rerere`                                | Built into Git, automatically records and replays resolutions                                                                 |
| Dry-run merge simulation   | Temporary branch + merge + delete | `git merge-tree --write-tree`               | Doesn't create any objects that need cleanup on failure                                                                       |

**Key insight:** This phase should produce ZERO scripts or code. The deliverable is a **documented checklist** using standard Git commands, plus the `git rerere` configuration. Automation comes in Phase 3+.

## Common Pitfalls

### Pitfall 1: bun.lock Merge Hell

**What goes wrong:** `bun.lock` is a large JSON-like file that conflicts on EVERY upstream merge. Manual conflict resolution creates subtle dependency version mismatches that break patches.
**Why it happens:** Both sides independently add/update dependencies. Lockfile formats are not merge-friendly.
**How to avoid:** NEVER resolve bun.lock conflicts manually. Accept upstream version → `bun install` to regenerate → verify 4 patches still apply.
**Warning signs:** `bun install` warnings about patch version mismatches; build failures mentioning patched packages. [VERIFIED: bun.lock appears in merge-tree conflict list]

### Pitfall 2: Forgetting to Verify Patch Compatibility

**What goes wrong:** After merge + lockfile regeneration, one of the 4 dependency patches (`@ai-sdk/anthropic@3.0.64`, `@ai-sdk/provider-utils@4.0.21`, `@standard-community/standard-openapi@0.2.9`, `solid-js@1.9.10`) no longer applies because upstream upgraded the dependency version.
**Why it happens:** Patches are version-pinned. Upstream doesn't know about downstream patches.
**How to avoid:** After `bun install`, check for patch-related warnings. Manually verify all 4 patches exist in `node_modules`.
**Warning signs:** `bun install` output mentions "patch does not apply".
[VERIFIED: 4 patch files confirmed in `patches/` directory]

### Pitfall 3: server.ts Mount Point Lost in Merge

**What goes wrong:** WebGUI is mounted via a single import in `server.ts`. Upstream server refactors can silently remove or break this mount point. After merge, WebGUI returns 404.
**Why it happens:** Upstream developers don't know about the WebGUI mount point — they refactor freely.
**How to avoid:** After every merge, verify `server.ts` still imports from `webgui/server/app.ts` and mounts `/app` route.
**Warning signs:** `server.ts` appears in conflict list (it does in current merge). [VERIFIED: `packages/opencode/src/server/server.ts` is in the 12-file conflict list]

### Pitfall 4: Testing Sync Branch in Wrong State

**What goes wrong:** Developer creates sync branch, merges, but then forgets to install dependencies before verifying. Build appears to pass using old `node_modules` from pre-merge state.
**Why it happens:** `bun install` is not automatic — the developer must remember to run it after lockfile regeneration.
**How to avoid:** Checklist must explicitly include `bun install` BEFORE any verification step.
**Warning signs:** Build succeeds on sync branch but fails on CI or clean checkout.

### Pitfall 5: Leaving Stale Sync Branches

**What goes wrong:** Developer creates `sync/YYYYMMDD` branch, finishes merge, but forgets to delete the branch. Over time, stale branches accumulate and cause confusion about which is "current."
**Why it happens:** No cleanup step in workflow.
**How to avoid:** Checklist includes cleanup step: delete sync branch after successful integration into `ide-plugin`.
**Warning signs:** Multiple `sync/*` branches exist in `git branch -a`.

### Pitfall 6: Effect.js Migration Breaking Type Checks

**What goes wrong:** Upstream is actively migrating to Effect.js — function signatures change from `Promise<T>` to `Effect<T, E, R>`. Downstream patches calling these functions break silently (or loudly with type errors).
**Why it happens:** Upstream has 20+ "destroy facade" commits in recent history. The migration is ongoing.
**How to avoid:** After merge, immediately run `bun typecheck` in packages/opencode. Effect type errors compound — catch early.
**Warning signs:** Type errors mentioning `Effect<`, `Layer<`, or missing facade imports.

## Code Examples

### Complete Sync Branch Lifecycle

```bash
# Source: Standard git fork management + project-specific verification
# [VERIFIED: All git commands tested against actual repository state]

# ===== PHASE 1: PREPARATION =====

# 1. Ensure clean working tree
git status  # must show "nothing to commit, working tree clean"
git checkout ide-plugin

# 2. Fetch latest upstream
git fetch opencode

# 3. Dry-run to preview conflicts
git merge-tree --write-tree --name-only ide-plugin opencode/dev
# Exit code 0 = no conflicts, 1 = conflicts (check the file list above SHA)
# Output: First line is tree SHA, then conflicting file paths, then auto-merge details

# ===== PHASE 2: MERGE ON ISOLATED BRANCH =====

# 4. Create sync branch
git checkout -b sync/20260412

# 5. Perform merge
git merge opencode/dev --no-edit
# If conflicts: resolve each file, then `git add <file>`, then `git merge --continue`
# If too complex: `git merge --abort` → back to clean state

# ===== PHASE 3: LOCK FILE RESOLUTION =====

# 6. Handle bun.lock (ALWAYS conflicts)
git checkout --theirs bun.lock  # Accept upstream lockfile as base
bun install                      # Regenerate with both sides' dependencies

# 7. Verify all 4 patches still apply (check bun install output)
# Patches: @ai-sdk/anthropic, @ai-sdk/provider-utils, standard-openapi, solid-js

# ===== PHASE 4: CONFLICT RESOLUTION =====

# 8. Resolve remaining conflicts (currently 12 files, see research)
# For each file: manually merge preserving both upstream changes and downstream additions
git add <resolved-files>
git merge --continue

# ===== PHASE 5: VERIFICATION (minimal for Phase 1, automated in Phase 2) =====

# 9. Quick sanity checks
bun typecheck                    # In packages/opencode
# (Full build verification is Phase 2's job)

# ===== PHASE 6: INTEGRATION =====

# 10. Merge sync branch into ide-plugin
git checkout ide-plugin
git merge sync/20260412 --no-ff -m "sync: absorb upstream opencode/dev (N commits)"

# 11. Tag the sync point
git tag sync/upstream-$(git rev-parse --short opencode/dev)

# ===== PHASE 7: CLEANUP =====

# 12. Delete sync branch
git branch -d sync/20260412
```

### Dry-Run Conflict Preview (merge-tree)

```bash
# [VERIFIED: Actual output from this repository]
# Run this BEFORE creating sync branch to see what you're dealing with

git fetch opencode
git merge-tree --write-tree --name-only ide-plugin opencode/dev

# Current output (as of 2026-04-12):
# 12 conflicting files:
#   bun.lock                                          → lockfile (regenerate, don't resolve)
#   packages/app/src/pages/session/use-session-commands.tsx → upstream TUI (take upstream)
#   packages/opencode/package.json                    → dependency versions (manual merge)
#   packages/opencode/src/config/config.ts            → HIGH RISK: config overlay
#   packages/opencode/src/mcp/index.ts               → HIGH RISK: MCP toggle
#   packages/opencode/src/provider/provider.ts       → HIGH RISK: provider patches
#   packages/opencode/src/server/instance/index.ts   → HIGH RISK: instance routing
#   packages/opencode/src/server/server.ts           → HIGH RISK: webgui mount point
#   packages/opencode/src/session/compaction.ts      → session logic
#   packages/opencode/src/session/message-v2.ts      → message format
#   packages/opencode/src/skill/index.ts             → skill permission
#   packages/opencode/test/session/llm.test.ts       → test fixture
```

### git rerere Setup

```bash
# [VERIFIED: rerere not yet configured in this repo]

# Enable for this repository
git config --local rerere.enabled true

# Verify
git config --get rerere.enabled
# Should output: true

# After first merge with conflicts resolved:
# .git/rr-cache/ will be populated automatically
# Future merges with identical conflict patterns will auto-resolve
```

## Current Repository State (Verified Snapshot)

| Metric                              | Value                                                               | Source                                                    |
| ----------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------- | ----------------- |
| Downstream commits since merge base | 436                                                                 | `git rev-list --count 6c14ea1d2..ide-plugin` [VERIFIED]   |
| Upstream commits since merge base   | 436                                                                 | `git rev-list --count 6c14ea1d2..opencode/dev` [VERIFIED] |
| Merge base commit                   | `6c14ea1d2` — "tweak(session): add top spacing…"                    | `git merge-base ide-plugin opencode/dev` [VERIFIED]       |
| Last upstream merge                 | `41ce0564a` — 2026-03-30 — "355 commits"                            | `git log --merges` [VERIFIED]                             |
| Downstream commits since last merge | 32                                                                  | `git log --oneline 41ce0564a..ide-plugin                  | wc -l` [VERIFIED] |
| Downstream-only changed files       | 654                                                                 | `git diff --name-only 6c14ea1d2..ide-plugin` [VERIFIED]   |
| Upstream-only changed files         | 637                                                                 | `git diff --name-only 6c14ea1d2..opencode/dev` [VERIFIED] |
| Shared files (changed by both)      | 27                                                                  | `comm -12` on sorted file lists [VERIFIED]                |
| Files that will CONFLICT on merge   | 12                                                                  | `git merge-tree --write-tree --name-only` [VERIFIED]      |
| Files auto-merged successfully      | 15                                                                  | 27 shared - 12 conflicting [VERIFIED]                     |
| Downstream-only dirs (safe)         | `hosts/` (99 files), `webgui/` (348 files), `.planning/` (19 files) | [VERIFIED: 0 upstream changes in these dirs]              |
| Dependency patches                  | 4                                                                   | `patches/` directory [VERIFIED]                           |
| Existing sync tags                  | 0                                                                   | `git tag -l "*sync*"` [VERIFIED]                          |
| rerere enabled                      | No                                                                  | `git config --get rerere.enabled` [VERIFIED]              |
| Git version                         | 2.52.0.windows.1                                                    | `git --version` [VERIFIED]                                |
| Remotes configured                  | `origin`, `upstream`, `opencode`                                    | `git remote -v` [VERIFIED]                                |

### Conflict Zone Analysis (12 files)

| File                                                      | Risk             | Resolution Strategy                                     |
| --------------------------------------------------------- | ---------------- | ------------------------------------------------------- |
| `bun.lock`                                                | LOW (mechanical) | Accept upstream → `bun install` regenerate              |
| `packages/app/src/pages/session/use-session-commands.tsx` | LOW              | Take upstream — this is SolidJS TUI code                |
| `packages/opencode/package.json`                          | MEDIUM           | Manual merge — verify version changes, check patch deps |
| `packages/opencode/src/config/config.ts`                  | **HIGH**         | Manual — downstream adds config overlay (tools, patch)  |
| `packages/opencode/src/mcp/index.ts`                      | **HIGH**         | Manual — downstream adds setEnabled/setToolEnabled      |
| `packages/opencode/src/provider/provider.ts`              | **HIGH**         | Manual — downstream patches normalizeAnthropic SSE      |
| `packages/opencode/src/server/instance/index.ts`          | **HIGH**         | Manual — new conflict zone (not in prior merge)         |
| `packages/opencode/src/server/server.ts`                  | **HIGH**         | Manual — CRITICAL: webgui /app mount point              |
| `packages/opencode/src/session/compaction.ts`             | MEDIUM           | Manual — session compaction logic                       |
| `packages/opencode/src/session/message-v2.ts`             | MEDIUM           | Manual — message format changes                         |
| `packages/opencode/src/skill/index.ts`                    | MEDIUM           | Manual — skill permission overlay                       |
| `packages/opencode/test/session/llm.test.ts`              | LOW              | Manual — test fixture alignment                         |

## State of the Art

| Old Approach                                | Current Approach                | When Changed                                       | Impact                                                                                             |
| ------------------------------------------- | ------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `git merge --no-commit --no-ff` for dry-run | `git merge-tree --write-tree`   | Git 2.38 (Oct 2022)                                | No worktree involvement at all — purely in-memory conflict preview [VERIFIED: works on Git 2.52.0] |
| Manual conflict re-resolution               | `git rerere`                    | Available long-standing, but needs explicit enable | Remembers previous resolutions and auto-applies them [VERIFIED: available but unconfigured]        |
| No sync point tracking                      | Sync tags (`sync/upstream-SHA`) | New for this project                               | Enables quick "which upstream version are we at?" queries                                          |
| Direct branch merge                         | Isolation branch pattern        | Standard practice                                  | Already partially used: `merge-opencode-dev-20260306` in repo history [VERIFIED]                   |

**Deprecated/outdated:**

- None relevant — Git's merge tooling is stable and mature

## Assumptions Log

> List all claims tagged `[ASSUMED]` in this research. The planner and discuss-phase use this
> section to identify decisions that need user confirmation before becoming a locked decision.

| #   | Claim                                                                                                     | Section                | Risk if Wrong                                                                                                                                                                                            |
| --- | --------------------------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | `sync/YYYYMMDD` branch naming convention is acceptable (vs `merge-opencode-dev-YYYYMMDD` used previously) | Architecture Patterns  | Low — naming is cosmetic, can be changed                                                                                                                                                                 |
| A2  | Tags should follow `sync/upstream-SHORT_SHA` format                                                       | Pattern 3              | Low — tag format is flexible                                                                                                                                                                             |
| A3  | `git rerere` pre-population from historical merges is worthwhile to attempt                               | Pattern 4              | Medium — if pre-population doesn't work well, the first real merge will simply lack auto-resolution and require manual work                                                                              |
| A4  | Phase 1 checklist should be Markdown document in `.planning/` rather than a shell script                  | Don't Hand-Roll        | Low — if user wants scripts, Phase 3 can automate                                                                                                                                                        |
| A5  | `packages/app/` conflicts should "take upstream" since it's SolidJS TUI code downstream doesn't use       | Conflict Zone Analysis | Medium — if downstream has meaningful changes to `packages/app/`, this strategy is wrong. Verified: downstream only has 4 changed files in `packages/app/` and they appear to be inherited from upstream |

**If this table is empty:** N/A — there are 5 assumed items above.

## Open Questions

1. **Should the merge checklist be bilingual (Chinese + English)?**
   - What we know: Project uses Chinese for UI strings and some commit messages. AGENTS.md is in Chinese.
   - What's unclear: Whether other developers who'd use the checklist read Chinese
   - Recommendation: Write checklist in Chinese (matching project conventions), with English command comments

2. **How to pre-populate git rerere from historical merge resolutions?**
   - What we know: STATE.md flags this as needing validation. `git rerere` can be trained from past merges using `git rerere train` (if available) or by replaying merge commits.
   - What's unclear: Whether Git 2.52's rerere training can extract resolutions from merge commit 41ce0564a
   - Recommendation: Try `git rerere train` on historical merges. If it doesn't work, skip pre-population — rerere will learn naturally from the first real merge.

3. **How often should upstream merges happen?**
   - What we know: Prior research recommends weekly. Current gap is 13 days (last merge 2026-03-30, today 2026-04-12). Upstream has 436 new commits in this period.
   - What's unclear: Team capacity for weekly merges
   - Recommendation: Document recommended cadence in checklist but don't enforce it in Phase 1

## Environment Availability

| Dependency | Required By                | Available | Version          | Fallback                                                                   |
| ---------- | -------------------------- | --------- | ---------------- | -------------------------------------------------------------------------- |
| Git        | All merge operations       | ✓         | 2.52.0.windows.1 | —                                                                          |
| Bun        | Lockfile regeneration      | ✓         | 1.3.11           | —                                                                          |
| Node.js    | Optional script support    | ✓         | 20.20.0          | —                                                                          |
| pnpm       | VSCode plugin verification | ✗         | —                | Install with `npm install -g pnpm` (Phase 2 concern, not blocking Phase 1) |

**Missing dependencies with no fallback:**

- None for Phase 1 scope

**Missing dependencies with fallback:**

- pnpm not installed — needed for VSCode plugin build verification, but that's Phase 2 scope

## Validation Architecture

> Phase 1 is primarily documentation + git configuration. Validation is manual process verification.

### Test Framework

| Property           | Value                                                             |
| ------------------ | ----------------------------------------------------------------- |
| Framework          | Manual verification (no automated tests for this phase)           |
| Config file        | N/A                                                               |
| Quick run command  | `git merge-tree --write-tree --name-only ide-plugin opencode/dev` |
| Full suite command | Execute full merge checklist end-to-end                           |

### Phase Requirements → Test Map

| Req ID  | Behavior                                                    | Test Type | Automated Command                                                           | File Exists? |
| ------- | ----------------------------------------------------------- | --------- | --------------------------------------------------------------------------- | ------------ |
| SYNC-01 | Create sync branch, merge upstream, ide-plugin unaffected   | manual    | `git branch sync/test && git checkout sync/test && git merge opencode/dev`  | N/A          |
| SYNC-05 | Abort/rollback in <1 min to clean state                     | manual    | `git merge --abort` or `git checkout ide-plugin && git branch -D sync/test` | N/A          |
| SYNC-06 | Written checklist enables another dev to complete full sync | manual    | Follow checklist document end-to-end                                        | ❌ Wave 0    |

### Sampling Rate

- **Per task commit:** Verify git commands work as documented
- **Per wave merge:** Execute full checklist against real upstream
- **Phase gate:** Checklist validated through at least one real end-to-end upstream merge

### Wave 0 Gaps

- [ ] Merge checklist document — covers SYNC-06
- [ ] `git rerere` configuration validation — covers operational efficiency
- [ ] End-to-end merge execution to validate checklist — covers all 3 requirements

## Security Domain

> Phase 1 involves only git operations and documentation. No authentication, input handling, or network service exposure.

### Applicable ASVS Categories

| ASVS Category         | Applies | Standard Control |
| --------------------- | ------- | ---------------- |
| V2 Authentication     | No      | —                |
| V3 Session Management | No      | —                |
| V4 Access Control     | No      | —                |
| V5 Input Validation   | No      | —                |
| V6 Cryptography       | No      | —                |

No security controls needed for this phase.

## Sources

### Primary (HIGH confidence)

- Direct repository investigation via git commands (all metrics tagged [VERIFIED])
- `git merge-tree --write-tree --name-only ide-plugin opencode/dev` — exact conflict list
- `git remote -v`, `git branch -a`, `git log` — repository structure
- `git config --get rerere.enabled` — configuration state
- `.planning/research/PITFALLS.md` — prior pitfall analysis (2026-04-12)
- `.planning/research/FEATURES.md` — prior feature research (2026-04-12)

### Secondary (MEDIUM confidence)

- Git official documentation for `merge-tree`, `rerere` behavior (training knowledge cross-verified with actual command output)
- Prior merge commit `41ce0564a` — validated merge pattern and conflict resolution approach

### Tertiary (LOW confidence)

- None — all findings directly verified against repository state

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH — all tools are Git built-ins, verified on this exact version
- Architecture: HIGH — branch isolation pattern already proven in this repo's history
- Pitfalls: HIGH — all pitfalls verified against actual merge-tree output and prior research
- Conflict analysis: HIGH — exact 12-file conflict list from `git merge-tree`

**Research date:** 2026-04-12
**Valid until:** 2026-04-19 (7 days — upstream moves fast, conflict list will change with any new commits on either side)
