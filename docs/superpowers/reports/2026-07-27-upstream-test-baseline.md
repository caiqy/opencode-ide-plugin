# v1.18.6 Windows Test Baseline

Date: 2026-07-28

## Environment And Starting Snapshot

- Host: Windows amd64.
- Toolchain: vfox Bun `1.3.14` and Node.js `v22.23.1`. The current-start install also used already-installed vfox Python `3.14.4` because `tree-sitter-powershell` needed it for `node-gyp`.
- Upstream tag commit: `00ac24ee5176117aae9df7873924d26b034a3229`.
- Current-start commit: `253389db631ad45627e133c7318b5e65a06479a8`.
- Initial staged paths: none.
- Initial dirty paths: `AGENTS.md`, `CLAUDE.md`, `hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml`, `docs/comet/archive/2026-07-27-merge-upstream-tags/`, `docs/comet/runtime/transactions/d54a08d2-041c-47fe-9984-c85f73d84aed/`, `docs/comet/specs/upstream-release-sync/`, `docs/superpowers/plans/2026-07-27-upstream-test-baseline-recovery.md`, and `docs/superpowers/specs/2026-07-27-upstream-test-baseline-recovery-design.md`.
- Confirmed and conditional candidate paths were clean before testing.

## Detached Worktrees

| Worktree | Path | HEAD | Clean status |
|---|---|---|---|
| upstream | `C:\Users\caiqy\AppData\Local\Temp\opencode\upstream-v1.18.6` | `00ac24ee5176117aae9df7873924d26b034a3229` | clean |
| current-start | `C:\Users\caiqy\AppData\Local\Temp\opencode\current-start` | `253389db631ad45627e133c7318b5e65a06479a8` | clean |

Both worktrees were created detached and completed `bun install --frozen-lockfile`. The first upstream install exceeded the outer 120 second command limit while resolving packages; its subsequent process query was empty. The same install was retried with the unchanged command and completed. The first current-start install failed because the prescribed Bun/Node invocation did not expose Python to `node-gyp`; the retry used the already-installed vfox Python `3.14.4` alongside the required Bun/Node versions and completed. Neither worktree had tracked changes after installation.

## Matrix Results

All commands were run from the named package directory with `vfox exec bun@1.3.14 nodejs@22.23.1 --`. After every completed resource command, the Bun/Node test-process query was empty. The Core runner itself reported and killed dangling child processes; no Bun/Node process remained after the command returned.

| Package | Command | Upstream result | Current-start result |
|---|---|---|---|
| client | `bun test test/promise.test.ts --timeout 5000` | exit 0, 7 pass | exit 1, `exposes every standard HTTP API group`: unexpected `mcp` |
| httpapi-codegen | `bun test test/generate.test.ts test/write.test.ts --timeout 5000 --only-failures` | exit 1, 63 pass/3 fail: missing `test/generated` and `/` versus `\` output paths | exit 1, same 63 pass/3 fail signatures |
| tui | `bun test test/runtime.test.tsx test/cli/cmd/tui/sync.test.tsx --timeout 30000 --only-failures` | exit 1, 3 pass/1 fail: home abbreviation expected `~/project`, received `~\project` | exit 1, 2 pass/2 fail: same home failure plus sync expected null, received `project` |
| core | `bun test test/git.test.ts test/move-session.test.ts test/project.test.ts test/repository-cache.test.ts test/snapshot.test.ts test/util/which.test.ts --only-failures` | exit 1, 22 pass/11 fail/6 errors; Git, MoveSession, RepositoryCache, and Snapshot hit 5 second child-process failures | exit 1, 20 pass/13 fail/7 errors; overlapping tests hit child-process failures with different underlying commands, plus `util.which` expected `.CMD`, received `.cmd` |
| sdk-next | `bun test test/embedded.test.ts --timeout 5000` | exit 1, 1 pass/3 fail: `SQLiteError: SQLITE_CANTOPEN` | outer termination after first failure: `EBUSY` removing embedded directory; process query empty |
| opencode | `bun test test/server/httpapi-config.test.ts test/server/httpapi-file.test.ts --timeout 30000 --only-failures` | exit 0, 4 pass | exit 1, both tests blocked by missing `src/webgui/embed.generated` |
| opencode | `bun run script/httpapi-exercise.ts --mode effect --fail-on-missing --fail-on-skip --progress` | outer termination after `RUN GET /permission permission.list`; process query empty | exit 1 before scenarios: missing `src/webgui/embed.generated` |
| opencode, current only | `bun run script/httpapi-exercise.ts --mode coverage --fail-on-missing --fail-on-skip` | not applicable | exit 1 before scenarios: missing `src/webgui/embed.generated` |
| opencode, current only | `bun run script/httpapi-exercise.ts --mode auth --fail-on-missing --fail-on-skip` | not applicable | exit 1 before scenarios: missing `src/webgui/embed.generated` |

No command was rerun with a larger timeout. The outer-terminated upstream effect and current sdk-next processes were checked immediately and had exited normally by the time of inspection.

## Classification

| Candidate | Upstream command/result | Current command/result | Classification | Action |
|---|---|---|---|---|
| Client MCP stale expected list | pass | `mcp` is unexpected in `exposes every standard HTTP API group` | downstream-owned | Task 2: update the test contract only. |
| HttpApi Codegen generated fixture and path separators | missing fixture plus slash-separator assertions fail | same failing tests and semantics | upstream-known | none |
| TUI home abbreviation | `abbreviates paths within home boundaries` receives `~\project` | same failure | upstream-known | none |
| TUI `scope=project` stale expectation | pass | `tui sync` expects null and receives `project` | downstream-owned | Task 5: restore the test expectation only. |
| Core `which` single-result semantics | `util.which` passes | expected `.CMD`, received `.cmd` | downstream-owned | Task 6: restore single-result lookup while preserving `whichAll`. |
| Core Git, MoveSession, Project, RepositoryCache, and Snapshot cleanup failures | 5 second child-process timeout/errors | overlapping test names but different Git command/error signatures and extra current failures | unresolved | Retain worktrees; re-run one failing file/filter per signature before any Task 10 change. |
| sdk-next embedded cleanup | `SQLITE_CANTOPEN` | `EBUSY` followed by outer termination | unresolved | Retain worktrees; isolate each signature before Task 7. |
| HttpApi config/file current test prerequisite | pass | missing `src/webgui/embed.generated` | downstream-owned | Restore the existing test build prerequisite outside this Task 1 report, then repeat the affected baseline commands. |
| Provider historical model fixture | pass; no provider failure | blocked before test body by missing `embed.generated` | unresolved | Re-run after the prerequisite is restored. |
| File search readiness | pass; no search failure | blocked before test body by missing `embed.generated` | unresolved | Re-run after the prerequisite is restored. |
| Session visibility coverage scenario | upstream effect run outer-terminated | coverage run blocked by missing `embed.generated` | unresolved | Re-run coverage after prerequisite restoration. |
| HttpApi effect lifecycle | outer termination after `permission.list` | immediate missing `embed.generated` error | unresolved | Retain worktrees and isolate after prerequisites are available. |

## Retained Worktrees And Process State

Unresolved signatures remain, so neither detached worktree was removed. Final process query found no matching Bun or Node test processes. No production, test, plan, design, Comet, or generated file was modified by this task.
