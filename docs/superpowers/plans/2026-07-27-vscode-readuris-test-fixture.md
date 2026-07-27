# VS Code readUris Test Fixture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the invalid VS Code filesystem stubs in the `readUris` integration test with the existing real workspace fixture so the full test command has no failures.

**Architecture:** Keep production code and the approved VSIX unchanged. The single affected test reads `test-fixtures/.gitkeep` through the real VS Code filesystem API, then verifies the successful webview result and the absence of direct bridge insertion.

**Tech Stack:** TypeScript, VS Code Extension Test Host `1.74.0`, Mocha TDD UI, Sinon, Node.js assertions, pnpm.

## Global Constraints

- Modify only `hosts/vscode-plugin/src/test/suite/webviewController.test.ts` for implementation.
- Do not change `WebviewController`, notification runtime, dependencies, lockfiles, or VSIX contents.
- Keep the VS Code integration-test version at `1.74.0`.
- Run all pnpm commands from `hosts/vscode-plugin`.
- Preserve the complete `HKCU\Software\Classes\vscode` registry state through the existing test wrapper.
- Do not stage or commit changes unless the user explicitly requests it.

---

### Task 1: Replace brittle filesystem stubs with the real fixture

**Files:**
- Modify: `hosts/vscode-plugin/src/test/suite/webviewController.test.ts:73-84`
- Use unchanged fixture: `hosts/vscode-plugin/test-fixtures/.gitkeep`
- Verify unchanged artifact: `hosts/vscode-plugin/opencode-vscode-win-amd64-26.7.2401.vsix`

**Interfaces:**
- Consumes: `.vscode-test.mjs` workspace folder `./test-fixtures`, `vscode.workspace.fs`, and the existing `loadController()` test helper.
- Produces: one passing `readUris` routing test with no production API changes.

- [ ] **Step 1: Reproduce the existing RED**

Run from `hosts/vscode-plugin`:

```powershell
node scripts/run-vscode-tests.mjs --grep "readUris 只把解析结果返回 webview"
```

Expected: exit `1`, `0 passing`, `1 failing`, with:

```text
TypeError: Descriptor for property stat is non-configurable and non-writable
```

- [ ] **Step 2: Replace the invalid stubs with the tracked workspace fixture**

Replace the existing test body with:

```ts
test("readUris 只把解析结果返回 webview，不通过 bridge 直接插入", async () => {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
  assert.ok(workspaceFolder)
  const uri = vscode.Uri.joinPath(workspaceFolder.uri, ".gitkeep")
  const { controller, webview, bridgeSend, receiveMessage } = await loadController()

  await receiveMessage({ type: "readUris", uris: [uri.toString()] })

  const message = (webview.postMessage as unknown as sinon.SinonStub)
    .getCalls()
    .map((call) => call.args[0])
    .find((value) => value.type === "readUrisResult")
  assert.ok(message)
  assert.deepStrictEqual(message.results, [
    {
      uri: uri.toString(),
      ok: true,
      webviewUri: uri.toString(),
      data: "",
    },
  ])
  assert.deepStrictEqual(message.filePaths, [uri.fsPath])
  assert.deepStrictEqual(message.directoryPaths, [])
  assert.ok(!bridgeSend.calledWithMatch("session-save-image", sinon.match({ type: "insertPaths" })))

  controller.dispose()
})
```

This removes both `sinon.stub(vscode.workspace.fs, ...)` calls and exercises the real successful filesystem path.

- [ ] **Step 3: Run the focused GREEN check**

Run:

```powershell
node scripts/run-vscode-tests.mjs --grep "readUris 只把解析结果返回 webview"
```

Expected: exit `0`, `1 passing`, `0 failing`.

- [ ] **Step 4: Run the complete package test command with registry comparison**

Run:

```powershell
$before = (& reg.exe query HKCU\Software\Classes\vscode /s) | ForEach-Object { $_.TrimEnd() }
pnpm run test
$testExit = $LASTEXITCODE
$after = (& reg.exe query HKCU\Software\Classes\vscode /s) | ForEach-Object { $_.TrimEnd() }
$same = [string]::Join("`n", $before) -ceq [string]::Join("`n", $after)
"registry_equal=$same"
if (-not $same) { throw "vscode protocol handler changed" }
if ($testExit -ne 0) { exit $testExit }
```

Expected: compile exits `0`, lint reports `0 errors` with existing warnings allowed, test exit is `0`, the former `readUris` failure is absent, and `registry_equal=True`.

- [ ] **Step 5: Check process cleanup and prove the VSIX is unchanged**

Run:

```powershell
$processes = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -in @("node.exe", "Code.exe", "cmd.exe") -and (
    $_.ExecutablePath -like "*hosts\vscode-plugin\.vscode-test\*" -or
    $_.CommandLine -like "*scripts\run-vscode-tests.mjs*" -or
    $_.CommandLine -like "*@vscode\test-cli*"
  )
})
"remaining_test_processes=$($processes.Count)"
$vsix = Get-Item -LiteralPath "opencode-vscode-win-amd64-26.7.2401.vsix"
"size=$($vsix.Length)"
"sha256=$((Get-FileHash -LiteralPath $vsix.FullName -Algorithm SHA256).Hash)"
```

Expected:

```text
remaining_test_processes=0
size=62162053
sha256=175429A2134A0F97DDDB3F34321AFDFA60A2A99C19806E969540112A380D24A4
```

- [ ] **Step 6: Inspect the scoped diff without committing**

Run from the repository root:

```powershell
git diff --check -- hosts/vscode-plugin/src/test/suite/webviewController.test.ts
git status --short -- hosts/vscode-plugin/src/test/suite/webviewController.test.ts hosts/vscode-plugin/opencode-vscode-win-amd64-26.7.2401.vsix
```

Expected: `git diff --check` exits `0`; only `webviewController.test.ts` is modified for this implementation, and the VSIX is unchanged.
