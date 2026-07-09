# Task 5 Verification Report

Status: `DONE_WITH_CONCERNS`

## Scope

- Change: `sync-opencode-webgui`
- Goal: run the broadest practical verification across `packages/opencode`, WebGUI, VSCode host, and JetBrains host; record failures, substitutes, fixes, and remaining risk.
- Constraints followed: no commit, no task checkbox changes, no root test run.

## Commands

### Script Discovery

- `bun pm pkg get scripts` from repo root: passed; root `test` is guarded with `do not run tests from root`.
- Package script inspection covered `packages/opencode/package.json`, `packages/opencode/webgui/package.json`, `hosts/vscode-plugin/package.json`, and `hosts/jetbrains-plugin/build.gradle.kts`.

### opencode Package

- `bun typecheck` from `packages/opencode`: failed.
  - Main visible failures: stale/broad test and support drift, including `test/permission/next.test.ts` missing permission symbols, `test/provider/error.test.ts` stale `../../src/provider/schema`, `test/server/httpapi-control-plane.test.ts` layer type mismatch, and `test/server/httpapi-exercise/index.ts` old DSL calls.
- `bun test --timeout 30000 --only-failures` from `packages/opencode`: failed.
  - Main visible failure: `workspace waitForSync > rejects with the abort reason when aborted`, `Service not found: @opencode/FileSystem`.
- `bun run build` from `packages/opencode`: failed after embedded app build completed.
  - Current blocker: external Bun packaging step failed at `building opencode-linux-arm64` with `Failed to extract executable for 'bun-linux-aarch64-v1.3.14'. The download may be incomplete.`
- `bun run test:httpapi` from `packages/opencode`: failed.
  - Root failure: `test/server/httpapi-exercise/index.ts:110`, `TypeError: ... .mutating is not a function`.
- `bun test test/config/skill-overlay.test.ts --timeout 30000` from `packages/opencode`: failed.
  - First overlay export test passed; later test failed on legacy static `Config.get is not a function`.
- Focused import check from `packages/opencode`: passed.
  - `bun --conditions=browser -e "import { Config } from './src/config/config'; if (typeof Config.globalConfigFile !== 'function' || typeof Config.setSkillPermissionOverlay !== 'function') process.exit(1)"`
- Focused instance handler import check from `packages/opencode`: passed.
  - `bun --conditions=browser -e "import { instanceHandlers } from './src/server/routes/instance/httpapi/handlers/instance.ts'; if (!instanceHandlers) process.exit(1)"`

### WebGUI

- `bun run build` from `packages/opencode/webgui`: passed after SDK SSE type fix.
  - Remaining warning: Vite chunk-size warning only.
- `bun run test:run` from `packages/opencode/webgui`: passed on rerun.
- First WebGUI full test run: failed once on timeout in `src/components/CompactHeader/index.test.tsx`.
- Focused rerun: `bun vitest run src/components/CompactHeader/index.test.tsx -t "switches to restored activeTab when currentSession is null"` passed; classified as suite-order/timing flake.

### VSCode Host

- `pnpm run compile` from `hosts/vscode-plugin`: passed.
- `pnpm run package:pre-release` from `hosts/vscode-plugin`: passed.
  - Output: `opencode-ui-26.7.601.vsix`.
  - Warning: bundled `extension/resources/bin/windows/amd64/opencode.exe` is 139.22 MB.

### JetBrains Host

- `.\gradlew.bat check --no-daemon --console=plain` from `hosts/jetbrains-plugin`: failed due environment JVM.
  - Error: dependency requires JVM runtime version 17 or newer; current build used Java 8.

### SDK / Generated Artifacts

- `bun .\packages\sdk\js\script\build.ts` from repo root: passed after generator workaround was corrected.
- Earlier attempts failed while refining the SSE type patch; final run completed.

## Pass

- WebGUI build.
- WebGUI test suite on rerun.
- WebGUI focused restored-tab test.
- VSCode compile.
- VSCode package pre-release.
- Legacy JavaScript SDK generator after SSE type patch.
- Focused `Config` export import check.
- Focused instance HTTP API handler import check.

## Fail

- `packages/opencode` typecheck: broad test/support drift remains.
- `packages/opencode` tests: `@opencode/FileSystem` service missing in a workspace test.
- `packages/opencode` full release-matrix build: external Bun Linux aarch64 executable extraction failed during packaging.
- `packages/opencode` HTTP API exercise: stale scenario DSL `.mutating()` call.
- `packages/opencode` config overlay focused test: stale static `Config.get()` test expectation.
- JetBrains Gradle check: local Java 8 cannot satisfy JVM 17+ requirement.

## Skipped / Substituted

- Root `bun test` skipped because the repo script intentionally exits with `do not run tests from root`.
- JetBrains source/package correctness could not be completed in this environment; nearest command was run and failed before source checks because of JVM version.
- Manual live WebGUI session/provider/permission/question/IDE bridge exercise was substituted with WebGUI unit/build coverage plus package/host build checks because no live server/browser harness was requested in Task 5 and package verification already exposed blocking red surfaces.

## Fixed Failures

- Fixed WebGUI TypeScript build failure from generated SDK SSE type using endpoint `TError` incorrectly. Updated `packages/sdk/js/script/build.ts`, regenerated `packages/sdk/js/src/v2/gen/client/types.gen.ts`, and verified WebGUI build passed.
- Fixed production config API export/import drift used by instance HTTP API handlers. Updated `packages/opencode/src/config/config.ts` with `globalConfigFile`, skill permission overlay accessors, `reload`, and `patchProjectField`; focused import checks passed.
- Fixed production build/import drift in `packages/opencode/src/session/summary-scheduler.ts` by replacing stale `Session.defaultLayer` usage with the current `SessionSummary.node` layer path. The later opencode build failed only at external Bun extraction.
- After Task 5, fixed production stale log imports by adding a local `packages/opencode/src/util/log.ts` compatibility shim and updating `packages/opencode/src/provider/models.ts` plus `test/server/httpapi-session-foreground-state.test.ts`; current-platform `bun run --cwd packages/opencode build --single --skip-install` passed from repo root and smoke-tested version `1.17.16`.
- Did not patch the WebGUI timeout because the same test passed in isolation and the full WebGUI suite passed on rerun.
- Did not add legacy static `Config.get()` compatibility because the failing test is broader stale API drift, not required for the production handler fix.

## Remaining Risk

- `packages/opencode` is still not globally green: typecheck, tests, HTTP API exercise, and full release-matrix build remain red or unproven due broad stale test/support drift and external Bun target artifact extraction.
- Current-platform opencode build is green via `bun run --cwd packages/opencode build --single --skip-install`; full release packaging remains unproven until Bun can extract `bun-linux-aarch64-v1.3.14`.
- JetBrains verification is environment-blocked until Java 17+ is used.
- WebGUI tests passed on rerun, but one CompactHeader test timed out once; treat as residual flake risk.
- Static config overlay tests still contain stale `Config.get()` expectations.

## Recommendation

Allow entry into Comet verify only as `DONE_WITH_CONCERNS`, not as clean `DONE`. The WebGUI and VSCode fork-specific surfaces have useful green evidence after small fixes, but opencode and JetBrains still have explicit red/environment-blocked verification.
