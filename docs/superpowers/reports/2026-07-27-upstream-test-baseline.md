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
| core | `RepositoryCache > replaces a stale cache directory before cloning` | initial pass; final rerun timed out at 5 seconds | 5 second timeout | upstream-reproduced |
| core | `RepositoryCache > serializes concurrent materialization for the same checkout` | final rerun timed out at 5 seconds | 5 second timeout | upstream-reproduced |
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
| Core child-process signatures | per-signature results above | per-signature results above | upstream-known or upstream-reproduced | Task 10 closed without code changes after the retained upstream and current-start single-file reruns both timed out on the two original RepositoryCache candidates. |
| Core Snapshot legacy revert | same named 5 second timeout | same named 5 second timeout | upstream-known | none |
| sdk-next embedded cleanup | first named test passes; three distinct `SQLITE_CANTOPEN` signatures fail | first named test has `EBUSY`; remaining three have no result after termination | mixed downstream-owned/unresolved | Task 7 is open only for the first EBUSY signature. |
| Provider historical model fixture | focused upstream command passes | `serves provider catalog models without applying config whitelist` fails because `claude-sonnet-4-20250514` is absent | downstream-owned | Task 4 fixture correction. |
| File search readiness | focused upstream command passes | focused current command passes after prerequisite restore | conditional gate closed | none |
| `PUT /session/visibility` scenario | route is absent upstream | coverage/auth each report the downstream-only route missing | downstream-owned | Task 3 scenario addition. |
| HttpApi effect lifecycle | outer termination after `permission.list` | outer termination after `project.directories` | unresolved | Retain worktrees; isolate after visibility coverage work. |

## Retained Worktrees And Process State

The stale prunable `silent-orchid` entry was removed with ordinary `git worktree prune`; worktree listing now contains only primary plus the retained detached upstream/current-start worktrees. Unresolved signatures remain, so neither A/B worktree was removed. Final process query found no matching Bun or Node test processes. No primary production, test, generated, Comet, plan, or design file was modified; the ignored current-start artifact was not committed.

## Final Recovery Verification

Final primary commit before this report update: `53c5e76d07346b8eb33fc4d399d7e0ce2ac875b8`.

### Deterministic Focused Checks

| Owner | Result |
|---|---|
| Client promise contract | exit 0, 7 pass |
| TUI session sync | exit 0, 2 pass |
| Core `which` | exit 0, 7 pass |
| opencode HttpApi config | exit 0, 6 pass |
| WebGUI visibility sync | exit 0, 14 pass |
| HttpApi coverage | exit 0, pass=216/fail=0/skip=0/missing=0/extra=0 |
| HttpApi auth | exit 0, pass=216/fail=0/skip=0/missing=0/extra=0 |
| HttpApi effect | exit 0, pass=216/fail=0/skip=0/missing=0/extra=0; the unchanged command completed in one process with its original 30 second scenario timeout |
| Session foreground state | exit 0, 2 pass |
| Raw-chunk selection plus provider error classification | exit 0, 20 pass |
| Session Runner state machine | exit 0, 25 pass |
| Session prompt owner file | exit 0, 42 pass/14 skip |

The first final effect invocation exceeded a 10 minute tool wait after completing earlier scenarios. The same unchanged command was then allowed a 30 minute outer wait and completed all 216 scenarios. No scenario timeout, retry, or production behavior changed.

### Package Suites And Typechecks

| Package | Default test result | Typecheck |
|---|---|---|
| client | exit 0, 16 pass | exit 0 |
| tui | exit 1, 190 pass/1 skip/1 fail; only the upstream-known Windows home-separator signature | exit 0 |
| core | exit 1, 1075 pass/7 skip/12 fail/8 errors; all 12 failures are the A/B-recorded Git, MoveSession, RepositoryCache, and Snapshot signatures | exit 0 |
| opencode | exit 1, 3517 pass/58 skip/1 todo/9 fail/1 error | exit 0 |
| sdk-next | exit 1, 2 pass/3 fail; the three failures are the retained upstream `SQLITE_CANTOPEN` signatures and the embedded router/handler owner passes without `EBUSY` | exit 0 |

The nine opencode package failures occur only under the 56 minute aggregate suite. Their owners were isolated without changing timeouts: file HttpApi passed its Task 8 focused gate; SDK passed 18/18; persisted-directory and equivalent-Windows-directory session filters passed; project-copy passed 1/1; prompt passed 42 with 14 skips; `tool.glob` and `tool.skill` each passed 2/2. The remaining mutation-route timeout was traced to the `{ git: true }` fixture's `git commit --allow-empty` before the test body or any HTTP request; it varied across fresh current-start processes. These are aggregate Windows Git/ripgrep resource signatures, not evidence of a handler regression. The strict package-level green or upstream-known-only criterion therefore remains partially unmet even though every downstream owner check is green.

### Conditional Tasks

- Task 7 executed and committed deterministic Bun SQLite statement finalization plus the Protocol/Server MCP boundary correction.
- Task 8 skipped because the current file-search owner already passed.
- Task 9 skipped because isolated upstream/current-start effect scenarios completed every trace phase; previous full-command terminations were aggregate runtime, not blocked finalizers.
- Task 10 skipped because both original RepositoryCache candidates reproduced in the retained upstream and current-start file runs.
- Final package verification exposed stale downstream-only test contracts. With explicit approval, commit `53c5e76d07` prewarms the foreground test instance and removes one AI SDK contract plus three prompt integration tests whose behavior remains covered by provider-error and Runner owner tests. It changes no production behavior.

### Boundary Audit

- No matching Bun, Node, or Git test process remained after verification.
- `git diff --check 253389db631ad45627e133c7318b5e65a06479a8..HEAD` and working-tree `git diff --check` passed.
- Committed and working generated Client diffs are empty.
- The working package workaround scanner found no additions. The committed scanner found only the intentional one-second `callAuthProbe` AbortController boundary in `httpapi-exercise/backend.ts`; it cancels an indefinitely streaming auth probe and waits for the canceled request before disposing the handler. It is not a retry or timeout increase.
- Staged paths are empty. Working status contains only the initial user-owned dirty paths and the uncommitted plan/design documents.
- The retained upstream and current-start worktrees were clean and removed without `--force`. Git deregistered the upstream worktree before Windows reported `Filename too long`; its remaining, already-deregistered directory was removed through the verified `\\?\` long-path target. Both paths were confirmed absent.

### Final Changed Files

```text
docs/superpowers/reports/2026-07-27-upstream-test-baseline.md
packages/client/test/contract-identity.test.ts
packages/client/test/promise.test.ts
packages/core/src/database/sqlite.bun.ts
packages/core/src/util/which.ts
packages/core/test/database-migration.test.ts
packages/core/test/util/which.test.ts
packages/opencode/test/server/httpapi-config.test.ts
packages/opencode/test/server/httpapi-exercise/backend.ts
packages/opencode/test/server/httpapi-exercise/index.ts
packages/opencode/test/server/httpapi-session-foreground-state.test.ts
packages/opencode/test/session/llm.include-raw-chunks.test.ts
packages/opencode/test/session/prompt.test.ts
packages/protocol/src/api.ts
packages/server/src/api.ts
packages/tui/test/cli/cmd/tui/notifications.test.ts
packages/tui/test/cli/cmd/tui/sync.test.tsx
packages/tui/test/cli/tui/use-event.test.tsx
```

## Windows Test Stability Completion

Evidence below was collected on 2026-07-29 from the existing dirty Windows amd64 worktree with vfox Bun `1.3.14` and Node.js `22.23.1`. It supersedes the earlier non-green `packages/opencode` aggregate result for this worktree.

Implementation commits: `4851d911b3`, `86354ad16d`, `5362fe5e81`, `5d42a9e0bb`, `53a062259b`, and `91d27ae340`.

### `plugin.meta` First Failure

- Inherited first failure: `plugin.meta > serializes concurrent metadata updates across processes`; one of 12 child processes exited `1`. The default suite exited `1` with `3526 pass / 58 skip / 1 todo / 1 fail`.
- The original test asserted the exit-code array before stderr, so that failed run exposed only the child code and discarded the already captured child error from the assertion output.
- Direct reproduction from `packages/opencode`: `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun test test/plugin/meta.test.ts --only-failures` exited `0`, with `3 pass / 0 fail` in `8.35s`.
- The focused regression correction replaced the two ordered assertions with one structured `{ code, stderr }` assertion. It preserves all 12 workers, their concurrency, the `20_000ms` test timeout, and every success condition while ensuring any future nonzero child reports its stderr in the first failure.
- Focused verification after that correction used the same direct command and exited `0`, with `3 pass / 0 fail` in `8.60s`.
- The child exit itself did not reproduce in the direct owner, the diagnostic full suite, or either acceptance process. No child error existed to capture in those runs, so no production `Flock`, process, timeout, concurrency, or Windows-specific change was made without a focused RED. The assertion-order diagnosability defect is fixed; the inherited aggregate child exit remains non-reproduced rather than being misclassified as a product root cause.

### Typechecks And Reliability Gate

| Package / run | Exact command | Exit | Result |
|---|---|---:|---|
| core typecheck | `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun typecheck` from `packages/core` | 0 | `tsgo --noEmit` |
| opencode typecheck | `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun typecheck` from `packages/opencode` | 0 | `tsgo --noEmit` |
| diagnostic aggregate | `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test --bail=1` from `packages/opencode` | 0 | `3527 pass / 58 skip / 1 todo / 0 fail`, `1458.03s` |
| acceptance 1 | `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run --cwd=packages/opencode test` from the repository root | 0 | `3527 pass / 58 skip / 1 todo / 0 fail`, `1467.03s` |
| acceptance 2 | `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run --cwd=packages/opencode test` from the repository root | 0 | `3527 pass / 58 skip / 1 todo / 0 fail`, `1471.49s` |

The two acceptance checks ran sequentially as independent processes and invoked the unchanged `packages/opencode` default `test` script without `--bail`. Earlier diagnostic runs used `--bail=1` only to stop at the first failure and are not counted as acceptance evidence. The process audit around those diagnostics and the final post-gate process query found `0` residual test-owned Bun, Node.js, Git, or ripgrep processes.

### Final Audit

- `git diff --check`: exit `0`.
- `git diff --exit-code -- packages/client/src/generated packages/client/src/generated-effect`: exit `0`, empty generated diff.
- The `plugin.meta` addition scan found no retry, sleep, skip, forced exit, timeout, lower concurrency, or Windows-only branch.
- Final read-only review: Critical `0`, Important `0`, Minor `0`.
- Staged paths remain empty. The pre-existing JetBrains plugin metadata and other user-owned dirty paths were not edited by this task.
- Task commits contain only the intended Core and OpenCode code/test paths. The final evidence commit contains this report and the Windows stability plan.
