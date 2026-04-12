# Feature Landscape: Upstream Sync Workflow

**Domain:** Downstream fork management for an IDE plugin project built on top of an upstream CLI tool
**Researched:** 2026-04-12
**Confidence:** HIGH (based on direct codebase analysis + established git/fork-management patterns)

## Context

This project is a **deeply diverged fork** — 384 commits ahead, 640 files changed, 105K lines added — of `anomalyco/opencode`. The downstream additions live in two clean zones (`packages/opencode/webgui/` and `hosts/`) plus scattered modifications to upstream files (SDK generation, build scripts, patches, config). The upstream evolves rapidly with 200+ branches active.

The core challenge: keep both sides working after every merge. No sync process exists today.

## Table Stakes

Features users expect. Missing = the sync process breaks or produces untrustworthy results.

| Feature                                        | Why Expected                                                                                                                                                                                         | Complexity | Notes                                                                                                                                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Upstream fetch + merge on dedicated branch** | Without a dedicated sync branch, merge conflicts pollute the main development branch. Merge must happen in isolation.                                                                                | Low        | `git fetch opencode && git merge opencode/dev` on a `sync/*` branch. Standard git workflow.                                                                                                     |
| **Conflict detection report**                  | After merge, developer needs an immediate list of conflicting files categorized by risk zone (upstream-only, downstream-only, both-modified). Without this, conflicts are discovered randomly.       | Med        | `git diff --name-only --diff-filter=U` post-merge + classification by path prefix (`packages/opencode/src/` = upstream core, `webgui/` = downstream, `hosts/` = downstream, etc.)               |
| **Build verification after merge**             | A merge that compiles is the minimum bar. "Build passes" is the literal core requirement from PROJECT.md. Must verify: bun typecheck, webgui build, vscode plugin compile, jetbrains plugin compile. | Med        | 4 separate build systems: bun (monorepo), vite (webgui), pnpm+tsc (vscode), gradle (jetbrains). Each can fail independently.                                                                    |
| **SDK regeneration check**                     | The WebGUI depends on `@opencode-ai/sdk` generated from the upstream OpenAPI spec. If upstream changes API routes, the SDK is stale. This is the #1 source of post-merge breakage per CONCERNS.md.   | Med        | Detect changes to `packages/opencode/src/server/routes/` or `packages/sdk/openapi.json`, trigger `./packages/sdk/js/script/build.ts`, then check if `sdkClient.ts` manual wrappers still align. |
| **Patch compatibility check**                  | 4 dependency patches exist that may break on upstream dependency updates. If patches fail to apply after merge, bun install fails and nothing builds.                                                | Low        | `bun install` will fail loudly if patches don't apply. But the failure message is cryptic — need clear diagnostic.                                                                              |
| **Test suite run**                             | Existing tests (vitest for webgui, mocha for vscode) must pass after merge. Tests are the "functionality doesn't regress" signal.                                                                    | Low        | `bun test` in `packages/opencode`, vitest in `webgui/`, mocha in `hosts/vscode-plugin/`.                                                                                                        |
| **Rollback path**                              | If a sync merge is bad, developer must be able to cleanly abort or revert without corrupting the working branch.                                                                                     | Low        | Git already provides this (`git merge --abort`, `git reset --hard`), but the workflow must document/enforce use of a sync branch to protect the dev branch.                                     |

## Differentiators

Features that make sync easier, safer, or faster. Not expected, but high-value.

| Feature                             | Value Proposition                                                                                                                                                                                                                                                  | Complexity | Notes                                                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Impact analysis by zone**         | Classify upstream changes into risk zones: "safe" (upstream-only dirs like `packages/app/`, `infra/`, `docs/`) vs "risky" (shared dirs like `packages/opencode/src/server/`, `packages/opencode/src/config/`). Developer can focus attention on high-risk changes. | Med        | File-path-based classification. Zones: upstream-only (no downstream touches), downstream-only (webgui, hosts), shared (server routes, config, bus events, package.json).                  |
| **API change detection**            | Automatically diff upstream server route files, Hono route definitions, and bus event definitions to identify API contract changes that affect the WebGUI. Flag new/changed/removed endpoints.                                                                     | High       | Parse route registrations in `src/server/instance.ts` and `src/server/routes/*.ts`, compare before/after merge. Also check `BusEvent.define()` calls in `src/bus/` for SSE event changes. |
| **Config schema change detection**  | Detect changes to `packages/opencode/src/config/config.ts` that would break the WebGUI settings panels (which use `any` types and have no compile-time safety).                                                                                                    | Med        | Diff the config module, flag added/removed/renamed fields. Critical because CONCERNS.md notes the `any` typing means config changes cause silent runtime failures.                        |
| **Dependency drift report**         | After merge, compare root `package.json` catalog versions with what downstream expects. Flag TypeScript version mismatches (root: 5.8.2, webgui: 5.9.3, vscode: 5.0.0). Flag new/removed workspace packages.                                                       | Med        | Parse package.json files, compare versions. Already a known concern (dual package manager, TS version mismatch).                                                                          |
| **Upstream feature parity tracker** | Track which upstream SolidJS TUI features have been reimplemented in the React WebGUI and which are missing. When upstream adds a new TUI feature, flag it for potential reimplementation.                                                                         | High       | Requires maintaining a feature mapping between `packages/app/` (SolidJS) and `packages/opencode/webgui/` (React). Semi-manual process.                                                    |
| **Merge strategy advisor**          | For each conflicting file, suggest a merge strategy: "take upstream" (upstream-only concern), "take ours" (downstream-only feature), "manual merge needed" (both sides have legitimate changes).                                                                   | High       | Heuristic-based: if file is in `hosts/` → always take ours. If file is in `packages/app/` → always take upstream. If file is in `packages/opencode/src/server/routes/` → manual merge.    |
| **Pre-merge dry run**               | Before actually merging, simulate the merge to show what would conflict without modifying the working tree. Allow developer to prepare before committing to a merge.                                                                                               | Low        | `git merge --no-commit --no-ff opencode/dev` then `git diff --cached`, then `git merge --abort`. Standard git, just needs to be scripted.                                                 |
| **Changelog extraction**            | Pull upstream commit messages since last sync and group by category (feat, fix, refactor, breaking). Developer sees what changed at a glance instead of reading 100+ commits.                                                                                      | Med        | `git log --oneline last-sync-tag..opencode/dev` with conventional commit parsing.                                                                                                         |
| **Sync frequency tracking**         | Record when each sync happened, how many upstream commits were absorbed, and how many conflicts occurred. Detect if sync frequency is slipping (longer gaps = harder merges).                                                                                      | Low        | Simple metadata file (`.planning/sync-history.json`) updated after each successful sync.                                                                                                  |

## Anti-Features

Features to explicitly NOT build. These seem useful but create more problems than they solve.

| Anti-Feature                                 | Why Avoid                                                                                                                                                                                                        | What to Do Instead                                                                                                                                             |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Automatic merge resolution**               | With 105K lines of downstream changes, automated conflict resolution will silently introduce bugs. The `any` typing in WebGUI means type errors won't catch incorrect merges.                                    | Keep merge resolution manual. Provide classification and suggestions, but require human decision for every conflict.                                           |
| **Cherry-pick workflow**                     | Cherry-picking individual upstream commits (instead of merging) creates a parallel history that diverges further over time. Makes future merges progressively harder. Each cherry-pick is a merge debt.          | Use full merge from upstream branch tip. Accept the occasional large merge over accumulating cherry-pick debt.                                                 |
| **Rebase onto upstream**                     | Rebasing 384 downstream commits onto upstream would rewrite history, break existing PRs, and require force-push. The downstream history has merge commits and collaboration history that shouldn't be rewritten. | Merge-based sync only. Preserve downstream history as-is.                                                                                                      |
| **Automated sdkClient.ts patching**          | The hand-rolled fetch wrappers in `sdkClient.ts` (566 lines) are fragile and use `any` types. Trying to auto-patch them after SDK regeneration will produce subtle bugs.                                         | Flag that manual wrappers need review after SDK regen. Long-term: migrate all manual wrappers to the generated SDK (the file already has a TODO for this).     |
| **Bidirectional sync (upstreaming changes)** | This project has Chinese UI strings, React instead of SolidJS, and IDE-specific extensions. Almost nothing is directly upstreamable. Trying to PR upstream adds overhead without benefit.                        | One-way sync only: upstream → downstream. If upstream needs a bugfix found downstream, contribute it directly as an isolated PR, not through the sync process. |
| **Git submodule for upstream**               | Submodules would isolate upstream code, but the project modifies upstream files (patches, SDK script, build config). Submodules don't support this — they're for read-only dependencies.                         | Keep as a fork with remote tracking. The current `opencode` remote setup is correct.                                                                           |
| **Automated sync schedule (CI cron)**        | Automatic merges on a schedule will create broken branches when conflicts arise, with no human context about what changed. The upstream moves too fast and touches too many files for unattended merging.        | Manual trigger with human oversight. Sync when upstream has changes worth absorbing, not on a timer.                                                           |

## Feature Dependencies

```
Pre-merge dry run ─────────────┐
                               v
Upstream fetch + merge ──> Conflict detection report
         │                     │
         v                     v
    Patch compat check    Impact analysis by zone
         │                     │
         v                     v
    SDK regen check       API change detection
         │                Config schema change detection
         v                     │
    Build verification <───────┘
         │
         v
    Test suite run
         │
         v
    Changelog extraction (optional, can run anytime)
         │
         v
    Sync frequency tracking (post-merge metadata)
```

Key dependency chains:

- **Fetch → Merge → Detect → Build → Test** is the critical path
- **Impact analysis, API detection, config detection** can run in parallel after conflict detection
- **SDK regen** must happen before build verification (stale SDK = build failure)
- **Patch check** must happen before build verification (failed patches = install failure)
- **Pre-merge dry run** is optional and runs before the actual merge
- **Changelog + frequency tracking** are post-merge bookkeeping

## MVP Recommendation

### Phase 1: Core Sync Loop (table stakes)

Prioritize these — they form the minimum viable sync workflow:

1. **Upstream fetch + merge on sync branch** — The foundation. Without this, nothing else matters.
2. **Conflict detection report** — Gives developer immediate situational awareness.
3. **SDK regeneration check** — The #1 post-merge failure mode per CONCERNS.md.
4. **Patch compatibility check** — The #2 post-merge failure mode.
5. **Build verification** — The acceptance gate ("build passes" is the core value statement).
6. **Test suite run** — The regression gate.
7. **Rollback path** — Safety net.

This is a script/checklist, not a tool. Keep it simple.

### Phase 2: Intelligence Layer (differentiators)

Defer these — they improve the experience but aren't blocking:

- **Impact analysis by zone** — Most valuable differentiator. Low effort, high payoff.
- **Pre-merge dry run** — Lets developer scout before committing. Very cheap to build.
- **Changelog extraction** — Nice for understanding what upstream did.
- **Sync frequency tracking** — Simple metadata, informs process discipline.

### Phase 3: Deep Analysis (aspirational)

Defer until pain is felt:

- **API change detection** — High complexity, high value for the sdkClient.ts problem.
- **Config schema change detection** — Medium complexity, prevents silent runtime failures.
- **Merge strategy advisor** — High complexity, most value when merge conflicts are frequent.
- **Dependency drift report** — Medium complexity, prevents TS/dep version mismatches.
- **Upstream feature parity tracker** — Ongoing maintenance burden.

## Zone Classification Reference

For features that classify files by risk zone:

| Zone                     | Path Pattern                                                | Risk Level | Merge Strategy                                 |
| ------------------------ | ----------------------------------------------------------- | ---------- | ---------------------------------------------- |
| **Downstream-only**      | `packages/opencode/webgui/**`                               | None       | Always keep ours (upstream doesn't have these) |
| **Downstream-only**      | `hosts/**`                                                  | None       | Always keep ours                               |
| **Downstream-only**      | `.planning/**`, `.github/**` (downstream CI)                | None       | Always keep ours                               |
| **Upstream-only**        | `packages/app/**`, `packages/ui/**` (SolidJS)               | None       | Always take upstream                           |
| **Upstream-only**        | `infra/**`, `packages/console/**`, `packages/enterprise/**` | None       | Always take upstream                           |
| **Upstream-only**        | `packages/desktop/**`, `packages/desktop-electron/**`       | None       | Always take upstream                           |
| **Shared (high risk)**   | `packages/opencode/src/server/**`                           | High       | Manual merge — API contract zone               |
| **Shared (high risk)**   | `packages/opencode/src/config/**`                           | High       | Manual merge — config schema zone              |
| **Shared (high risk)**   | `packages/opencode/src/bus/**`                              | High       | Manual merge — SSE event contract zone         |
| **Shared (high risk)**   | `packages/sdk/**`                                           | High       | Regenerate SDK after merge                     |
| **Shared (medium risk)** | `packages/opencode/src/session/**`                          | Medium     | Manual merge — session model changes           |
| **Shared (medium risk)** | `packages/opencode/src/agent/**`                            | Medium     | Manual merge — agent behavior changes          |
| **Shared (medium risk)** | `package.json`, `bun.lock`                                  | Medium     | Manual merge — dependency changes              |
| **Shared (medium risk)** | `patches/**`                                                | Medium     | Verify patches still apply                     |
| **Shared (low risk)**    | `packages/opencode/src/tool/**`                             | Low        | Usually additive changes                       |
| **Shared (low risk)**    | `turbo.json`, `tsconfig.json`                               | Low        | Merge carefully, test builds                   |

## Sources

- Direct codebase analysis: `.planning/codebase/ARCHITECTURE.md`, `CONCERNS.md`, `STRUCTURE.md`
- Git history analysis: `git log`, `git diff --stat`, `git remote -v`, `git branch -a`
- GitHub docs: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/syncing-a-fork
- PROJECT.md core value: "build passes and functionality doesn't regress after upstream merge"

---

_Feature landscape: 2026-04-12_
