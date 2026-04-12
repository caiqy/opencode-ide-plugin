# Project Research Summary

**Project:** opencode-ide-plugin — Upstream Sync Workflow
**Domain:** Downstream fork maintenance (CLI tool → WebGUI + IDE plugins)
**Researched:** 2026-04-12
**Confidence:** HIGH

## Executive Summary

This project is a deeply diverged downstream fork of `anomalyco/opencode` (384 commits ahead, 105K lines added) that adds a React WebGUI frontend and IDE plugin hosts (VSCode, JetBrains) on top of the upstream CLI tool. The upstream moves aggressively — ~100+ commits/week, weekly releases, and an ongoing Effect.js migration that rewrites function signatures across the codebase. No automated or documented sync process exists today. The last manual merge absorbed 355 commits, resolved 15 file conflicts, modified 790 files, and required multiple hours. The current divergence is 436 upstream commits with 12 known conflict-prone files.

The recommended approach is a **pipeline-based sync workflow** using exclusively existing tools — native git commands, GitHub Actions (already in CI), `@octokit/rest` (already a dependency), Turborepo (already configured), and Bun (already the runtime). Zero new dependencies are needed. The critical insight from research is that `git merge-tree --write-tree` (verified against the actual codebase) can predict all 12 conflict files without touching the working tree, enabling a detect → analyze → merge → verify → gate pipeline. The conflict surface is finite and predictable (~28 files), making it tractable to maintain a registry of known hotspots with pre-planned resolution strategies.

The top risks are: (1) the ongoing upstream Effect.js migration changing function signatures in files the downstream has patched, (2) silent API drift when the SDK isn't regenerated after route changes (compounded by 434+ `any` types in the WebGUI), (3) `bun.lock` conflicts on every single merge, and (4) the exponential pain curve when merges are deferred. All four risks are mitigated by establishing a weekly merge cadence and a strict post-merge verification pipeline. The architecture research strongly recommends starting with a documented manual checklist before automating — a checklist that's followed beats a half-broken CI pipeline that's ignored.

## Key Findings

### Recommended Stack

No new dependencies required. The entire sync system builds on tools already in the project: native git (≥2.38 for `merge-tree --write-tree`), GitHub Actions, `@octokit/rest`, Turborepo, Bun, and existing build/test infrastructure. Third-party sync actions (`aormsby/Fork-Sync-With-Upstream-action`, GitHub's Sync Fork button) were evaluated and rejected — they only handle fast-forward syncs and fail on the diverged history this project always has. See [STACK.md](STACK.md) for full evaluation.

**Core technologies:**

- **`git merge-tree --write-tree`**: Conflict prediction without modifying worktree — verified against actual codebase, correctly identifies all 12 conflict files
- **`git rerere`**: Remember and replay conflict resolutions for recurring conflicts in `config.ts`, `server.ts`, `mcp/index.ts`
- **GitHub Actions (custom workflow)**: Orchestrate the detect → analyze → merge → verify → report pipeline, triggered manually (not on schedule)
- **Turborepo pipeline**: Parallel build verification across all packages (`bun typecheck`, `bun test`, WebGUI build, SDK regen, IDE plugin compiles)
- **`@octokit/rest` (already installed)**: Programmatic PR creation with conflict reports, labels, and structured bodies

### Expected Features

See [FEATURES.md](FEATURES.md) for full landscape including dependency graph.

**Must have (table stakes):**

- Upstream fetch + merge on isolated sync branch — foundation of the entire workflow
- Conflict detection report categorized by risk zone — immediate situational awareness
- SDK regeneration check — #1 source of post-merge breakage
- Patch compatibility check — #2 source of post-merge breakage
- Build verification (typecheck, tests, WebGUI, SDK, IDE plugins) — the acceptance gate
- Rollback path — safety net via sync branch isolation

**Should have (differentiators):**

- Impact analysis by zone — classify upstream changes into safe/risky zones, low effort + high payoff
- Pre-merge dry run — scout conflicts before committing to merge
- Changelog extraction — understand what upstream did without reading 100+ commits
- Sync frequency tracking — detect when merge cadence is slipping

**Defer (v2+):**

- API change detection (parse Hono routes, diff OpenAPI spec) — high complexity
- Config schema change detection — medium complexity, valuable for `any`-typed WebGUI
- Merge strategy advisor — heuristic-based per-file strategy suggestions
- Upstream feature parity tracker — ongoing maintenance burden
- Dependency drift report — medium complexity, TS version alignment

**Anti-features (explicitly do NOT build):**

- Automatic conflict resolution — silent bugs with 434+ `any` types
- Cherry-pick workflow — creates parallel history, compounds merge debt
- Rebase onto upstream — rewrites 384 downstream commits
- Automated cron-based sync — unattended merges with no human context
- Bidirectional sync — almost nothing is directly upstreamable

### Architecture Approach

The sync system is a 5-component pipeline: Fetch & Detect → Impact Analysis → Merge Execute → Build Verify → Regression Gate. Each component is discrete, can fail and retry independently, and communicates via well-defined outputs. The architecture deliberately follows an automation spectrum: start with a manual checklist, then script build verification (most mechanically complex), then script conflict detection, and only CI-integrate the full pipeline last. See [ARCHITECTURE.md](ARCHITECTURE.md) for component boundaries and data flow.

**Major components:**

1. **Fetch & Detect** — poll upstream, determine commit range since last merge-base (read-only)
2. **Impact Analysis** — classify upstream changes against known conflict surface registry (~28 files)
3. **Merge Execute** — `git merge` on isolated `sync/upstream-YYYYMMDD` branch, apply `rerere` for recurring conflicts
4. **Build Verify** — ordered pipeline: `bun install` → typecheck → [tests | WebGUI | SDK] in parallel → IDE plugin compiles
5. **Regression Gate** — go/no-go decision with structured report, merge sync branch into `ide-plugin` on pass

**Key patterns:**

- Known Conflict Surface Registry — finite list of ~28 files with pre-planned resolution strategies
- Sync Branch Isolation — never merge directly into `ide-plugin`, always through throwaway sync branch
- Lock File Regeneration — always accept upstream `bun.lock`, then `bun install` to regenerate
- SDK Regeneration After Merge — mandatory when server routes change

### Critical Pitfalls

See [PITFALLS.md](PITFALLS.md) for full analysis with detection strategies.

1. **Upstream core modifications as permanent merge tax** — 12 downstream-modified files in `packages/opencode/src/` create recurring conflicts. Mitigate by auditing and extracting patches into extension points; target ≤3 upstream files touched.
2. **Effect.js migration avalanche** — upstream is aggressively migrating to Effect.js (20+ "destroy facade" commits recently), changing function signatures in files the downstream patches. Mitigate by never importing internal Effect-wrapped functions directly; always go through HTTP API/SDK boundary.
3. **SDK regeneration gap causing silent API drift** — 566 lines of manual fetch wrappers typed as `any` + stale SDK = silent runtime failures. Mitigate by making SDK regen a mandatory post-merge step and incrementally migrating manual wrappers.
4. **bun.lock merge hell** — conflicts on every single merge, with 4 patched deps at risk. Mitigate by scripting lockfile regeneration and post-install patch validation.
5. **Merge frequency decay** — exponential pain curve when merges are deferred (355-commit merge was a multi-hour ordeal). Mitigate by enforcing weekly merge cadence and tracking merge duration.

**Compound risk:** Pitfalls #1, #2, #4, and #6 can activate simultaneously during a big upstream Effect.js refactor that bumps deps. Prevention: never let the merge gap exceed 2 weeks.

## Implications for Roadmap

Based on combined research across all four dimensions, the sync system should be built in 4 phases following the automation spectrum (manual → scripted → semi-auto → CI-integrated).

### Phase 1: Merge Foundation & Manual Checklist

**Rationale:** All four research files identify this as the prerequisite. You can't automate what you haven't done manually. The architecture research explicitly recommends "checklist first" based on the repo's history of ~15 manual merges with no documented process.
**Delivers:** A documented, repeatable merge process that any developer can follow. Establishes the sync branch pattern, lockfile resolution flow, SDK regeneration step, and build verification order.
**Addresses:** All 7 table-stakes features from FEATURES.md (fetch, conflict detection, SDK check, patch check, build verify, test suite, rollback)
**Avoids:** Pitfall #4 (bun.lock hell — script the regeneration), Pitfall #12 (merge frequency decay — establish weekly cadence), Pitfall #1 (core modifications — audit and document current patch surface)
**Includes:**

- Document the manual merge checklist in `.planning/`
- Create the Known Conflict Surface Registry (the ~28 files with risk levels and strategies)
- Configure `git rerere` for recurring conflict patterns
- Add `.gitattributes` merge drivers for lockfiles
- Validate the checklist by performing one actual upstream merge

### Phase 2: Build Verification Script

**Rationale:** Architecture research identifies Build Verify as "the most mechanically complex component" and recommends building it first because it's useful beyond just syncs — it validates regular development too. STACK.md confirms all build tools are already in place.
**Delivers:** A single script that runs the full verification pipeline: `bun install` → typecheck → tests + WebGUI + SDK in parallel → IDE plugin compiles. Pass/fail per step with structured output.
**Addresses:** Build verification and test suite features; also serves as CI enhancement for regular PRs
**Avoids:** Pitfall #3 (SDK regeneration gap — makes it mandatory), Pitfall #7 (dual package manager — builds both bun and pnpm targets), Pitfall #8 (server mount fragility — adds smoke test)
**Includes:**

- Verification script (`script/verify-merge.ts` or similar)
- SDK regeneration as mandatory step when routes change
- VSCode plugin compile (pnpm) and JetBrains plugin compile (gradle)
- Minimal smoke test: start server, verify WebGUI mount responds

### Phase 3: Conflict Detection & Impact Analysis Script

**Rationale:** With the manual checklist proven and verification automated, the next bottleneck is understanding what upstream changed before attempting a merge. STACK.md verified that `git merge-tree --write-tree` correctly predicts conflicts. FEATURES.md identifies impact analysis by zone as the highest-value differentiator.
**Delivers:** A script that fetches upstream, predicts conflicts, classifies them by risk zone (safe/risky/guaranteed), generates a merge report with changelog, and advises on merge difficulty.
**Addresses:** Pre-merge dry run, impact analysis by zone, changelog extraction, sync frequency tracking
**Avoids:** Pitfall #2 (Effect.js migration — scan for signature changes before merge), Pitfall #6 (patch dep breakage — detect bumped patched deps before merge)
**Includes:**

- Fetch & Detect component (commit range, changelog summary)
- Impact Analysis component (conflict surface comparison, risk classification)
- Merge report generation (markdown with categorized file lists)
- Patch version change detection (compare before/after for 4 patched deps)

### Phase 4: GitHub Actions CI Integration

**Rationale:** Only automate after the manual process is proven and individual components are scripted. Architecture research positions this as "BUILD LAST" on the automation spectrum. Premature CI integration creates a pipeline that breaks and gets ignored.
**Delivers:** A GitHub Actions workflow (`upstream-sync.yml`) that runs the full pipeline: detect → analyze → (optionally) merge → verify → report via PR. Manually triggered with optional auto-merge for clean merges.
**Addresses:** Full automation of the sync loop; PR creation with structured conflict reports and labels
**Avoids:** Anti-feature of automated cron sync — trigger is manual, human reviews conflicts
**Includes:**

- GitHub Actions workflow with manual trigger (`workflow_dispatch`)
- Automated PR creation via `@octokit/rest` with conflict reports
- Labels: `upstream-sync`, `has-conflicts`, `clean-merge`, severity levels
- Merge report archived in `.planning/merges/YYYY-MM-DD.md`
- Optional: scheduled detection-only run (detect + report, no merge)

### Phase Ordering Rationale

- **Phase 1 before automation** because the architecture research shows this repo has done ~15 manual merges with undocumented, inconsistent processes. Documenting what works comes before scripting it.
- **Phase 2 before Phase 3** because build verification is useful for ALL development, not just syncs. It has independent value. Detection scripts are sync-specific.
- **Phase 3 before Phase 4** because CI integration wraps the detection + verification scripts. Building the components first means the CI workflow is thin orchestration, not complex logic.
- **Phases avoid the "Everything Breaks at Once" compound risk** by establishing merge cadence (Phase 1), verification (Phase 2), and early warning (Phase 3) before relying on automation (Phase 4).

### Research Flags

Phases likely needing deeper research during planning:

- **Phase 1:** Needs research into optimal `git rerere` configuration and whether existing recurring conflict patterns can be pre-seeded. Also needs an audit of the 12 downstream-modified upstream files to identify extraction candidates.
- **Phase 3:** `git merge-tree` output parsing needs prototyping — the output format is structured but not well-documented for programmatic consumption.

Phases with standard patterns (skip research-phase):

- **Phase 2:** All build tools are already configured and running in CI. This is pure scripting of existing commands in the correct order. No research needed.
- **Phase 4:** GitHub Actions workflow authoring is well-documented. The workflow wraps existing scripts. Standard patterns apply.

## Confidence Assessment

| Area         | Confidence | Notes                                                                                                                                     |
| ------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Stack        | HIGH       | Zero new dependencies. All tools verified in existing codebase. `git merge-tree` verified against actual conflict state.                  |
| Features     | HIGH       | Feature landscape derived from direct codebase analysis, git history, and PROJECT.md requirements. Dependency chain validated.            |
| Architecture | HIGH       | Pipeline components derived from actual past merge patterns (commit `41ce0564a`). Build verification order validated against existing CI. |
| Pitfalls     | HIGH       | All pitfalls sourced from actual codebase evidence — merge history, commit messages, known conflict files, upstream branch analysis.      |

**Overall confidence:** HIGH — This is unusually high confidence because the research is grounded entirely in direct codebase analysis rather than external sources. The conflict surface, merge history, build pipeline, and dependency graph are all observable facts.

### Gaps to Address

- **`git rerere` pre-seeding:** Can past conflict resolutions be recorded to bootstrap `rerere`? Needs testing during Phase 1 execution.
- **Effect.js migration velocity:** How fast is upstream migrating? Need to monitor during Phase 1 to calibrate merge frequency recommendation.
- **JetBrains plugin build:** Marked as SOFT gate in architecture — unclear if it blocks releases today. Validate during Phase 2.
- **Upstream competing UI:** The `sdks/vscode/` upstream branch is a strategic risk. Not addressable through sync tooling — requires monitoring and product strategy decisions at milestone boundaries.
- **`any` type elimination in WebGUI:** All research files flag this as amplifying risk. Not part of the sync workflow itself, but a parallel workstream that reduces sync risk over time. Should be tracked as a separate initiative.

## Sources

### Primary (HIGH confidence)

- Actual repository state: `git merge-tree --write-tree`, `git diff --stat`, `git log`, `git remote -v` — all run 2026-04-12
- Merge commit `41ce0564a` — detailed conflict documentation from the 355-commit merge
- Existing CI: `.github/workflows/test.yml`, `.github/workflows/typecheck.yml`
- Existing build config: `turbo.json`, `package.json`, `hosts/scripts/build_vscode.sh`
- Project context: `.planning/PROJECT.md`, `.planning/codebase/ARCHITECTURE.md`, `CONCERNS.md`

### Secondary (MEDIUM confidence)

- Third-party action evaluation: `aormsby/Fork-Sync-With-Upstream-action` (GitHub Marketplace), `peter-evans/create-pull-request` (GitHub Marketplace)
- GitHub fork sync docs: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/syncing-a-fork

### Tertiary (LOW confidence)

- `git merge-tree` programmatic output format — well-documented for human use, less so for scripted parsing. Needs prototyping.
- Upstream roadmap intent — inferred from branch names (`sdks/vscode/`, `app/startup-splash`), not confirmed

---

_Research completed: 2026-04-12_
_Ready for roadmap: yes_
