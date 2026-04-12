# Roadmap: OpenCode IDE Plugin — Upstream Sync Workflow

## Overview

This roadmap builds a reliable upstream sync pipeline for a deeply diverged fork (384 commits ahead, 105K lines added). The journey follows the automation spectrum: establish a safe, documented merge process → prove merges don't break anything via automated verification → automate conflict detection and SDK/patch checks → add pre-merge impact analysis for informed decision-making. Every phase delivers a complete, independently useful capability.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Merge Foundation** - Safe, documented, repeatable upstream merge process on isolated sync branches
- [ ] **Phase 2: Build Verification** - Automated post-merge verification pipeline proving nothing broke
- [ ] **Phase 3: Conflict Detection** - Automated conflict reporting, SDK regeneration checks, and patch compatibility validation
- [ ] **Phase 4: Impact Analysis** - Pre-merge change classification, dry-run previews, changelog extraction, and sync tracking

## Phase Details

### Phase 1: Merge Foundation

**Goal**: Developer can safely merge upstream changes on an isolated branch with a documented process and clear rollback path
**Depends on**: Nothing (first phase)
**Requirements**: SYNC-01, SYNC-05, SYNC-06
**Success Criteria** (what must be TRUE):

1. Developer can create a sync branch, fetch upstream, and merge — without touching the main dev branch
2. Developer can abort or roll back a failed merge to a clean state in under 1 minute
3. A written checklist exists that another developer could follow to perform a complete upstream sync
4. The checklist has been validated by performing at least one actual upstream merge end-to-end
   **Plans**: TBD

Plans:

- [ ] 01-01: TBD
- [ ] 01-02: TBD
- [ ] 01-03: TBD

### Phase 2: Build Verification

**Goal**: After any merge, a single command verifies type safety, builds, and tests across all components — with structured pass/fail reporting
**Depends on**: Phase 1
**Requirements**: BUILD-01, BUILD-02, BUILD-03, BUILD-04, BUILD-05, BUILD-06
**Success Criteria** (what must be TRUE):

1. Running the verification script produces a structured report showing pass/fail for each component (typecheck, webgui, vscode, jetbrains, tests)
2. A type error in any package causes the verification to report failure for that component
3. WebGUI vite build, VSCode pnpm compile, and JetBrains gradle build are all verified in one run
4. Test suites (vitest for webgui, mocha for vscode) run and their results appear in the report
5. The verification script can be run independently of the sync workflow (useful for regular development)
   **Plans**: TBD

Plans:

- [ ] 02-01: TBD
- [ ] 02-02: TBD
- [ ] 02-03: TBD

### Phase 3: Conflict Detection

**Goal**: After a merge, automatically detect and report conflicts by risk zone, flag SDK regeneration needs, and validate dependency patches
**Depends on**: Phase 1
**Requirements**: SYNC-02, SYNC-03, SYNC-04
**Success Criteria** (what must be TRUE):

1. After a merge, a conflict report is generated categorizing files as downstream-only / upstream-only / shared with risk levels
2. When upstream changes server routes or OpenAPI spec, the report flags that SDK regeneration is needed
3. When upstream bumps versions of the 4 patched dependencies, the report flags which patches need re-validation
   **Plans**: TBD

Plans:

- [ ] 03-01: TBD
- [ ] 03-02: TBD
- [ ] 03-03: TBD

### Phase 4: Impact Analysis

**Goal**: Before committing to a merge, developer can preview expected conflicts, understand upstream changes, and track sync health over time
**Depends on**: Phase 3
**Requirements**: IMPACT-01, IMPACT-02, IMPACT-03, IMPACT-04
**Success Criteria** (what must be TRUE):

1. Upstream changes are classified into safe zones (upstream-only dirs) and risk zones (shared dirs) before the merge happens
2. Developer can run a dry-run that shows which files will conflict — without modifying the working tree
3. A changelog is extracted from upstream commits grouped by category (feat/fix/refactor/breaking)
4. Each sync records metadata (date, commits absorbed, conflicts encountered) enabling merge frequency tracking
   **Plans**: TBD

Plans:

- [ ] 04-01: TBD
- [ ] 04-02: TBD
- [ ] 04-03: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase                 | Plans Complete | Status      | Completed |
| --------------------- | -------------- | ----------- | --------- |
| 1. Merge Foundation   | 0/3            | Not started | -         |
| 2. Build Verification | 0/3            | Not started | -         |
| 3. Conflict Detection | 0/3            | Not started | -         |
| 4. Impact Analysis    | 0/3            | Not started | -         |
