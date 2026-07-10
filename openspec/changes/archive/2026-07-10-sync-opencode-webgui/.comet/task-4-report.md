# Task 4 Report

Status: DONE_WITH_CONCERNS

## Scope

Fixed only the Task 3 audited broken path: `Session.Event.DiffStatus` / `session.diff.status`.

Changed files:

- `packages/opencode/src/session/session.ts`
- `openspec/changes/sync-opencode-webgui/.comet/task-4-report.md`

No WebGUI consumer code was changed. No generated files were edited or regenerated because the server-to-WebGUI SSE path uses the runtime event definition published through `EventV2Bridge`, and the existing WebGUI consumer already handles the literal `session.diff.status` event.

## Implementation

Added the minimal runtime event contract near the session event owner:

- `DiffStatus` schema/type: `"scheduled" | "running" | "idle" | "deleted" | "failed"`
- `DiffStatusEvent` definition with type `session.diff.status`
- payload schema: `{ sessionID, status, message }`
- exported it as `Session.Event.DiffStatus`

## RED

Command, from `packages/opencode`:

```sh
bun typecheck
```

Relevant failing output before the fix:

```text
src/session/summary-scheduler.ts(76,23): error TS2694: Namespace '.../src/session/session' has no exported member 'DiffStatus'.
src/session/summary-scheduler.ts(79,43): error TS2339: Property 'DiffStatus' does not exist on type ...
test/session/summary-scheduler.test.ts(...): error TS2339: Property 'DiffStatus' does not exist on type ...
test/session/summary.test.ts(...): error TS2339: Property 'DiffStatus' does not exist on type ...
```

Full RED output was saved by the tool at:

```text
C:\Users\caiqy\.local\share\opencode\tool-output\tool_f4181ab73001I7UNV0abO4sBMr
```

## GREEN

Command, from `packages/opencode`:

```sh
bun typecheck
```

Result: failed due to existing unrelated typecheck drift, but the target `DiffStatus` missing-member errors are gone. A focused search of the GREEN output returned no `DiffStatus` matches:

```sh
rg -n "DiffStatus" "C:\Users\caiqy\.local\share\opencode\tool-output\tool_f418b2d17001iDAtDR48zD3OQ9"
```

Output:

```text
<empty>
```

Remaining typecheck failures include unrelated source/test drift such as missing `@opencode-ai/core/util/log`, missing `src/bus` test imports, stale `defaultLayer` references, stale generated-image/message-v2 types, and HTTP API handler typing drift. Per brief, these were not fixed.

Focused test command, from `packages/opencode`:

```sh
bun test test/session/summary-scheduler.test.ts --timeout 30000
```

Result: failed before running assertions because the existing test imports a removed/missing module:

```text
Cannot find module '../../src/bus' from '.../packages/opencode/test/session/summary-scheduler.test.ts'
0 pass
1 fail
1 error
```

Direct event schema smoke check, from `packages/opencode`:

```sh
bun -e "import { Schema } from 'effect'; import { Session } from './src/session/session'; const data = Schema.decodeUnknownSync(Session.Event.DiffStatus.data)({ sessionID: 'ses_test', status: 'idle', message: 'ok' }); if (Session.Event.DiffStatus.type !== 'session.diff.status') throw new Error(Session.Event.DiffStatus.type); if (data.status !== 'idle' || data.message !== 'ok') throw new Error('bad payload'); console.log(Session.Event.DiffStatus.type, data.status, data.message)"
```

Output:

```text
session.diff.status idle ok
```

Conflict checks, from repo root:

```sh
rg --hidden -n "^(<<<<<<<|=======|>>>>>>>)" --glob "!.git/**" --glob "!node_modules/**"
git ls-files -u
```

Output:

```text
<empty>
<empty>
```

## Remaining Risks

- Full `bun typecheck` is still red because of unrelated branch drift outside Task 4 scope.
- The existing summary scheduler focused test cannot run until unrelated `../../src/bus` test drift is fixed.
- This task did not add SDK/generated event surface for `session.diff.status`; current requirement only needs the runtime SSE publish path consumed by WebGUI.

## Concerns

- The working tree is heavily dirty from pre-existing sync work; this task intentionally touched only the allowed Task 4 files.
- Because package-level typecheck remains red for unrelated reasons, the strongest GREEN evidence for this task is targeted disappearance of the `DiffStatus` type errors plus the direct runtime/schema smoke check.
