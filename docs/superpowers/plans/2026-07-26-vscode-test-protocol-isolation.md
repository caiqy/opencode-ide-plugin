# VS Code Test Protocol Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the VS Code 1.74.0 integration-test lane without leaving the user's `vscode://` registry handler pointed at `.vscode-test`, and remove test-only files from the VSIX.

**Architecture:** Route `pnpm test` through one dependency-free Node.js wrapper. The wrapper starts `node_modules/@vscode/test-cli/out/bin.mjs` via `process.execPath`; on Windows it snapshots the complete user-level `vscode` protocol key, uses `taskkill /T /F` for forwarded signals, waits for the direct child to exit, and then restores the original key in cleanup. Packaging excludes both the test configuration and wrapper.

**Tech Stack:** Node.js 20 standard library, `reg.exe`, pnpm scripts, `@vscode/test-cli`, VSCE, PowerShell ZipArchive audit.

## Global Constraints

- Keep the integration-test VS Code version `1.74.0`.
- Do not add runtime or development dependencies.
- Do not change notification runtime TypeScript or the bundled SnoreToast source/binary.
- Keep release scope limited to Windows x64 Stable VS Code; do not add Insiders/VSCodium behavior.
- Do not stage, commit, push, create a PR, or revert unrelated worktree changes.
- Run pnpm commands only from `hosts/vscode-plugin`.
- A failed registry snapshot must prevent tests from starting; a failed restoration must make the test command fail and retain the backup.

---

### Task 1: Isolate the VS Code test protocol handler and refresh the package

**Files:**
- Create: `hosts/vscode-plugin/scripts/run-vscode-tests.mjs`
- Modify: `hosts/vscode-plugin/package.json`
- Modify: `hosts/vscode-plugin/.vscodeignore`
- Generated: `hosts/vscode-plugin/opencode-vscode-win-amd64-26.7.2401.vsix`
- Update evidence: `.superpowers/sdd/windows-protocol-task-3-report.md`
- Update evidence: `.superpowers/sdd/windows-protocol-final-review.md`

**Interfaces:**
- Consumes: the local `node_modules/@vscode/test-cli/out/bin.mjs` CLI and all arguments passed after `pnpm run test --`.
- Produces: the same test exit status when cleanup succeeds; nonzero when snapshot/restore fails; a VSIX with no `.vscode-test*` or `scripts/run-vscode-tests.mjs` entry.

- [ ] **Step 1: Record the existing failing evidence**

Do not rerun the unwrapped test lane. Use the already captured real failure in `windows-protocol-task-3-report.md`: raw `vscode-test` changed
`HKCU\Software\Classes\vscode\shell\open\command` from Stable VS Code `1.130.0` to `.vscode-test\vscode-win32-x64-archive-1.74.0\Code.exe` and left it there.

Run this archive check from `hosts/vscode-plugin`:

```powershell
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead("opencode-vscode-win-amd64-26.7.2401.vsix")
try {
  @($zip.Entries | Where-Object FullName -Match "vscode-test").FullName
} finally {
  $zip.Dispose()
}
```

Expected RED: output contains `extension/.vscode-test.mjs`.

- [ ] **Step 2: Add the test wrapper**

Create `hosts/vscode-plugin/scripts/run-vscode-tests.mjs`:

```js
import { spawn, spawnSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

const registryKey = String.raw`HKCU\Software\Classes\vscode`

try {
  process.exitCode = await main()
} catch (error) {
  console.error(`VS Code test setup failed: ${error}`)
  process.exitCode = 1
}

async function main() {
  const snapshot = process.platform === "win32" ? await snapshotProtocolHandler() : undefined
  try {
    return await runTests()
  } finally {
    if (snapshot) await restoreProtocolHandler(snapshot)
  }
}

async function snapshotProtocolHandler() {
  const existed = registryExists()
  if (!existed) return { existed }

  const directory = await mkdtemp(path.join(tmpdir(), "opencode-vscode-test-"))
  const file = path.join(directory, "vscode.reg")
  try {
    runRegistry(["export", registryKey, file, "/y"])
    return { directory, existed, file }
  } catch (error) {
    await rm(directory, { force: true, recursive: true })
    throw error
  }
}

async function restoreProtocolHandler(snapshot) {
  try {
    if (registryExists()) runRegistry(["delete", registryKey, "/f"])
    if (snapshot.existed) runRegistry(["import", snapshot.file])
  } catch (error) {
    const backup = snapshot.file ? ` Backup retained at ${snapshot.file}.` : ""
    throw new Error(`Could not restore ${registryKey}.${backup} ${error}`)
  }

  if (snapshot.directory) await rm(snapshot.directory, { force: true, recursive: true })
}

function registryExists() {
  const result = spawnSync("reg.exe", ["query", registryKey], { stdio: "ignore" })
  if (result.error) throw result.error
  if (result.status === 0) return true
  if (result.status === 1) return false
  throw new Error(`reg.exe query exited with ${result.status}`)
}

function runRegistry(args) {
  const result = spawnSync("reg.exe", args, { stdio: "ignore" })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`reg.exe ${args[0]} exited with ${result.status}`)
}

function runTests() {
  const cliPath = path.join(
    process.cwd(),
    "node_modules",
    "@vscode",
    "test-cli",
    "out",
    "bin.mjs",
  )

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...process.argv.slice(2)], {
      shell: false,
      stdio: "inherit",
    })
    const signals = new Map([
      ["SIGINT", 130],
      ["SIGTERM", 143],
      ...(process.platform === "win32" ? [["SIGBREAK", 131]] : []),
    ])
    const handlers = [...signals].map(([signal]) => {
      const handler = () => {
        if (process.platform !== "win32") {
          if (!child.killed) child.kill(signal)
          return
        }

        spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { stdio: "inherit" })
      }
      process.once(signal, handler)
      return [signal, handler]
    })

    const removeHandlers = () => {
      handlers.forEach(([name, handler]) => process.removeListener(name, handler))
    }

    child.once("error", (error) => {
      removeHandlers()
      reject(error)
    })
    child.once("exit", (code, signal) => {
      removeHandlers()
      resolve(code ?? signals.get(signal) ?? 1)
    })
  })
}
```

- [ ] **Step 3: Route the package test command through the wrapper**

In `hosts/vscode-plugin/package.json`, replace only the test script:

```json
"test": "node ./scripts/run-vscode-tests.mjs"
```

Keep `pretest`, `.vscode-test.mjs`, and version `1.74.0` unchanged.

- [ ] **Step 4: Exclude test tooling from the VSIX**

Add these exact lines under `# Test files and fixtures` in `hosts/vscode-plugin/.vscodeignore`:

```text
.vscode-test.mjs
scripts/run-vscode-tests.mjs
```

- [ ] **Step 5: Verify registry restoration with the real focused lane**

From `hosts/vscode-plugin`, capture the command, run the wrapped focused suite, and compare:

```powershell
$key = "HKCU:\Software\Classes\vscode\shell\open\command"
$before = (Get-ItemProperty -LiteralPath $key)."(default)"
$beforeFull = (& reg.exe query HKCU\Software\Classes\vscode /s) | ForEach-Object { $_.TrimEnd() }
pnpm run test -- --grep "system notification"
$testExit = $LASTEXITCODE
$after = (Get-ItemProperty -LiteralPath $key)."(default)"
$afterFull = (& reg.exe query HKCU\Software\Classes\vscode /s) | ForEach-Object { $_.TrimEnd() }
$sameFull = [string]::Join("`n", $beforeFull) -ceq [string]::Join("`n", $afterFull)
"before=$before"
"after=$after"
if ($before -ne $after) { throw "vscode protocol handler changed" }
if ($after -match "\.vscode-test") { throw "vscode protocol handler still points at test VS Code" }
if (-not $sameFull) { throw "full vscode registry key changed" }
if ($testExit -ne 0) { exit $testExit }
```

Expected GREEN: focused suite passes, `before` equals `after`, and the full `HKCU\Software\Classes\vscode` query is unchanged.

- [ ] **Step 6: Run static checks for changed test tooling**

From `hosts/vscode-plugin`:

```powershell
node --check scripts/run-vscode-tests.mjs
pnpm run compile
pnpm run lint
```

Expected: all commands exit `0`; existing lint warnings may remain, but no errors are allowed.

- [ ] **Step 7: Repackage and prove test tooling is absent**

From `hosts/vscode-plugin`:

```powershell
pnpm run compile:production
pnpm exec vsce package --allow-missing-repository --out opencode-vscode-win-amd64-26.7.2401.vsix
```

Audit with ZipArchive. Expected:

- no entry matching `.vscode-test`
- no `extension/scripts/run-vscode-tests.mjs`
- `extension/out/ui/systemNotification.js` still contains `-protocol`
- `extension/resources/windows/snoretoast-x64.exe` hash still equals the local resource
- manifest `Metadata/Identity Version` and package version remain `26.7.2401`
- excluded build/test entries remain `0`

Record the new size, SHA-256, and entry count; the previous `07B071C4DDAA8A3B13D16A3CA3917BAEE36CD6A308153CB512A795B4B9524A8D` package becomes obsolete.

- [ ] **Step 8: Install and update evidence**

```powershell
code.cmd --install-extension "opencode-vscode-win-amd64-26.7.2401.vsix" --force
code.cmd --list-extensions --show-versions | rg "^caiqy\.opencode-ui@26\.7\.2401$"
```

Append the registry restoration evidence and refreshed artifact facts to the Task 3 and final-review reports. Do not rerun desktop smoke because runtime JavaScript and native binaries are unchanged; retain the already completed Stable smoke evidence.

- [ ] **Step 9: Inspect scope without committing**

Run `git status --short` and confirm the implementation touched only the wrapper, package script, `.vscodeignore`, generated VSIX, approved design/plan, and local evidence files. Do not stage or commit.
