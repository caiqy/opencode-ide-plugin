# VS Code readUris Test Fixture Design

## Problem

`WebviewController Test Suite > readUris 只把解析结果返回 webview，不通过 bridge 直接插入`
fails before production code runs because Sinon cannot replace
`vscode.workspace.fs.stat`: the VS Code API property is non-configurable and non-writable.

## Scope

- Fix only the failing integration test.
- Keep `WebviewController`, notification runtime, dependencies, and the approved VSIX unchanged.
- Preserve the test's purpose: a successful `readUris` request returns data to the webview and does
  not directly insert paths through the bridge.

## Design

Use the existing tracked `test-fixtures/.gitkeep` file instead of stubbing VS Code filesystem APIs.
The test obtains the current workspace folder, constructs the fixture URI with
`vscode.Uri.joinPath`, and sends that URI through the existing webview message handler.

Assert that:

- `postMessage` receives a matching successful `readUrisResult` for the fixture URI;
- the returned file path is classified as a file;
- `bridgeServer.send` does not receive an `insertPaths` message.

No production injection point or new fixture file is needed.

## Verification

1. Retain the captured RED: the current focused test fails at the Sinon `stat` stub with the exact
   non-configurable/non-writable descriptor error.
2. Run the focused `readUris` test and require one passing test with no failure.
3. Run `pnpm run test` from `hosts/vscode-plugin` and require the former sole failure to disappear.
4. Confirm compile and lint have no errors, the Stable `vscode://` registry handler is restored,
   and no `.vscode-test` processes remain.
5. Recheck the existing VSIX hash; it must remain
   `175429A2134A0F97DDDB3F34321AFDFA60A2A99C19806E969540112A380D24A4` because the modified test is
   excluded.

## Non-Goals

- Do not add filesystem dependency injection to production code.
- Do not expand `readUris` behavior or notification platform support.
- Do not address existing lint warnings in this change.
