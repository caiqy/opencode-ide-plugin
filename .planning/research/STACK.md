# Technology Stack: Upstream Fork Synchronization

**Project:** opencode-ide-plugin — Upstream Sync Workflow
**Researched:** 2026-04-12
**Overall Confidence:** HIGH (based on codebase evidence + verified tools)

## Context

This project is a downstream fork of [anomalyco/opencode](https://github.com/anomalyco/opencode) that adds WebGUI frontend and IDE plugin packaging. The upstream moves fast (~100+ commits/week, release cadence of ~1 per week from v1.3.0 to v1.4.3+). The last manual merge integrated 355 commits and resolved 15 conflicts. The current divergence is 436 upstream commits vs 384 downstream commits across 637 changed files, with 12 conflict-prone files identified.

**Core problem:** No automated workflow exists. Merges are manual, infrequent, and high-risk.

## Recommended Stack

### CI/CD — GitHub Actions (core automation layer)

| Technology                  | Version        | Purpose                               | Why                                                                                                                           |
| --------------------------- | -------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| GitHub Actions              | N/A (platform) | Workflow orchestration                | Already in use (`test.yml`, `typecheck.yml`). All existing CI runs on Blacksmith runners. No reason to add another CI system. |
| `actions/checkout@v4`       | v4             | Repository checkout with full history | Already used. Need `fetch-depth: 0` for merge operations.                                                                     |
| `.github/actions/setup-bun` | local          | Bun setup with caching                | Already exists as composite action. Reuse for build verification.                                                             |

**Confidence:** HIGH — these are already in the codebase.

### Upstream Sync Detection

| Technology            | Version | Purpose                                                         | Why                                                                                                                                                                                                                                                              |
| --------------------- | ------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native `git` commands | ≥2.38   | Merge-tree conflict prediction, fetch, diff-stat                | `git merge-tree --write-tree` (available since git 2.38) can predict conflicts without touching the working tree. This is the best tool for conflict detection — zero dependencies, runs in CI. Verified: it correctly identifies all 12 current conflict files. |
| `@octokit/rest`       | 22.0.1  | GitHub API for PR creation, label management, commit comparison | Already a dependency. Use for programmatic PR creation + commenting with conflict reports.                                                                                                                                                                       |

**Confidence:** HIGH — `git merge-tree --write-tree` verified against actual codebase state.

### Why NOT use third-party sync actions

| Action                                          | Stars | Why Not                                                                                                                                                                                           |
| ----------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aormsby/Fork-Sync-With-Upstream-action` v3.4.3 | 311   | Designed for simple fast-forward syncs. Does NOT handle merge conflicts — just fails. Our repo always has conflicts (12 files currently). Also, "not currently in active development" per README. |
| `peter-evans/create-pull-request` v8.1.1        | 2.7k  | Useful as a helper for PR creation after merge attempt, but doesn't solve conflict detection or merge strategy. We need the conflict analysis BEFORE creating a PR.                               |
| GitHub's built-in "Sync Fork" button            | N/A   | Only does fast-forward. Useless when branches have diverged, which ours always will.                                                                                                              |

**Recommendation:** Write a **custom GitHub Actions workflow** using native git commands + `@octokit/rest`. The problem is too specific for generic sync actions — we need conflict prediction, selective merge, and build verification in a single pipeline.

### Conflict Detection & Analysis

| Technology                                           | Version   | Purpose                                                 | Why                                                                                                                                                                          |
| ---------------------------------------------------- | --------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git merge-tree --write-tree`                        | git ≥2.38 | Predict merge conflicts without modifying worktree      | Outputs conflicting file paths with 3-way merge stage info. Already verified: correctly identifies `bun.lock`, `config.ts`, `mcp/index.ts`, `provider.ts`, `server.ts`, etc. |
| `git diff --stat`                                    | native    | Summarize upstream changes scope                        | Generates readable change summaries for PR descriptions.                                                                                                                     |
| `git log --oneline` with path filters                | native    | Track which upstream commits touch conflict-prone files | Critical for understanding WHY a conflict exists — "these 5 commits changed config.ts".                                                                                      |
| Custom TypeScript script (`script/upstream-sync.ts`) | N/A       | Orchestrate detection + reporting                       | Bun-native script that runs `git merge-tree`, parses output, classifies conflicts by severity (lockfile vs API code vs config), generates a merge report.                    |

**Confidence:** HIGH for git tools (verified). MEDIUM for custom script (design choice, not verified).

### Build Verification

| Technology                        | Version   | Purpose                      | Why                                                                                                                |
| --------------------------------- | --------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Turborepo                         | 2.8.13    | Parallel build orchestration | Already configured. `bun turbo typecheck`, `bun turbo test`, `bun turbo build` cover the full verification matrix. |
| `tsgo --noEmit`                   | 7.0.0-dev | Fast type checking           | Already used via `bun typecheck`. 10-50x faster than `tsc`. Critical for quick merge validation.                   |
| Vitest                            | 4.0.13    | WebGUI unit tests            | Already configured. Must pass after merge.                                                                         |
| Bun test                          | N/A       | Core opencode tests          | Already configured. Must pass after merge.                                                                         |
| Mocha                             | 10.2.0    | VSCode extension tests       | Already configured.                                                                                                |
| `hosts/scripts/build_opencode.sh` | N/A       | Cross-platform binary build  | Already exists. Verifies the merged code actually compiles for all targets.                                        |

**Confidence:** HIGH — all tools already in the codebase.

### Changelog & Merge Tracking

| Technology                               | Version | Purpose                                         | Why                                                                                                                                                      |
| ---------------------------------------- | ------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git log --format` with custom templates | native  | Extract upstream changelog between merge points | Parse upstream commit messages for release notes. Upstream uses conventional commit style (`feat:`, `fix:`, `refactor:`, etc.).                          |
| Markdown files in `.planning/merges/`    | N/A     | Persistent merge records                        | Store merge reports: upstream range, conflicts found, resolution strategy, build results. Human-readable, git-tracked.                                   |
| GitHub PR body + labels                  | N/A     | Per-merge tracking                              | Each upstream sync gets a PR with structured body: upstream range, conflict list, build status. Labels: `upstream-sync`, `has-conflicts`, `clean-merge`. |

**Why NOT use automated changelog tools:**

- `conventional-changelog`, `changesets`, `release-it` — designed for YOUR project's releases, not tracking upstream's releases
- The upstream already has its own release notes. We need to TRACK what upstream changed, not generate our own changelog for upstream code.

**Confidence:** HIGH — this is a workflow design choice, not a library dependency.

### Merge Strategy Tooling

| Technology                     | Version | Purpose                                | Why                                                                                                                                                                          |
| ------------------------------ | ------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git merge --no-commit`        | native  | Stage merge without auto-committing    | Allows inspection + manual conflict resolution before finalizing.                                                                                                            |
| `git rerere`                   | native  | Remember & replay conflict resolutions | Critical for recurring conflicts. The same files (`config.ts`, `mcp/index.ts`, `server.ts`) conflict every merge. `rerere` learns resolution patterns and auto-applies them. |
| `.gitattributes` merge drivers | native  | Custom merge behavior per file         | Set `bun.lock` to use `ours` strategy (regenerate after merge). Set lockfiles to binary merge.                                                                               |

**Confidence:** HIGH for `git merge/rerere` (standard git). MEDIUM for custom merge drivers (needs testing).

## Supporting Libraries (already in project)

| Library         | Version        | Relevant Use                                   | Notes                                                                                                      |
| --------------- | -------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `@octokit/rest` | 22.0.1         | PR creation, comment posting, label management | Already a dependency. Use for automated PR workflow.                                                       |
| `semver`        | ^7.6.0         | Version comparison for upstream releases       | Already a devDependency. Parse upstream version tags.                                                      |
| `glob`          | 13.0.5         | File pattern matching                          | Already a devDependency. Useful for conflict path classification.                                          |
| `diff`          | ^7.0.0 / 8.0.2 | Text diffing                                   | Already used in WebGUI for file change display. Could be used for conflict visualization in merge reports. |

**Confidence:** HIGH — all verified in `package.json`.

## New Dependencies Required

**None.** The entire upstream sync workflow can be built with:

1. Native git commands (available on all CI runners)
2. Libraries already in the project (`@octokit/rest`, `semver`, `glob`)
3. GitHub Actions (already the CI platform)
4. Bun runtime (already the script runtime)

This is a deliberate choice. Fork synchronization is a **workflow problem**, not a **library problem**. Adding dependencies for this creates maintenance burden in a project that already tracks a fast-moving upstream.

## Alternatives Considered

| Category           | Recommended                         | Alternative                                        | Why Not                                                                                                                                   |
| ------------------ | ----------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Sync automation    | Custom GHA workflow                 | `aormsby/Fork-Sync-With-Upstream-action`           | Can't handle conflicts, not actively maintained                                                                                           |
| Sync automation    | Custom GHA workflow                 | Renovate/Dependabot for fork tracking              | These tools track dependency updates, not upstream fork code changes                                                                      |
| Conflict detection | `git merge-tree --write-tree`       | Try-merge in ephemeral branch                      | merge-tree is cleaner, faster, and doesn't create throwaway branches                                                                      |
| Conflict detection | `git merge-tree --write-tree`       | Third-party merge analysis tools (mergify, kodiak) | Overkill for a single-upstream-repo scenario. These are designed for multi-contributor PR management.                                     |
| Changelog tracking | Git log parsing + markdown          | `conventional-changelog` / `changesets`            | Wrong tool — designed for YOUR releases, not tracking someone else's                                                                      |
| PR creation        | `@octokit/rest` (already installed) | `peter-evans/create-pull-request`                  | create-pull-request is good but we need custom logic (conflict reports, labels, conditional creation). Direct Octokit gives full control. |
| Build verification | Existing Turborepo pipeline         | Separate CI matrix                                 | Already have `bun turbo typecheck && bun turbo test && bun turbo build`. No reason to reinvent.                                           |
| Merge memory       | `git rerere`                        | Custom conflict database                           | rerere is built into git, works automatically, zero maintenance                                                                           |

## Workflow Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ GitHub Actions: upstream-sync.yml (scheduled + manual trigger)  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  1. DETECT                                                      │
│     ├── git fetch opencode dev                                  │
│     ├── git rev-list --count (new commits?)                     │
│     └── git log --oneline (release tags in range?)              │
│                                                                 │
│  2. ANALYZE                                                     │
│     ├── git merge-tree --write-tree (predict conflicts)         │
│     ├── Classify conflicts:                                     │
│     │   ├── LOCKFILE (bun.lock) → auto-resolve: regenerate      │
│     │   ├── PACKAGE_JSON → auto-resolve: merge + bun install    │
│     │   ├── OUR_CODE (webgui/, hosts/) → flag for review        │
│     │   └── UPSTREAM_API (server.ts, config.ts, mcp/) → HIGH   │
│     └── Generate merge report markdown                          │
│                                                                 │
│  3. MERGE (if auto-resolvable or manual trigger)                │
│     ├── git merge --no-commit opencode/dev                      │
│     ├── git rerere (apply learned resolutions)                  │
│     ├── Resolve lockfile: bun install → git add bun.lock        │
│     └── git commit (structured message with range)              │
│                                                                 │
│  4. VERIFY                                                      │
│     ├── bun turbo typecheck                                     │
│     ├── bun turbo test (packages/opencode)                      │
│     ├── bun turbo build (webgui)                                │
│     └── hosts/scripts/build_vscode.sh (VSCode ext compiles?)    │
│                                                                 │
│  5. REPORT                                                      │
│     ├── Create/update PR via @octokit/rest                      │
│     ├── Label: upstream-sync, conflict severity                 │
│     ├── PR body: upstream range, conflicts, build results       │
│     └── Write .planning/merges/YYYY-MM-DD.md                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Known Conflict Hotspots (verified 2026-04-12)

Files that conflict on virtually every upstream merge. These drive the tooling choices:

| File                                                      | Conflict Type      | Auto-Resolvable? | Strategy                                                               |
| --------------------------------------------------------- | ------------------ | ---------------- | ---------------------------------------------------------------------- |
| `bun.lock`                                                | Lockfile           | YES              | Regenerate after merge (`bun install`)                                 |
| `packages/opencode/package.json`                          | Version + deps     | PARTIAL          | Merge text, then `bun install` to reconcile                            |
| `packages/opencode/src/config/config.ts`                  | API additions      | NO               | Our skill permission overlay + upstream config changes. Manual review. |
| `packages/opencode/src/mcp/index.ts`                      | Feature additions  | NO               | Our setEnabled/setToolEnabled + upstream MCP changes. Manual review.   |
| `packages/opencode/src/provider/provider.ts`              | SSE normalization  | NO               | Our Anthropic SSE fix + upstream provider changes. Manual review.      |
| `packages/opencode/src/server/server.ts`                  | Route ordering     | MAYBE            | Our /app route before WorkspaceRouter. Pattern may be rerere-able.     |
| `packages/opencode/src/server/instance/index.ts`          | Webgui routes      | MAYBE            | Our webgui route registration. Pattern may be rerere-able.             |
| `packages/opencode/src/session/compaction.ts`             | Bug fix overlay    | NO               | Our TypeValidationError recovery. Manual review.                       |
| `packages/opencode/src/session/message-v2.ts`             | Feature additions  | NO               | Manual review required.                                                |
| `packages/opencode/src/skill/index.ts`                    | Permission overlay | NO               | Our skill permission overlay. Manual review.                           |
| `packages/opencode/test/session/llm.test.ts`              | Test updates       | MAYBE            | Usually just additive on both sides.                                   |
| `packages/app/src/pages/session/use-session-commands.tsx` | Upstream Solid app | MAYBE            | We don't heavily modify this file.                                     |

## File Classification for Merge Automation

```
OURS_ONLY (never conflict — upstream doesn't touch):
  hosts/vscode-plugin/**
  hosts/jetbrains-plugin/**
  hosts/scripts/**
  packages/opencode/webgui/** (upstream has packages/app/ instead)
  .planning/**

UPSTREAM_ONLY (take upstream — we don't modify):
  .github/workflows/* (except our custom ones)
  docs/**
  nix/**
  packages/app/** (upstream's Solid web app)
  packages/console/**
  packages/desktop/**
  README.*.md

CONFLICT_ZONE (both sides modify):
  packages/opencode/src/server/**
  packages/opencode/src/config/**
  packages/opencode/src/mcp/**
  packages/opencode/src/session/**
  packages/opencode/src/skill/**
  packages/opencode/src/provider/**
  packages/opencode/package.json
  bun.lock
  package.json
```

## Installation

No new packages needed. For the custom sync script:

```bash
# Already installed:
# @octokit/rest@22.0.1, semver@^7.6.0, glob@13.0.5

# New files to create (not packages):
# .github/workflows/upstream-sync.yml    — scheduled + manual workflow
# script/upstream-sync.ts                — Bun script for conflict analysis
# script/upstream-report.ts              — Generate merge report markdown
# .gitattributes                         — merge drivers for lockfiles
```

## Git Configuration

```bash
# Enable rerere (remember conflict resolutions)
git config rerere.enabled true
git config rerere.autoupdate true

# .gitattributes for merge strategies
echo "bun.lock merge=ours" >> .gitattributes
```

## Sources

- `git merge-tree --write-tree` — verified on this repo (2026-04-12), correctly predicts 12 conflict files
- `@octokit/rest` — already in `package.json` at 22.0.1, verified via `grep`
- `aormsby/Fork-Sync-With-Upstream-action` v3.4.3 — GitHub Marketplace page (inactive maintenance, 311 stars)
- `peter-evans/create-pull-request` v8.1.1 — GitHub Marketplace page (2.7k stars, active)
- Upstream release cadence — verified via `git log --grep="release:"` (v1.3.0 → v1.4.3+)
- Conflict hotspots — verified via `git merge-tree --write-tree --no-messages ide-plugin opencode/dev`
- All existing CI infrastructure — verified from `.github/workflows/`, `turbo.json`, `package.json`

---

_Stack research: 2026-04-12_
