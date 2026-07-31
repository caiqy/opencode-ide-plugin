# Upstream Test Baseline Recovery Design

## Goal

Restore the downstream test matrix after the `v1.18.6` merge without taking ownership of failures that already reproduce on the clean upstream tag.

## Baseline Rule

Run each observed failure in a detached `v1.18.6` worktree on the same Windows host with vfox-managed Bun `1.3.14` and Node.js `22.23.1`.

- The same failure signature on upstream is recorded as `upstream-known` and receives no downstream code change.
- A passing upstream case that fails on the current branch is downstream-owned and must be fixed.
- A downstream-only endpoint, test, or package is downstream-owned by definition.
- Different failures in the same test are treated as separate signatures and investigated independently.

The baseline report records the command, exit code, failing test name, and concise error signature for both refs. It does not add skips, retries, or broader timeouts.

## Confirmed Downstream Work

### Promise Client API Groups

`packages/protocol/src/groups/mcp.ts` adds the downstream MCP group while `packages/client/test/promise.test.ts` still asserts the upstream group list. Keep the MCP API and update the client contract test to include `mcp`, with the exact public methods `setEnabled` and `setToolEnabled`.

### Session Visibility Exercise

The downstream `PUT /session/visibility` endpoint has no scenario in `packages/opencode/test/server/httpapi-exercise/index.ts`. Add one protected, mutating scenario with a seeded session, a `sessionIDs` request body, and an exact response assertion. The same scenario must satisfy coverage, auth, and effect modes.

### Provider Catalog Fixture Drift

`packages/opencode/test/server/httpapi-config.test.ts` binds the catalog behavior test to a retired Claude model ID. Replace the whitelist with a deliberately nonexistent sentinel and assert that the catalog still contains multiple models. This tests that the endpoint ignores config filtering without depending on a volatile catalog entry.

### TUI Session Scope Expectation

`packages/tui/src/context/sync.tsx` retains the upstream `{ scope: "project" }` behavior, but downstream commit `928c6a4e73` changed only the test expectation to `null` while stabilizing the old suite. It introduced no matching runtime customization. Restore the test expectation to `project`; do not add a compatibility branch to production code.

### Core Command Lookup Semantics

The downstream `whichAll` addition routes `which` through multi-result lookup and changes the observable Windows path casing. Preserve the original single-result `which` call and keep multi-result lookup and deduplication inside `whichAll`. The existing PATHEXT test remains the regression check.

## Conditional Downstream Work

Only proceed when the upstream baseline passes and the current branch reproduces the failure.

- `sdk-next` SQLite `EBUSY`: trace database and runtime scope finalizers, then close the owning resource before temporary-directory removal. Do not add delete retries or sleeps.
- OpenCode file search readiness: wait on the index service's readiness signal at the owning boundary. Do not increase global test timeouts.
- HttpApi effect-mode stall: use scenario filters and tracing to identify the first blocked setup, route, or finalizer. Fix that lifecycle boundary rather than increasing the ten-minute outer limit.
- Core child-process or worktree cleanup: await process exit and scoped cleanup before worktree removal. Do not weaken assertions.

## Expected Upstream Exclusions

HttpApi Codegen path tests, TUI home abbreviation, and the Core RepositoryCache, Snapshot, and MoveSession failures currently use source and tests identical to `v1.18.6`. They are excluded when the detached upstream run reproduces the same signatures. The baseline result, not static similarity alone, is authoritative.

## Change Organization

Use one commit per root cause:

1. Downstream HTTP/API contract expectations.
2. Provider catalog fixture stability.
3. TUI project-scope expectation.
4. Core single-command lookup semantics.
5. Each independently confirmed lifecycle defect.

Do not include Comet files, generated workflow files, or pre-existing user changes. Generated Client or SDK files are regenerated only when their public source contract changes; test-only expectation changes do not trigger regeneration.

## Downstream Feature Preservation

The confirmed contract changes are test-only and must retain the downstream MCP group, session visibility endpoint, provider catalog behavior, and WebGUI visibility synchronization. The TUI correction restores the production behavior already present in both upstream and downstream code. The Core change preserves the downstream `whichAll` export while restoring the original `which` single-result semantics; focused tests cover both APIs before it is accepted.

Any conditional production fix must first capture the affected downstream behavior in a focused regression test. A fix is rejected if it removes a downstream endpoint, generated client group, IDE/WebGUI behavior, provider option, or session-filtering capability merely to match upstream.

## Verification

Each downstream fix follows red-green verification with the smallest focused command. Deterministic contract fixes need one focused pass and the owning package's default test command. Timing or cleanup fixes require repeated focused runs and a residual-process check.

Final acceptance requires:

- all downstream-owned focused tests pass;
- package suites have no failures except documented `upstream-known` signatures;
- HttpApi coverage, auth, and effect modes complete without missing or skipped downstream routes;
- no Bun or Node test process remains;
- no skip, retry, global timeout increase, or platform-only production shim was introduced;
- the Git index contains only the intended task files.
