# VS Code Test Protocol Isolation Design

## Problem

On Windows, launching the VS Code 1.74.0 integration-test installation updates the user-level
`vscode://` protocol handler to point at `.vscode-test`. The test runner leaves that global state
behind, so later notification activation can open a test VS Code window instead of the user's
installed Stable VS Code.

The test configuration is also currently included in the VSIX even though it has no runtime use.

## Goals

- Preserve the VS Code 1.74.0 minimum-version integration-test lane.
- Restore the complete pre-test `HKCU\Software\Classes\vscode` state after every normal test exit.
- Fail visibly if the registry snapshot or restoration cannot be completed safely.
- Keep non-Windows test behavior unchanged.
- Exclude the test configuration and test wrapper from the production VSIX.

## Non-Goals

- Do not change notification runtime code or the bundled SnoreToast binary.
- Do not add runtime or development dependencies.
- Do not add Insiders or VSCodium support; this release remains scoped to Windows x64 Stable VS Code.

## Design

Add a Node.js wrapper under `hosts/vscode-plugin/scripts/` and route `pnpm test` through it.
The wrapper uses only Node.js APIs and the Windows `reg.exe` utility.

On every platform it starts the local `node_modules/@vscode/test-cli/out/bin.mjs` through
`process.execPath`, forwards all received arguments, and returns the same exit status.

On Windows it performs this sequence:

1. Query whether `HKCU\Software\Classes\vscode` exists.
2. If it exists, export the complete key to a temporary `.reg` file. Abort before tests if export
   fails, because restoration would not be trustworthy.
3. Start the local test CLI with `process.execPath` and forward all arguments and terminal I/O.
   On Windows, use a hidden detached process group and pipe its output back to the wrapper so
   console interruption reaches the wrapper before the CLI. Non-Windows keeps inherited stdio.
4. In cleanup, import the snapshot when the key originally existed. If it did not exist, delete the
    key created by the test VS Code instance.
5. Preserve the test exit status only when cleanup succeeds. A cleanup failure overrides success,
   reports the retained backup path, and exits nonzero.

The wrapper handles normal completion and forwarded interruption signals through the same cleanup
path. On Windows the detached CLI does not receive the wrapper console's interruption first; the
wrapper runs `taskkill.exe /PID <child.pid> /T /F` synchronously, then waits for the direct child to
exit before cleanup is allowed to restore the registry. Temporary backup data is removed only after
successful restoration.

Add `.vscode-test.mjs` and the wrapper path to `.vscodeignore` so neither enters the VSIX.

## Verification

1. Record the current protocol command.
2. Run a focused integration suite through `pnpm run test -- --grep "system notification"`.
3. Assert the protocol command after the run exactly matches the value recorded before it, does
   not point at `.vscode-test`, and that a normalized full `reg.exe query HKCU\Software\Classes\vscode /s`
   snapshot is unchanged before and after the run.
4. Keep the non-Windows branch as a direct command pass-through; existing non-Windows `pnpm run test`
   lanes exercise it without a synthetic platform seam.
5. Repackage the fixed VSIX and assert it contains no `.vscode-test*` entry or test wrapper.
6. Recompute size, SHA-256, entry count, versions, native hash, and `-protocol` presence; reinstall
   the package and verify `caiqy.opencode-ui@26.7.2401`.

No repeat desktop smoke is required because production JavaScript and native binaries are unchanged;
the final artifact audit must prove that only packaging metadata and test tooling changed.
