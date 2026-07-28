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

Both worktrees were created detached and completed `bun install --frozen-lockfile`. The first upstream install exceeded the outer 120 second command limit while resolving packages, then the unchanged dependency-install command was reissued and completed. The first current-start install failed because its Bun/Node environment did not expose Python to `node-gyp`; it was reissued with already-installed vfox Python `3.14.4` and completed. These were environment setup recovery steps, not reissues of failed candidate tests and not test retry mechanisms. Neither worktree had tracked changes after installation.

## Matrix Results

All commands were run from the named package directory with `vfox exec bun@1.3.14 nodejs@22.23.1 --`. Completed resource commands had an immediate empty Bun/Node test-process query. The Core runner reported and killed dangling child processes internally; no matching Bun/Node process was found after the command returned.

| Package | Command | Upstream result | Current-start result |
|---|---|---|---|
| client | `bun test test/promise.test.ts --timeout 5000` | exit 0, 7 pass | exit 1, unexpected `mcp` |
| httpapi-codegen | `bun test test/generate.test.ts test/write.test.ts --timeout 5000 --only-failures` | exit 1, 63 pass/3 fail | exit 1, 63 pass/3 fail |
| tui | `bun test test/runtime.test.tsx test/cli/cmd/tui/sync.test.tsx --timeout 30000 --only-failures` | exit 1, 3 pass/1 fail | exit 1, 2 pass/2 fail |
| core | `bun test test/git.test.ts test/move-session.test.ts test/project.test.ts test/repository-cache.test.ts test/snapshot.test.ts test/util/which.test.ts --only-failures` | exit 1, 22 pass/11 fail/6 errors | exit 1, 20 pass/13 fail/7 errors |
| sdk-next | `bun test test/embedded.test.ts --timeout 5000` | exit 1, 1 pass/3 fail | outer termination after first failure |
| opencode focused | `bun test test/server/httpapi-config.test.ts test/server/httpapi-file.test.ts --timeout 30000 --only-failures` | exit 0, 4 pass | after prerequisite restore: exit 1, 7 pass/1 provider fixture failure |
| opencode coverage | `bun run script/httpapi-exercise.ts --mode coverage --fail-on-missing --fail-on-skip` | not applicable | after prerequisite restore: exit 1, pass=215/fail=0/skip=0/missing=1 (`PUT /session/visibility`) |
| opencode auth | `bun run script/httpapi-exercise.ts --mode auth --fail-on-missing --fail-on-skip` | not applicable | after prerequisite restore: exit 1, pass=215/fail=0/skip=0/missing=1 (`PUT /session/visibility`) |
| opencode effect | `bun run script/httpapi-exercise.ts --mode effect --fail-on-missing --fail-on-skip --progress` | outer termination after `permission.list` | after prerequisite restore, outer termination after `project.directories` |

The current-start import prerequisite was restored only in that detached worktree by copying ignored `packages/opencode/src/webgui/embed.generated.ts` from primary. Source and destination SHA-256: `444DC1EBB3948E21659511D98432BE5F61746D4747823B28F42526FD7359F400`. Current-start tracked status was clean immediately after copying; the ignored artifact is not staged or committed. The four reissued current-start commands above were previously blocked by that missing prerequisite, not test retries intended to obtain a passing candidate result. No command used a larger timeout. After each outer termination, only the proven result is recorded: no matching residual process was found.

## Independent Failure Signatures

| Package | Test name / signature | Upstream result | Current-start result | Classification |
|---|---|---|---|---|
| httpapi-codegen | `HttpApiCodegen.generate > keeps the strict generated-consumer fixture current` | `ENOENT` opening `test/generated` | same `ENOENT` | upstream-known |
| httpapi-codegen | `HttpApiCodegen.write > writes compiled files beneath the output directory` | expected `/generated/...`, received `\generated\...` | same separator error | upstream-known |
| httpapi-codegen | `HttpApiCodegen.write > removes only stale files owned by the previous manifest` | expected `/generated/old.ts`, received `\generated\old.ts` | same separator error | upstream-known |
| core | `Git > fetches, checks out, and resets remote changes` | 5 second timeout; `git fetch origin +refs/heads/feature/docs...` child-process error | 5 second timeout; `git fetch --all --prune` child-process error | unresolved |
| core | `Git trees > captures, compares, previews, and restores scoped trees` | 5 second timeout | 5 second timeout with different child-process details | unresolved |
| core | `MoveSession > moves session changes to another project directory` | 5 second timeout; `CaptureChangesError` | 5 second timeout; `ResetSourceChangesError` | unresolved |
| core | `MoveSession > moves within a checkout without transferring existing changes` | 5 second timeout | no matching current failure | unresolved |
| core | `MoveSession > moves nested session changes without cleaning unrelated files` | 5 second timeout | 5 second timeout with different setup error | unresolved |
| core | `project.test.ts` unhandled signature | `ApplyChangesError: Destination is not a Git repository` | `CaptureChangesError` from `git diff --binary HEAD -- packages` | unresolved |
| core | `RepositoryCache > replaces a stale cache directory before cloning` | pass | 5 second timeout | downstream-owned |
| core | `RepositoryCache > serializes concurrent materialization for the same checkout` | pass | 5 second timeout | downstream-owned |
| core | `RepositoryCache > replaces an existing checkout whose origin does not match` | 5 second timeout; clone could not be opened | 5 second timeout; `git clone` child-process error | unresolved |
| core | `RepositoryCache > keeps branch checkouts isolated from branchless refreshes` | 5 second timeout | 5 second timeout plus expected `cached`, received `cloned` | unresolved |
| core | `RepositoryCache > does not mistake an enclosing repository for the cache checkout` | 5 second timeout; clone could not be opened | 5 second timeout; clone could not be opened after differing setup | unresolved |
| core | `Snapshot > captures and restores Location-scoped changes` | 5 second timeout; capture returned undefined | 5 second timeout; `write-tree` child-process error | unresolved |
| core | `Snapshot > isolates snapshot indexes by canonical Git worktree` | 5 second timeout; capture returned undefined | 5 second timeout; capture returned undefined after `write-tree` error | unresolved |
| core | `Snapshot > checks out a legacy revert snapshot without removing unrelated files` | 5 second timeout | same named 5 second timeout | upstream-known |
| core | `util.which > uses PATHEXT on windows` | pass | expected `.CMD`, received `.cmd` | downstream-owned |
| sdk-next | `embedded client uses the real router and handlers` cleanup | pass | `EBUSY` removing the embedded directory, then outer termination | downstream-owned |
| sdk-next | `Location-owned runner events reach the ready global client` | `SQLITE_CANTOPEN` | no result after outer termination | unresolved |
| sdk-next | `independent embedded hosts do not share live notifications` | `SQLITE_CANTOPEN` | no result after outer termination | unresolved |
| sdk-next | `embedded client is available as a Layer service` | `SQLITE_CANTOPEN` | no result after outer termination | unresolved |

## Classification

| Candidate | Upstream command/result | Current command/result | Classification | Action |
|---|---|---|---|---|
| Client MCP stale expected list | pass | unexpected `mcp` | downstream-owned | Task 2 test-only correction. |
| HttpApi Codegen signatures | same three named failures | same three named failures | upstream-known | none |
| TUI home abbreviation | `~/project` expected, `~\project` received | same signature | upstream-known | none |
| TUI `scope=project` stale expectation | pass | expected null, received `project` | downstream-owned | Task 5 test-only correction. |
| Core `which` single-result semantics | pass | expected `.CMD`, received `.cmd` | downstream-owned | Task 6 preserves `whichAll`. |
| Core child-process signatures | per-signature results above | per-signature results above | mixed upstream-known/unresolved/downstream-owned | Task 10 is open only for `RepositoryCache > replaces a stale cache directory before cloning` and `RepositoryCache > serializes concurrent materialization for the same checkout`; all other unresolved Core gates remain closed pending same-filter A/B evidence. |
| Core Snapshot legacy revert | same named 5 second timeout | same named 5 second timeout | upstream-known | none |
| sdk-next embedded cleanup | first named test passes; three distinct `SQLITE_CANTOPEN` signatures fail | first named test has `EBUSY`; remaining three have no result after termination | mixed downstream-owned/unresolved | Task 7 is open only for the first EBUSY signature. |
| Provider historical model fixture | focused upstream command passes | `serves provider catalog models without applying config whitelist` fails because `claude-sonnet-4-20250514` is absent | downstream-owned | Task 4 fixture correction. |
| File search readiness | focused upstream command passes | focused current command passes after prerequisite restore | conditional gate closed | none |
| `PUT /session/visibility` scenario | route is absent upstream | coverage/auth each report the downstream-only route missing | downstream-owned | Task 3 scenario addition. |
| HttpApi effect lifecycle | outer termination after `permission.list` | outer termination after `project.directories` | unresolved | Retain worktrees; isolate after visibility coverage work. |

## Retained Worktrees And Process State

The stale prunable `silent-orchid` entry was removed with ordinary `git worktree prune`; worktree listing now contains only primary plus the retained detached upstream/current-start worktrees. Unresolved signatures remain, so neither A/B worktree was removed. Final process query found no matching Bun or Node test processes. No primary production, test, generated, Comet, plan, or design file was modified; the ignored current-start artifact was not committed.
