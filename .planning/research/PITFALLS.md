# Domain Pitfalls

**Domain:** Downstream fork sync — WebGUI + IDE plugins on top of upstream CLI (opencode)
**Researched:** 2026-04-12
**Overall confidence:** HIGH (based on actual merge history and codebase analysis)

---

## Critical Pitfalls

Mistakes that cause rewrites, broken releases, or multi-day recovery efforts.

### Pitfall 1: Upstream Core Modifications Become Permanent Merge Tax

**What goes wrong:** The downstream has modified 12 files in `packages/opencode/src/` (config.ts, server.ts, mcp/index.ts, provider/provider.ts, session/message-v2.ts, skill/index.ts, etc.) to add WebGUI features (MCP tool toggles, skill permissions, server routes). Every upstream merge must manually reconcile these 12 files, and upstream changes these files frequently — the server alone had major refactors (Bun→Hono, workspace routing, Effect.js migration).

**Why it happens:** It's expedient to add a feature by patching the nearest upstream file rather than creating an extension point. The MCP route additions (routes/mcp.ts), config overlay (config.ts), and server mount point (server.ts → webgui/server/app.ts) are all direct upstream modifications.

**Consequences:**

- 51 downstream commits touch upstream src — each is a future conflict site
- The big merge (41ce0564a) modified 790 files with 46K insertions: this scales as divergence grows
- `server.ts` alone has been refactored ~10 times upstream in the last few months
- If upstream moves a file you've patched, `git merge` silently drops your changes

**Warning signs:**

- Merge commits taking more than 1 hour
- `git diff opencode/dev...HEAD -- packages/opencode/src/` growing over time
- Merge commit messages mentioning "resolve conflicts in server.ts" (already happened 3+ times)

**Prevention:**

1. Audit every downstream change in `packages/opencode/src/` — classify as "can be extracted to extension point" vs. "must remain as core patch"
2. For server routes: use Hono middleware composition — mount downstream routes via a separate module that `server.ts` imports with a single line, minimizing merge surface to one import line
3. For config: use a wrapper layer in `webgui/` that reads upstream config and overlays downstream additions, rather than patching `config.ts`
4. Track a "merge tax" metric: count of files in `packages/opencode/src/` with downstream changes
5. Target: ≤3 upstream files touched, ideally just the server mount point

**Detection:** Run `git diff opencode/dev...HEAD -- packages/opencode/src/ | diffstat` before each merge. If the count is growing, stop adding features and extract first.

**Phase:** Address in Phase 1 (Merge Foundation) — this is prerequisite to sustainable sync.

---

### Pitfall 2: Effect.js Migration Avalanche

**What goes wrong:** Upstream is in an aggressive Effect.js migration — destroying facades, changing function signatures from `Promise<T>` to `Effect<T, E, R>`, renaming `defineEffect → define`, and upgrading Effect beta versions (currently beta.46). This isn't a one-time refactor; it's an ongoing multi-month campaign with 20+ "destroy X facade" commits in the last few weeks alone.

**Why it happens:** The upstream project chose Effect.js for structured error handling and dependency injection. Their migration is incremental — each PR eliminates one facade wrapper. This means _every_ sync pulls in function signature changes across `packages/opencode/src/`.

**Consequences:**

- Downstream patches to `mcp/index.ts`, `config/config.ts`, `provider/provider.ts` etc. may call functions whose signatures changed from sync to Effect
- The generated SDK (`@opencode-ai/sdk`) may change its API surface when the server's OpenAPI spec changes
- TypeScript compilation may break silently due to Effect type inference changes (Effect<A, E, R> is a complex generic type)
- The `bun.lock` conflict surface expands with each Effect version bump (they're on beta.46, unstable API)

**Warning signs:**

- `bun typecheck` failures after merge referencing Effect types
- Import errors for removed facades like `Question`, `SessionRunState`, `Account`, etc.
- Runtime errors where downstream code calls a function that now returns `Effect<...>` instead of `Promise<...>`

**Prevention:**

1. Never import or call internal Effect-wrapped functions directly from downstream code — always go through the HTTP API/SDK boundary
2. If downstream MUST call upstream functions (e.g., config.ts), wrap them in a thin adapter that can absorb signature changes
3. Before each merge, scan upstream commits for `refactor(effect)` and `destroy.*facade` — count how many touch files you've modified
4. Pin a known-good Effect version in downstream patches if upstream upgrades cause instability

**Detection:** After each merge, immediately run `bun typecheck` in `packages/opencode` before anything else. Effect type errors compound — catch them early.

**Phase:** Phase 1 (Merge Foundation) — must establish adapter pattern before Effect migration reaches files you've modified.

---

### Pitfall 3: SDK Regeneration Gap Creates Silent API Drift

**What goes wrong:** The WebGUI depends on `@opencode-ai/sdk` which is auto-generated from the server's OpenAPI spec. When upstream adds/changes endpoints, the SDK needs regeneration. But `sdkClient.ts` has 566 lines of manual fetch wrappers for endpoints the SDK doesn't cover. After a merge, the generated SDK may have new/changed types, the manual wrappers may hit changed endpoints, and nothing catches the mismatch because everything is typed as `any`.

**Why it happens:** The SDK generator (`./packages/sdk/js/script/build.ts`) doesn't run automatically during merge. The 434+ `any` types in the WebGUI mean TypeScript can't catch API shape mismatches. The TODO on line 252 of sdkClient.ts ("Remove once SDK is regenerated with Stainless") has been there for months.

**Consequences:**

- WebGUI renders blank/error state for API responses whose shape changed
- New upstream features (e.g., session permissions, workspace routing) are invisible to WebGUI until manually wired
- Manual wrappers silently return wrong data shapes — e.g., a session object missing new fields
- 15+ API endpoints wrapped by hand means 15+ potential breaking points per merge

**Warning signs:**

- WebGUI shows "undefined" or blank fields after a merge
- Console errors about missing properties on API responses
- `sdkClient.ts` growing rather than shrinking after merges

**Prevention:**

1. **Post-merge checklist item:** Always regenerate SDK after merge with `./packages/sdk/js/script/build.ts`
2. **Reduce manual wrappers:** Each merge phase should migrate 2-3 manual wrappers to the generated SDK
3. **Type the contract:** Replace `any` in `ServerEvent` and `sdkClient.ts` with proper types from the generated SDK — this turns silent failures into compile-time errors
4. **Diff the OpenAPI spec:** Before and after merge, compare `openapi.json` to see what API surface changed

**Detection:** After regenerating SDK, run `bun typecheck` — new type errors reveal where manual wrappers diverged from actual API.

**Phase:** Phase 1 (Merge Foundation) for the regeneration step; Phase 2 for systematic `any` elimination.

---

### Pitfall 4: bun.lock Merge Hell

**What goes wrong:** `bun.lock` is a massive binary-ish JSON file that conflicts on _every_ merge because both sides add/update dependencies. The upstream has bumped AI SDK, Effect, and other deps frequently (10+ bun.lock changes in recent history). The downstream adds React, Tailwind, and IDE-specific deps. Every merge requires deleting the lockfile and regenerating — but this can pull in unintended version changes.

**Why it happens:** Lockfiles aren't designed for multi-branch workflows. Bun's lockfile format is especially hostile to merging (it's a binary format in newer versions). Both sides independently resolve dependency versions.

**Consequences:**

- Merge blocks on bun.lock conflicts every single time
- After regeneration, subtle dependency version changes can break things (especially with 4 patched deps)
- The patched dependencies (`@ai-sdk/anthropic@3.0.64`, `solid-js@1.9.10`, etc.) may silently upgrade past their patch version, breaking the patches
- Developer time wasted: 15-30 minutes per merge just on bun.lock

**Warning signs:**

- `bun install` warnings about patch version mismatches after merge
- Build failures referencing patched packages
- Different behavior between CI and local due to lockfile inconsistency

**Prevention:**

1. **Never manually resolve bun.lock conflicts** — always accept upstream's version, then run `bun install` to regenerate
2. **Automate in merge script:** `git checkout opencode/dev -- bun.lock && bun install`
3. **Post-install validation:** Check that all 4 patches still apply cleanly after regeneration
4. **Track patch versions:** Before merge, note current versions of patched deps. After merge, verify they haven't jumped.
5. **Consider**: Move WebGUI-only deps to `packages/opencode/webgui/package.json` to reduce root lockfile churn

**Detection:** Add a CI step that verifies `bun install --frozen-lockfile` passes AND patches apply.

**Phase:** Phase 1 (Merge Foundation) — literally the first conflict you'll hit on every merge.

---

## Moderate Pitfalls

### Pitfall 5: Upstream Adds Their Own WebGUI (Parallel UI Divergence)

**What goes wrong:** Upstream already has a SolidJS web UI (`packages/app/`) and may expand it to compete with the downstream React WebGUI. The upstream has `serveWebGuiPath` in `src/webgui/server/app.ts` — meaning they're already embedding web UIs. If upstream adds features to their SolidJS UI that duplicate the React WebGUI's features, maintaining both becomes unjustifiable.

**Why it happens:** The upstream project naturally wants to control its own UI experience. They're already investing in SolidJS web UI with Figma tokens, startup splash, and beta badge features (visible in branch names: `app/startup-splash`, `figma-tokens`, `go-hero-banner`).

**Consequences:**

- Feature parity pressure: every upstream SolidJS feature needs React reimplementation
- Users confused by two different UIs with different capabilities
- If upstream's web UI becomes an official IDE plugin (their branch `sdks/vscode/` already exists), the downstream fork loses its reason to exist

**Warning signs:**

- Upstream branches like `sdks/vscode/` or `app/ide-plugin`
- Upstream adding IDE-specific APIs (file open, workspace context)
- Upstream's SolidJS UI getting features that match your WebGUI feature list

**Prevention:**

1. **Differentiate on integration depth:** Focus on IDE-specific features (bridge protocol, file context, workspace awareness) that a generic web UI can't provide
2. **Consider contributing upstream:** Instead of maintaining a parallel React UI, propose contributing IDE integration features to the upstream project
3. **Monitor upstream roadmap:** Watch the `packages/app/` directory and `sdks/` directory for competing work
4. **Build exit strategy:** Architecture the WebGUI so it could be swapped for upstream's UI if they build equivalent features

**Detection:** Before each merge, check `git log opencode/dev -- packages/app/ sdks/` for new IDE-related work.

**Phase:** Strategic concern — revisit at each milestone boundary.

---

### Pitfall 6: Patch Dependencies Break on Upstream Dep Bumps

**What goes wrong:** The project patches 4 dependencies (`@ai-sdk/anthropic@3.0.64`, `@ai-sdk/provider-utils@4.0.21`, `@standard-community/standard-openapi@0.2.9`, `solid-js@1.9.10`). Upstream frequently bumps AI SDK deps (recent commit: `chore: bump ai sdk deps #22005`). When upstream bumps `@ai-sdk/anthropic` from 3.0.64 to 3.0.70, the downstream patch for 3.0.64 no longer applies.

**Why it happens:** Patches are version-pinned. Upstream doesn't know about downstream patches and freely bumps versions.

**Consequences:**

- `bun install` fails with "patch does not apply" errors
- Build blocked until patch is manually updated for new version
- If the upstream dep bump fixed the issue the patch addressed, the patch becomes harmful (applying an outdated fix on top of a proper fix)

**Warning signs:**

- `bun install` errors mentioning patches during CI
- Upstream commit messages containing "bump" + patched package names

**Prevention:**

1. **Before each merge:** Check if upstream bumped any of the 4 patched dependencies
2. **For each bumped dep:** Check if the upstream issue the patch fixes has been addressed in the new version
3. **Maintain a patch tracker:** Document what each patch fixes, the upstream issue URL, and the expected resolution version
4. **Automate detection:** Script that compares patched versions in root `package.json` before and after merge

**Detection:** `bun install` failure is the first sign. Proactive: diff `package.json` for patched dep version changes.

**Phase:** Phase 1 (Merge Foundation) — add to merge checklist.

---

### Pitfall 7: Dual Package Manager Drift

**What goes wrong:** Root uses Bun with bun workspaces; `hosts/vscode-plugin` uses pnpm with separate lockfile. TypeScript versions differ: root (5.8.2), WebGUI (5.9.3), VSCode plugin (5.0.0). After an upstream merge, the root TypeScript may bump, creating type incompatibilities with the VSCode plugin that uses TypeScript 5.0.0 (2+ major versions behind).

**Why it happens:** The VSCode plugin was developed independently with pnpm, and integrating it into the bun workspace was deemed too risky given VSCode extension packaging requirements (`vsce`).

**Consequences:**

- Types shared between WebGUI and VSCode plugin (like message protocol types) may be incompatible
- `bun install` and `pnpm install` resolve different versions of shared dependencies
- CI must run two separate install+build pipelines
- A TypeScript feature used in WebGUI may not compile in the VSCode plugin

**Warning signs:**

- VSCode plugin build fails after WebGUI changes
- Type errors in `CommunicationBridge.ts` or `UnifiedMessage.ts` that reference types from WebGUI
- `pnpm-lock.yaml` not updated when `bun.lock` changes

**Prevention:**

1. Define shared types in a standalone `.d.ts` file with no TS version-specific features
2. After each merge, always build both: `bun run build` (root) AND `pnpm build` (vscode-plugin)
3. Consider aligning TypeScript versions to within one minor version
4. Long-term: evaluate migrating vscode-plugin to bun workspace

**Detection:** CI must build both targets. A merge that passes `bun build` but not `pnpm build` is this pitfall manifesting.

**Phase:** Phase 1 (Merge Foundation) — add both builds to verification checklist.

---

### Pitfall 8: Server Mount Point Fragility

**What goes wrong:** The WebGUI is served by a single integration point: `server.ts` imports `serveWebGuiPath` from `src/webgui/server/app.ts` and mounts it. The upstream has refactored their server architecture 3 times in recent history (workspace routing, Hono migration, middleware simplification). Each refactor risks breaking or removing this mount point.

**Why it happens:** The mount point is a downstream addition to an upstream file. Upstream developers don't know about it, so they don't protect it during refactors.

**Consequences:**

- WebGUI becomes unreachable after merge — the mount call was lost during server.ts refactor
- No test catches this because there's no E2E test for the full server→webview flow
- Users see a blank/error webview with no clear error message

**Warning signs:**

- `server.ts` appears in merge conflict files
- Upstream commit messages mentioning "refactor(server)" or "replace" server components
- After merge, navigating to the WebGUI URL returns 404

**Prevention:**

1. Add a smoke test: after build, `curl localhost:PORT/` should return HTML with WebGUI markers
2. Make the mount point as small as possible — ideally one import and one `app.route()` call
3. If upstream adopts a plugin/middleware system for server routes, migrate the mount to use that system
4. The `initScript` in the embed approach (`src/webgui/server/app.ts`) is good — it's self-contained. Keep it that way.

**Detection:** Post-merge smoke test: start the server, hit `/`, verify HTML response.

**Phase:** Phase 1 (Merge Foundation) — add to automated verification.

---

## Minor Pitfalls

### Pitfall 9: IDE Bridge Protocol Version Skew

**What goes wrong:** The CommunicationBridge (VSCode↔WebGUI messaging) defines its own protocol types. When upstream changes how sessions, messages, or config work, the bridge protocol may pass stale data shapes. Because error handling is silently swallowed (36+ empty catch blocks), bridge failures are invisible.

**Prevention:**

1. Version the bridge protocol with a handshake on connection
2. Replace empty catch blocks with at least `console.warn` in bridge code
3. Add protocol compatibility test that verifies VSCode and WebGUI agree on message types

**Phase:** Phase 2 — after merge foundation is stable.

---

### Pitfall 10: Embedded Binary Extraction Breaks on Upstream Build Changes

**What goes wrong:** The VSCode plugin's `ResourceExtractor.ts` expects a specific binary layout in the extension bundle. If upstream changes how the Go binary is built (name, path, compilation flags), the extractor fails silently and users get a "connecting..." spinner for 5 minutes before timeout.

**Prevention:**

1. Add binary verification step: after extraction, run `opencode --version` to confirm it works
2. Reduce the 300-second timeout to 30 seconds with clear error messaging
3. After each merge, verify the binary name/path in `build_opencode.sh` matches `ResourceExtractor.ts` expectations

**Phase:** Phase 1 — add to merge verification checklist.

---

### Pitfall 11: Test Suite Divergence

**What goes wrong:** Upstream tests may rely on fixtures, configurations, or behaviors that downstream patches have changed. After merge, upstream tests may fail because downstream changed `config.ts` or `mcp/index.ts` in ways that alter expected behavior. Conversely, downstream tests for WebGUI features may break when upstream changes API responses.

**Prevention:**

1. Run the full test suite after every merge: `bun test` in `packages/opencode`, vitest in `webgui`, mocha in `vscode-plugin`
2. Keep downstream test fixtures isolated from upstream test fixtures
3. Tags or directories to distinguish: "upstream tests we run but don't modify" vs. "our tests"

**Phase:** Phase 1 — part of merge verification.

---

### Pitfall 12: Merge Frequency vs. Merge Pain — The Exponential Curve

**What goes wrong:** Waiting too long between merges makes each merge exponentially harder. The project has historically done 10+ merges but some were batched (41ce0564a covered "355 commits" — v1.3.0 to v1.3.3). When this happens, conflicts pile up, the developer loses context on what upstream changed, and the merge becomes a multi-day ordeal.

**Why it happens:** Merging is unpleasant, so it gets deferred. Each deferral makes the next merge more unpleasant, creating a death spiral.

**Prevention:**

1. **Merge weekly minimum** — even if there's nothing to release, pull upstream and resolve conflicts while they're small
2. **Automate conflict detection:** Script that runs `git merge --no-commit --no-ff opencode/dev`, reports conflicts, then aborts
3. **Budget merge time:** Allocate 2-4 hours/week for upstream sync, not as a special event
4. **Track merge duration:** If a merge takes >2 hours, that's a signal to merge more frequently or reduce upstream file modifications

**Detection:** `git log --oneline opencode/dev..HEAD | wc -l` — if this number exceeds 50, you're overdue.

**Phase:** Phase 1 — establish the cadence as part of process setup.

---

## Phase-Specific Warnings

| Phase Topic                    | Likely Pitfall                                                     | Mitigation                                                                         |
| ------------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| Phase 1: Merge Foundation      | bun.lock hell (#4) blocks first merge attempt                      | Script the lockfile regeneration flow before attempting your first automated merge |
| Phase 1: Merge Foundation      | Effect.js migration (#2) breaks typecheck after merge              | Run `bun typecheck` immediately after merge, before any other validation           |
| Phase 1: Merge Foundation      | Upstream core modifications (#1) cause cascading conflicts         | Audit and extract downstream patches before building automation around them        |
| Phase 2: Verification Pipeline | SDK regeneration gap (#3) causes silent API drift                  | Make SDK regen a mandatory CI step, not optional                                   |
| Phase 2: Verification Pipeline | Dual package manager (#7) means "build passes" ≠ "all builds pass" | CI must build root (bun) AND vscode-plugin (pnpm) AND jetbrains (gradle)           |
| Phase 2: Verification Pipeline | Server mount fragility (#8) undetectable without E2E smoke test    | Add minimal smoke test: start server, curl /, verify HTML                          |
| Ongoing: Every Merge           | Patch dep breakage (#6) on upstream dep bumps                      | Check patched dep versions before and after merge                                  |
| Ongoing: Every Merge           | Merge frequency decay (#12) causes exponential pain                | Enforce weekly merge cadence, track merge duration                                 |
| Strategic: Milestone Reviews   | Upstream parallel UI (#5) erodes differentiation                   | Monitor `packages/app/` and `sdks/` in upstream for competing IDE work             |

## Compound Risk: The "Everything Breaks at Once" Scenario

The most dangerous situation is when pitfalls #1, #2, #4, and #6 activate simultaneously: upstream does a big Effect.js refactor (#2) that changes function signatures in files you've modified (#1), bumps AI SDK deps breaking your patches (#6), and regenerates the lockfile (#4). This has already nearly happened — the 355-commit merge (41ce0564a) touched all these surfaces.

**Prevention for compound risk:**

- Never let merge gap exceed 2 weeks
- Merge upstream into a throwaway branch first, test, then merge to your dev branch
- Keep a "last known good" tag on the most recent successful merge point

---

## Sources

- Actual codebase analysis: `git remote -v`, `git log`, `git diff --stat`
- CONCERNS.md from codebase audit (2026-04-12)
- Upstream commit history: `opencode/dev` branch, 820+ commits ahead of downstream
- Merge history: 10+ merge commits with conflict notes in commit messages
- Upstream Effect.js migration: 20+ "destroy facade" commits in recent weeks
- Confidence: HIGH — all findings from direct codebase evidence, no external sources needed

---

_Pitfalls audit: 2026-04-12_
