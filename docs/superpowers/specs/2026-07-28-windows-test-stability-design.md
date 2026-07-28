# Windows opencode Test Stability Design

Date: 2026-07-28
Status: Approved in conversation

## Problem

The Windows `packages/opencode` default suite completed with 3517 pass, 58 skip, 1 todo, 9 fail, and 1 accompanying unhandled error. The affected owners pass in isolation or fail before the test body in Git fixture setup, so the evidence points to suite-load instability rather than a confirmed product regression.

The failures form two independent groups:

1. File search: file HttpApi, SDK routing, prompt glob, `tool.glob`, and `tool.skill` return before ripgrep or the search index is ready.
2. Git/session: persisted-directory session handling, equivalent Windows directory spelling, non-LLM mutations, and project-copy setup time out around Git fixture or worktree child processes.

## Goal

Make the unchanged `packages/opencode` default test command deterministic on Windows while preserving every existing behavior assertion and timeout.

## Non-Goals

- Do not change product behavior without a focused failing owner test.
- Do not add retries, sleeps, skips, forced exits, cleanup retries, or larger test timeouts.
- Do not delete additional tests.
- Do not add a Windows-only production shim.
- Do not treat a lower Bun concurrency setting as the fix until it identifies a real finite-resource boundary.

## Approach

### 1. Establish The Boundary

Use the current archived recovery HEAD as the baseline. Run the nine affected owners in a fresh process and capture phase-level evidence for process spawn, readiness publication, request execution, and scope cleanup.

Run one diagnostic suite with Bun's native file-concurrency control. This only tests the resource-contention hypothesis; it is not acceptance evidence and must not replace the default command.

### 2. File Search Group

Trace the existing index and ripgrep readiness path. The owner must publish an observable readiness condition, and callers or tests must wait for that condition rather than elapsed time. Keep child-process ownership scoped and await its real exit before returning or disposing the fixture.

Prefer one shared lifecycle correction if all five signatures cross the same boundary. Otherwise fix only the smallest confirmed owner.

### 3. Git And Session Group

Trace fixture Git initialization and worktree commands through AppProcess/CrossSpawn. Distinguish slow command execution from a process whose exit, streams, or scope never complete. Await the actual close boundary before fixture disposal. Do not force-kill a command that should complete normally.

### 4. Change Boundaries

Keep file-search and Git lifecycle fixes in separate commits. Tests remain at their owning boundary. No unrelated refactor or generated output is included.

## Verification

1. Reproduce each confirmed owner failure before its fix.
2. Run the affected owner files after each fix with unchanged timeout settings.
3. Run `vfox exec bun@1.3.14 nodejs@22.23.1 -- bun run test` from `packages/opencode` in two clean, independent processes. Both must exit 0; repeated runs are a reliability gate, not retries of a failed candidate.
4. Run `bun typecheck` from every package whose runtime dependency changed.
5. Confirm no residual Bun, Node, Git, or ripgrep test process and no test-owned temporary worktree.
6. Run generated-diff, whitespace, staged-path, and prohibited-workaround checks.
7. Obtain a final review with no Critical or Important findings before integration or release.

## Completion

The task is complete only when the default opencode suite exits 0 twice without changing its command or timeout behavior. Focused passes alone are insufficient.
