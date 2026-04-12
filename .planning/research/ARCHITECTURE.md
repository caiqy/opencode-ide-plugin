# Architecture Patterns: Upstream Sync System

**Domain:** Fork maintenance — downstream IDE-plugin fork syncing with upstream CLI tool
**Researched:** 2026-04-12
**Confidence:** HIGH (derived from actual repo structure, git history, and merge-commit analysis)

## Context

This fork (`caiqy/opencode-ide-plugin`) adds a WebGUI layer and IDE plugin hosts (VSCode, JetBrains) on top of the upstream `anomalyco/opencode` CLI tool. The upstream moves fast (~355 commits between syncs). The downstream modifies ~28 files that also change upstream, creating a predictable but non-trivial merge surface.

**Git topology:**

- `opencode` remote → upstream CLI repo (`anomalyco/opencode`, default branch `dev`)
- `upstream` remote → intermediate fork (`paviko/opencode-ide-plugin`)
- `origin` remote → this repo (`caiqy/opencode-ide-plugin`, default branch `ide-plugin`)

## Recommended Architecture

The sync system has **5 components** organized in a pipeline. Each component is a discrete step that can fail independently and be retried.

```
┌─────────────────────────────────────────────────────────────────┐
│                    UPSTREAM SYNC PIPELINE                        │
│                                                                 │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌────────────┐  │
│  │  Fetch & │   │ Impact   │   │  Merge   │   │   Build    │  │
│  │  Detect  │──▶│ Analysis │──▶│ Execute  │──▶│   Verify   │  │
│  │          │   │          │   │          │   │            │  │
│  └──────────┘   └──────────┘   └──────────┘   └────────────┘  │
│       │              │              │               │           │
│       ▼              ▼              ▼               ▼           │
│  "New commits    "These files   "Merge done,    "Build pass,   │
│   available"      will clash"    N conflicts"    tests pass"   │
│                                                     │           │
│                                              ┌──────┴────────┐ │
│                                              │  Regression   │ │
│                                              │  Gate         │ │
│                                              └───────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### Component Boundaries

| Component           | Responsibility                                                                        | Input                                 | Output                                                | Communicates With                         |
| ------------------- | ------------------------------------------------------------------------------------- | ------------------------------------- | ----------------------------------------------------- | ----------------------------------------- |
| **Fetch & Detect**  | Poll upstream, determine if new commits exist since last merge-base                   | Git remotes                           | Commit range, changelog summary                       | Impact Analysis                           |
| **Impact Analysis** | Identify which downstream-modified files are touched by the incoming upstream commits | Commit range + known conflict surface | Conflict risk report (per-file), categorized severity | Merge Execute (informs strategy)          |
| **Merge Execute**   | Perform `git merge opencode/dev` into a sync branch, surface conflicts                | Merge strategy + branch refs          | Merged branch (possibly with unresolved conflicts)    | Build Verify                              |
| **Build Verify**    | Run typecheck, unit tests, WebGUI build, SDK regeneration                             | Merged branch                         | Pass/fail status per check                            | Regression Gate                           |
| **Regression Gate** | Decide go/no-go: all checks pass, or report what broke                                | Build results                         | Final verdict + report                                | Human (for conflict resolution decisions) |

### Data Flow

```
opencode/dev (upstream)
    │
    ▼
[1] git fetch opencode
    │
    ▼
[2] git log $(git merge-base HEAD opencode/dev)..opencode/dev
    │   → commit list, diffstat
    │
    ▼
[3] Compare diffstat against KNOWN_CONFLICT_FILES list
    │   → per-file risk: SAFE / LIKELY_CONFLICT / GUARANTEED_CONFLICT
    │
    ▼
[4] git checkout -b sync/upstream-YYYYMMDD
    git merge opencode/dev
    │   → merge result (clean or conflicted)
    │
    ▼
[5] If conflicts: generate conflict report with file, ours/theirs context
    Human resolves (with AI assistance)
    │
    ▼
[6] bun install
    bun typecheck
    bun turbo test (from packages/opencode)
    Build WebGUI: bun --cwd packages/opencode/webgui build
    Build SDK: bun packages/sdk/js/script/build.ts
    VSCode compile: pnpm --cwd hosts/vscode-plugin compile
    JetBrains compile: gradle build (from hosts/jetbrains-plugin)
    │
    ▼
[7] All pass? → merge sync branch into ide-plugin
    Any fail? → report which step failed, stop
```

## Component Details

### Component 1: Fetch & Detect

**Purpose:** Determine if upstream has moved since last sync.

**Mechanism:**

```bash
git fetch opencode
MERGE_BASE=$(git merge-base HEAD opencode/dev)
UPSTREAM_HEAD=$(git rev-parse opencode/dev)

if [ "$MERGE_BASE" = "$UPSTREAM_HEAD" ]; then
  echo "Already up to date"
  exit 0
fi

# Count commits
git rev-list --count $MERGE_BASE..opencode/dev
# Get summary
git log --oneline $MERGE_BASE..opencode/dev
```

**Output:** Commit count, short log, date range of new upstream commits.

**Boundary:** This component does NOT modify any branches. Read-only.

### Component 2: Impact Analysis

**Purpose:** Predict merge difficulty before attempting it.

**Key insight from repo analysis:** The conflict surface is finite and predictable. Based on git history, these files are modified both upstream and downstream:

**Guaranteed conflict zone (both sides actively modify):**
| File | Downstream reason | Risk |
|------|-------------------|------|
| `packages/opencode/src/server/server.ts` | WebGUI `/app` route mounting, CORS | HIGH |
| `packages/opencode/src/config/config.ts` | Tools overlay, skill permission overlay | HIGH |
| `packages/opencode/src/server/routes/mcp.ts` | MCP enable/disable routes | MEDIUM |
| `packages/opencode/src/session/compaction.ts` | Stream error recovery | MEDIUM |
| `packages/opencode/src/mcp/index.ts` | setEnabled, setToolEnabled, toolsByServer | MEDIUM |
| `packages/opencode/src/skill/index.ts` | Skill permission overlay | MEDIUM |
| `bun.lock` | Always conflicts on dependency updates | LOW (auto-resolvable) |
| `package.json` | Workspace/dep changes | LOW |
| `turbo.json` | Task configuration | LOW |

**Safe zone (downstream-only additions, upstream doesn't touch):**
| Area | Files |
|------|-------|
| `hosts/` entire directory | VSCode plugin, JetBrains plugin, build scripts, bridge spec |
| `packages/opencode/webgui/` | Entire WebGUI SPA (React frontend) |
| `.planning/` | Project management |

**Analysis mechanism:**

```bash
# Get upstream changes
git diff --name-only $MERGE_BASE..opencode/dev > /tmp/upstream.txt
# Get downstream changes
git diff --name-only $MERGE_BASE..HEAD > /tmp/downstream.txt
# Find overlap
comm -12 <(sort /tmp/upstream.txt) <(sort /tmp/downstream.txt)
```

**Output:** Categorized file list with risk levels. If only safe-zone files changed upstream, the merge is trivial.

**Boundary:** Read-only analysis. No branch modifications.

### Component 3: Merge Execute

**Purpose:** Perform the actual merge on an isolated branch.

**Strategy (derived from past merge commits in this repo):**

1. **Always create a sync branch:** `sync/upstream-YYYYMMDD` from current `ide-plugin` HEAD
2. **Use `git merge` (not rebase):** History shows all past syncs used merge commits. Rebase would rewrite downstream history and conflict with IDE plugin development branches.
3. **Preserve both sides when possible:** The merge commit `41ce0564a` documents the pattern: "All 15 conflicts resolved preserving webgui plugin functionality"

**Conflict resolution priorities (from PROJECT.md):**

1. Preserve upstream logic changes (we want their features)
2. Preserve downstream additions (our `/app` routes, config overlays, MCP routes)
3. When incompatible: keep both with conditional logic, or flag for human decision

**Key merge patterns observed in history:**

- `/app` routes: Insert before `WorkspaceRouter` middleware in `server.ts`
- Config overlays: Merge downstream `patchProjectField` / `toolsOverlay` into upstream's Config.get()
- MCP routes: Downstream adds `PATCH /mcp/:name/enabled` — ensure route registration survives upstream refactors
- SSE error recovery: Downstream adds `normalizeAnthropic`, `TypeValidationError` catch — preserve these in upstream's streaming pipeline

**Boundary:** Creates a new branch. Does NOT modify `ide-plugin` directly.

### Component 4: Build Verify

**Purpose:** Confirm the merged code compiles, passes types, and tests pass.

**Verification chain (order matters — each depends on previous):**

```
Step 1: bun install                              [dependency resolution]
   ↓
Step 2: bun typecheck                            [TypeScript across all packages]
   ↓  (parallel from here)
Step 3a: bun turbo test                          [unit tests - packages/opencode]
Step 3b: bun --cwd packages/opencode/webgui build [WebGUI compiles]
Step 3c: bun packages/sdk/js/script/build.ts     [SDK regeneration from OpenAPI]
   ↓  (after 3a-3c pass)
Step 4a: pnpm --cwd hosts/vscode-plugin compile  [VSCode extension compiles]
Step 4b: gradle build (hosts/jetbrains-plugin)    [JetBrains plugin compiles]
```

**Why this order:**

- `bun install` must come first — upstream often changes dependencies
- `typecheck` catches type errors across the monorepo before wasting time on tests
- Unit tests and builds can run in parallel (independent)
- IDE plugins depend on the opencode backend being buildable, so they come last

**Boundary:** Runs on the sync branch. Produces pass/fail per step.

### Component 5: Regression Gate

**Purpose:** Final go/no-go decision with actionable report.

**Gate criteria:**

| Check                     | Required | Rationale                        |
| ------------------------- | -------- | -------------------------------- |
| `bun install` succeeds    | YES      | Can't proceed without deps       |
| `bun typecheck` passes    | YES      | Type errors = broken API surface |
| `bun turbo test` passes   | YES      | Core functionality validated     |
| WebGUI builds             | YES      | WebGUI is the product's UI       |
| SDK regenerates cleanly   | YES      | API contract maintained          |
| VSCode plugin compiles    | YES      | Primary delivery vehicle         |
| JetBrains plugin compiles | SOFT     | Can proceed with known issues    |

**Report format:**

```
Upstream Sync Report: opencode/dev @ <sha>
Commits merged: <N>
Conflicts resolved: <N>

Build Results:
  ✓ bun install
  ✓ typecheck
  ✓ unit tests (N passed, M failed)
  ✓ webgui build
  ✓ sdk regeneration
  ✓ vscode compile
  ✗ jetbrains compile (error: ...)

Verdict: PASS / FAIL / PASS_WITH_WARNINGS
```

**Boundary:** Decision point. If PASS, the sync branch is ready to merge into `ide-plugin`.

## Patterns to Follow

### Pattern 1: Known Conflict Surface Registry

**What:** Maintain an explicit list of files that are modified downstream and likely to conflict with upstream changes.

**Why:** The conflict surface is finite (~28 files). Knowing it in advance lets you:

- Predict merge difficulty before attempting it
- Pre-prepare resolution strategies for known hot spots
- Detect when upstream refactors move code out of known locations (new risk)

**Implementation:**

```typescript
// .planning/sync/CONFLICT_SURFACE.md or a JSON/TS config
const CONFLICT_SURFACE = {
  high: [
    "packages/opencode/src/server/server.ts", // /app route mounting
    "packages/opencode/src/config/config.ts", // tools/skill overlays
  ],
  medium: [
    "packages/opencode/src/server/routes/mcp.ts", // MCP toggle routes
    "packages/opencode/src/mcp/index.ts", // MCP methods
    "packages/opencode/src/skill/index.ts", // skill overlay
    "packages/opencode/src/session/compaction.ts", // error recovery
  ],
  low: [
    "bun.lock", // auto-resolvable
    "package.json", // dep changes
    "turbo.json", // task config
  ],
  safe: [
    "hosts/**", // downstream-only
    "packages/opencode/webgui/**", // downstream-only
  ],
}
```

**Update discipline:** After each sync, review whether the surface changed. New files in the overlap = add to registry.

### Pattern 2: Sync Branch Isolation

**What:** Never merge upstream directly into `ide-plugin`. Always through `sync/upstream-YYYYMMDD`.

**Why:**

- If the merge goes badly, discard the branch. `ide-plugin` is untouched.
- CI can run against the sync branch before merging.
- Multiple people can collaborate on conflict resolution on the sync branch.
- Clean merge commit messages (like `41ce0564a`) document what changed.

### Pattern 3: Lock File Resolution Strategy

**What:** Always resolve `bun.lock` by accepting upstream then re-running `bun install`.

**Why:** `bun.lock` is a generated file. Manual merge is impossible and pointless. The downstream `webgui` and `hosts` packages are declared in `package.json` workspaces, so `bun install` regenerates the lock correctly with both upstream and downstream dependencies.

```bash
# During merge conflict on bun.lock:
git checkout --theirs bun.lock
bun install
git add bun.lock
```

### Pattern 4: SDK Regeneration After Merge

**What:** Always regenerate the SDK after any merge that touches server routes.

**Why:** The SDK is auto-generated from OpenAPI spec (Hono route metadata). If upstream changes routes, the SDK must be regenerated to match. The WebGUI and host plugins consume this SDK.

```bash
bun packages/sdk/js/script/build.ts
```

**Detection:** If `packages/opencode/src/server/routes/**` appears in upstream diff, SDK regen is mandatory.

## Anti-Patterns to Avoid

### Anti-Pattern 1: Cherry-Pick Sync

**What:** Cherry-picking individual upstream commits instead of merging.
**Why bad:** Upstream has 200-400 commits between syncs. Cherry-picking creates phantom conflicts, loses merge history, and makes the next sync harder. Git merge preserves the relationship correctly.

### Anti-Pattern 2: Rebasing Downstream onto Upstream

**What:** `git rebase opencode/dev` on the `ide-plugin` branch.
**Why bad:** Rewrites all downstream commit hashes. Breaks any branches based on `ide-plugin`. Forces force-push. The existing history shows merge-based sync works.

### Anti-Pattern 3: Modifying Upstream Files Without Tracking

**What:** Making changes to upstream-owned files without adding them to the conflict surface registry.
**Why bad:** Creates surprise conflicts during the next sync. Every downstream modification to an upstream file should be deliberate, minimal, and registered.

### Anti-Pattern 4: Skipping Build Verification

**What:** Merging upstream without running the full build pipeline.
**Why bad:** The last major merge (`41ce0564a`) had 15 conflicts. Type errors and test failures from unresolved conflicts are only caught by running the pipeline. "It merged without conflicts" ≠ "it works."

## Suggested Build Order (Dependencies)

The sync pipeline components must be built in this order:

```
Phase 1: Fetch & Detect + Impact Analysis
  ├── These are pure analysis tools, no dependencies on each other
  ├── Can be a single script or CI job
  └── Output: decision to proceed or skip

Phase 2: Merge Execute
  ├── Depends on Phase 1 (needs commit range info)
  ├── Core git operations + conflict resolution
  └── Output: sync branch with resolved merge

Phase 3: Build Verify
  ├── Depends on Phase 2 (needs merged code)
  ├── Run on sync branch
  ├── Internal dependency chain:
  │   bun install → typecheck → [tests | webgui | sdk] → [vscode | jetbrains]
  └── Output: pass/fail results

Phase 4: Regression Gate
  ├── Depends on Phase 3 (needs build results)
  ├── Decision logic + report generation
  └── Output: go/no-go + merge into ide-plugin
```

**Implementation priority:** Build Phase 3 (Build Verify) first — this is the most mechanically complex component and is useful even for regular development (not just syncs). Then Phase 1+2 (the git workflow), then Phase 4 (the reporting/gating).

## Automation Spectrum

Not everything needs to be automated on day one. This is the recommended progression:

| Level                  | What                                                 | How                                         | Priority     |
| ---------------------- | ---------------------------------------------------- | ------------------------------------------- | ------------ |
| **Manual + Checklist** | Entire sync process following a documented checklist | Markdown document in `.planning/`           | BUILD FIRST  |
| **Scripted**           | Build verification chain (Phase 3)                   | Shell script running the verification steps | BUILD SECOND |
| **Semi-auto**          | Fetch + Impact Analysis (Phase 1)                    | Script that reports but doesn't act         | BUILD THIRD  |
| **CI-integrated**      | Full pipeline as GitHub Action                       | Workflow triggered manually or on schedule  | BUILD LAST   |

**Rationale:** The current repo has had ~15 upstream merges, all done manually. The bottleneck is not automation — it's having a reliable, repeatable process. A checklist that's followed beats a half-broken CI pipeline that's ignored.

## Scalability Considerations

| Concern         | Current (manual, ~monthly syncs) | At weekly syncs                    | At daily syncs          |
| --------------- | -------------------------------- | ---------------------------------- | ----------------------- |
| Conflict volume | 5-15 file conflicts              | 1-3 file conflicts (smaller delta) | Rare (tiny delta)       |
| Resolution time | 1-4 hours                        | 15-30 min                          | Minutes                 |
| Automation need | Checklist sufficient             | Scripts essential                  | CI mandatory            |
| SDK regen       | Every sync                       | Every sync                         | Only when routes change |
| Build time      | ~5 min                           | ~5 min                             | Cache builds, ~2 min    |

**Key insight:** Syncing more frequently makes each sync smaller and easier. The architecture should support increasing frequency over time.

## Sources

- Git history analysis: `git log`, `git diff`, `git merge-base` on the actual repository
- Past merge commits: `41ce0564a` (355-commit merge with detailed conflict documentation)
- Build pipeline: `turbo.json`, `package.json`, `hosts/scripts/build_vscode.sh`
- CI workflows: `.github/workflows/test.yml`, `.github/workflows/typecheck.yml`
- Project context: `.planning/PROJECT.md`, `.planning/codebase/ARCHITECTURE.md`
- Integration map: `.planning/codebase/INTEGRATIONS.md`

---

_Architecture research: 2026-04-12_
