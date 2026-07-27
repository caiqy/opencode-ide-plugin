# Windows Protocol Notification Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Windows notification body clicks open the originating VS Code window and session both while the popup is visible and later from Action Center, without relying on SnoreToast COM or named pipes.

**Architecture:** Add a `-protocol` option to the bundled SnoreToast and serialize it as the Toast root `launch` value with `activationType="protocol"`. On Windows, the extension invokes SnoreToast directly with the relay URI; macOS and Linux keep their current adapters. The existing `-pid` path remains for immediate `AllowSetForegroundWindow(pid)`, while delayed activation is the Windows user-initiated protocol launch.

**Tech Stack:** TypeScript, VS Code Extension API, Node.js `child_process.execFile`, C++17/WRL, Windows Toast API, CMake/CTest, Mocha.

## Global Constraints

- Do not add runtime dependencies.
- Keep `caiqy.opencode-ui`, `OpenCodeUI\\OpenCodeUI.lnk`, and version `26.7.2401`.
- Do not use `ASFW_ANY`, HWND enumeration, window-title matching, PowerShell in production, or other window heuristics.
- Do not edit generated SDK files.
- Do not stage, commit, push, create a PR, or revert unrelated worktree changes.
- Run TypeScript checks from `hosts/vscode-plugin`; run native checks from `hosts/vscode-plugin/native/snoretoast` or its `build` directory.

---

### Task 1: Add SnoreToast protocol activation

**Files:**
- Modify: `hosts/vscode-plugin/native/snoretoast/src/foregroundprocesstest.cpp`
- Modify: `hosts/vscode-plugin/native/snoretoast/src/snoretoasts.h`
- Modify: `hosts/vscode-plugin/native/snoretoast/src/snoretoasts.cpp`
- Modify: `hosts/vscode-plugin/native/snoretoast/src/main.cpp`
- Generated: `hosts/vscode-plugin/resources/windows/snoretoast-x64.exe`

**Interfaces:**
- Consumes: existing `SnoreToasts::formatAction(...)`, `-appID`, and `-pid` behavior.
- Produces: CLI option `-protocol <uri>`, `SnoreToasts::setProtocol(...)`, `activationArguments()`, and `activationType()`.

- [ ] **Step 1: Write the failing native test**

Add these assertions inside the existing initialized `SnoreToasts` block in `foregroundprocesstest.cpp`:

```cpp
if (!toast.activationType().empty()) {
    return fail("expected default activation type to stay implicit");
}

const std::wstring protocol =
        L"vscode://caiqy.opencode-ui/open-session?bridgeSessionID=bridge&sessionID=session";
toast.setProtocol(protocol);
if (toast.activationArguments() != protocol) {
    return fail("expected protocol URI to replace callback activation arguments");
}
if (toast.activationType() != L"protocol") {
    return fail("expected protocol activation type");
}
```

- [ ] **Step 2: Run RED verification**

Run from `hosts/vscode-plugin/native/snoretoast`:

```powershell
.\build-x64.bat
```

Expected: build fails because `setProtocol`, `activationArguments`, and `activationType` do not exist. The resource binary must not be copied on this failed build.

- [ ] **Step 3: Implement the minimum protocol state and XML attributes**

Add the public methods to `snoretoasts.h`:

```cpp
void setProtocol(const std::wstring &protocol);
std::wstring activationArguments() const;
std::wstring activationType() const;
```

Store one `std::wstring m_protocol` in `SnoreToastsPrivate`. Implement the methods so the existing callback payload remains the default:

```cpp
void SnoreToasts::setProtocol(const std::wstring &protocol)
{
    d->m_protocol = protocol;
}

std::wstring SnoreToasts::activationArguments() const
{
    if (!d->m_protocol.empty()) return d->m_protocol;
    return formatAction(SnoreToastActions::Actions::Clicked);
}

std::wstring SnoreToasts::activationType() const
{
    return d->m_protocol.empty() ? L"" : L"protocol";
}
```

Replace the hard-coded root `launch` value in `displayToast(...)` with `activationArguments()`. Add `activationType` only when non-empty:

```cpp
ST_RETURN_ON_ERROR(addAttribute(L"launch", rootAttributes.Get(), activationArguments()));
const auto type = activationType();
if (!type.empty()) {
    ST_RETURN_ON_ERROR(addAttribute(L"activationType", rootAttributes.Get(), type));
}
```

- [ ] **Step 4: Parse `-protocol` in the CLI**

In `main.cpp`, add `std::wstring protocol`, document `[-protocol] <URI>` in `help(...)`, parse it with `nextArg(...)`, and pass it to the Toast before `displayToast(...)`:

```cpp
} else if (arg == L"-protocol") {
    protocol = nextArg(it,
                       L"Missing argument to -protocol.\n"
                       L"Supply argument as -protocol \"vscode://authority/path\"");
```

```cpp
app.setProtocol(protocol);
```

- [ ] **Step 5: Run GREEN native verification and refresh the resource**

Run from `hosts/vscode-plugin/native/snoretoast`:

```powershell
.\build-x64.bat
```

Expected: build succeeds, CTest reports `1/1` passed, `snoretoast-x64.exe -v` reports `0.7.0`, and the resource binary is replaced.

Verify hashes from `hosts/vscode-plugin/native/snoretoast/build`:

```powershell
Get-FileHash -Algorithm SHA256 "bin\snoretoast.exe", "..\..\..\resources\windows\snoretoast-x64.exe"
```

Expected: both SHA-256 values are identical.

---

### Task 2: Route Windows notifications directly through protocol activation

**Files:**
- Modify: `hosts/vscode-plugin/src/test/suite/systemNotification.test.ts`
- Modify: `hosts/vscode-plugin/src/ui/systemNotification.ts`

**Interfaces:**
- Consumes: `createSystemNotificationUri(...)`, `vscode.env.asExternalUri(...)`, and SnoreToast `-protocol` from Task 1.
- Produces: Windows command arguments containing the exact originating-window relay URI; macOS/Linux notifier behavior remains unchanged.

- [ ] **Step 1: Replace the Windows callback test with a failing direct-command test**

Capture both `runCommand` calls. Complete only `-install`, and assert the second command is the Toast invocation:

```typescript
runCommand: (command, args, callback) => {
  commands.push({ command, args })
  if (args[0] === "-install") callback(null, "")
},
loadNotifier: async () => {
  throw new Error("node-notifier should not load on Windows")
},
```

Assert the Toast command includes the relay as one argument and does not delete the shortcut:

```typescript
assert.deepStrictEqual(commands[1], {
  command: path.join(extensionUri.fsPath, "resources", "windows", "snoretoast-x64.exe"),
  args: [
    "-appID",
    "caiqy.opencode-ui",
    "-pid",
    process.ppid.toString(),
    "-t",
    "Agent finished",
    "-m",
    "Finished working.",
    "-p",
    path.join(extensionUri.fsPath, "resources", "icon.png"),
    "-silent",
    "-protocol",
    relayUri.toString(),
  ],
})
```

Delete the stale-shortcut-removal test. Move notifier callback/open failure tests to `platform: "darwin"`, where callbacks are still used.

- [ ] **Step 2: Run RED VS Code verification**

Run from `hosts/vscode-plugin`:

```powershell
pnpm run compile
pnpm exec vscode-test --grep "system notification"
```

Expected: the system notification suite fails because Windows still removes the shortcut, loads `node-notifier`, and never emits `-protocol`.

- [ ] **Step 3: Implement the direct Windows command path**

In `systemNotification.ts`:

- Remove `rm`, `removeWindowsShortcut`, and Windows-only `node-notifier` options.
- Keep the awaited `-install` command, but do not delete an existing shortcut.
- Resolve the Windows relay with `asExternalUri`.
- Invoke SnoreToast a second time with the exact argument list asserted above, then return before loading `node-notifier`.
- In the asynchronous send callback, ignore SnoreToast action exit codes `1` through `5`; log spawn failures and all other errors.

Use property narrowing without `any`:

```typescript
const code = error && "code" in error ? error.code : undefined
if (error && !(typeof code === "number" && code >= 1 && code <= 5)) {
  log(`system notification failed: ${error}`)
}
```

Keep Linux `notify-send` and macOS `node-notifier` unchanged.

- [ ] **Step 4: Run GREEN focused verification**

Run from `hosts/vscode-plugin`:

```powershell
pnpm run compile
pnpm exec vscode-test --grep "system notification"
```

Expected: all system notification tests pass, Windows never loads `node-notifier`, and both generated session URIs appear as their notification's `-protocol` value.

- [ ] **Step 5: Run impacted static checks**

Run from `hosts/vscode-plugin`:

```powershell
pnpm run lint
```

Expected: exit `0` with no new errors. Existing warning volume may remain.

---

### Task 3: Package, install, and verify both Windows click timings

**Files:**
- Generated: `hosts/vscode-plugin/opencode-vscode-win-amd64-26.7.2401.vsix`
- Update after evidence exists: `.superpowers/sdd/question-notifications-task-3-report.md`
- Update after evidence exists: `.superpowers/sdd/question-notifications-final-review.md`

**Interfaces:**
- Consumes: refreshed native binary and compiled extension from Tasks 1-2.
- Produces: installed VSIX plus user-observed immediate and delayed activation evidence.

- [ ] **Step 1: Run full impacted verification**

From `hosts/vscode-plugin`, run:

```powershell
pnpm run compile
pnpm run lint
pnpm test
```

Expected: compile/lint exit `0`; tests add no failures beyond the documented existing `readUris` descriptor baseline.

From `hosts/vscode-plugin/native/snoretoast/build`, run:

```powershell
& "C:\Program Files (x86)\Microsoft Visual Studio\2017\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\ctest.exe" -C Release --output-on-failure
```

Expected: `1/1` passed.

- [ ] **Step 2: Repackage the fixed VSIX**

From `hosts/vscode-plugin`, run:

```powershell
pnpm run compile:production
pnpm exec vsce package --allow-missing-repository --out opencode-vscode-win-amd64-26.7.2401.vsix
```

Expected: package succeeds with version `26.7.2401`.

- [ ] **Step 3: Audit and install the candidate**

Record size and SHA-256, verify the archive contains the refreshed `resources/windows/snoretoast-x64.exe`, and verify `out/ui/systemNotification.js` contains `-protocol`. Install with:

```powershell
code.cmd --install-extension "opencode-vscode-win-amd64-26.7.2401.vsix" --force
code.cmd --list-extensions --show-versions | rg "^caiqy\.opencode-ui@26\.7\.2401$"
```

Expected: installation succeeds and the exact version is listed.

- [ ] **Step 4: Run real desktop smoke**

Using a real `question.asked` notification with two VS Code windows:

1. Hide the originating window behind another application and click the popup immediately.
2. Confirm the exact originating window comes forward, OpenCode opens, and the source session/question is selected.
3. Generate a second notification, let the popup disappear, then click it from Action Center.
4. Confirm the same exact window/session behavior and no blank VS Code window.
5. Repeat delayed activation once with the originating window minimized.

Expected: all observations pass. Browser automation or synthetic callbacks do not substitute for these checks.

- [ ] **Step 5: Clean diagnostics and update evidence**

Remove the temporary Start Menu shortcut `OpenCodeUI\\SnoreToastSelfDiagnostic.lnk` created during root-cause testing. Update both local SDD reports with the new native/VSIX hashes, protocol root-cause evidence, automatic results, and user smoke results. Keep release status blocked if any smoke observation fails.
