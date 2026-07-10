# VSCode Backend Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent an upgraded VSCode extension from starting a backend extracted by an older plugin version.

**Architecture:** Keep the existing stable extraction and in-process Promise cache, but scope the stable directory by the extension version. Same-version extraction can retain the cheap size check; cross-version reuse becomes impossible by path construction.

**Tech Stack:** TypeScript, Node `fs/path/os`, Mocha VSCode tests, existing VSIX build scripts.

## Global Constraints

- Use `%TEMP%/opencode-bin/<plugin-version>/opencode.exe` on Windows and the equivalent path on other platforms.
- A copy failure may use the current version's existing extracted file or bundled file, never an older version directory.
- Old-version cleanup is best-effort and must not block startup.
- Do not add hashing or dependencies; version isolation makes cross-version content comparison unnecessary.
- Do not run Java or Gradle.
- Do not commit, tag, push, or publish unless explicitly requested.

## File Map

- `hosts/vscode-plugin/src/backend/ResourceExtractor.ts`: version resolution, versioned destination, and cleanup.
- `hosts/vscode-plugin/src/backend/BackendLauncher.ts`: pass the extension version into extraction.
- `hosts/vscode-plugin/src/test/suite/resourceExtractor.test.ts`: filesystem regression coverage.
- `hosts/vscode-plugin/src/test/suite/backendLauncher.test.ts`: launcher-to-extractor version forwarding.

---

### Task 1: Isolate extracted backends by extension version

**Files:**
- Modify: `hosts/vscode-plugin/src/backend/ResourceExtractor.ts:9-74,131-153`
- Modify: `hosts/vscode-plugin/src/backend/BackendLauncher.ts:194-211`
- Create: `hosts/vscode-plugin/src/test/suite/resourceExtractor.test.ts`
- Modify: `hosts/vscode-plugin/src/test/suite/backendLauncher.test.ts`

**Interfaces:**
- Produces: `ResourceExtractor.extractBinary(extensionPath: string, extensionVersion?: string): Promise<string>`.
- Consumes: `BackendLauncher.extensionVersion` supplied by `extension.ts` from `context.extension.packageJSON.version`.

- [ ] **Step 1: Add a failing extraction regression test**

Create `resourceExtractor.test.ts` using Node temporary directories. Call the private implementation through a narrow test cast so the production API does not gain test-only methods:

```ts
import * as assert from "assert"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { ResourceExtractor } from "../../backend/ResourceExtractor"

suite("ResourceExtractor Test Suite", () => {
  const roots: string[] = []

  teardown(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.promises.rm(root, { recursive: true, force: true })))
  })

  test("same-size binaries from different extension versions use different paths", async () => {
    const extension = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-extension-test-"))
    roots.push(extension)
    const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux"
    const arch = process.arch === "arm64" ? "arm64" : "amd64"
    const name = process.platform === "win32" ? "opencode.exe" : "opencode"
    const bundled = path.join(extension, "resources", "bin", platform, arch, name)
    await fs.promises.mkdir(path.dirname(bundled), { recursive: true })
    await fs.promises.writeFile(bundled, "old0")

    const extractor = ResourceExtractor as unknown as {
      doExtract(extensionPath: string, extensionVersion?: string, tempRoot?: string): Promise<string>
    }
    const first = await extractor.doExtract(extension, "26.7.902-test-a", extension)
    const firstContent = await fs.promises.readFile(first, "utf8")
    await fs.promises.writeFile(bundled, "new0")
    const second = await extractor.doExtract(extension, "26.7.902-test-b", extension)

    assert.notStrictEqual(first, second)
    assert.strictEqual(firstContent, "old0")
    assert.strictEqual(await fs.promises.readFile(second, "utf8"), "new0")

  })

  test("copy failure without a current-version destination uses bundled binary", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-copy-test-"))
    roots.push(root)
    const source = path.join(root, "bundled")
    const destination = path.join(root, "missing", "opencode")
    await fs.promises.writeFile(source, "current")
    const copy = fs.promises.copyFile
    fs.promises.copyFile = async () => {
      throw new Error("locked")
    }
    try {
      const extractor = ResourceExtractor as unknown as {
        copyWithFallback(binaryPath: string, destPath: string): Promise<string>
      }
      assert.strictEqual(await extractor.copyWithFallback(source, destination), source)
    } finally {
      fs.promises.copyFile = copy
    }
  })
})
```

Use unique test version suffixes so no existing user's extracted binary is touched.

- [ ] **Step 2: Add a failing launcher forwarding test**

In `backendLauncher.test.ts`, temporarily replace `ResourceExtractor.extractBinary`, invoke the launcher's private `extractBinary`, and assert the version argument:

```ts
test("should pass extension version to ResourceExtractor", async () => {
  const original = ResourceExtractor.extractBinary
  let received: string | undefined
  ResourceExtractor.extractBinary = async (_path, version) => {
    received = version
    return "opencode"
  }
  try {
    const scoped = new BackendLauncher({ extensionPath: "/tmp/extension", extensionVersion: "26.7.902" })
    await (scoped as unknown as { extractBinary(): Promise<string> }).extractBinary()
    assert.strictEqual(received, "26.7.902")
  } finally {
    ResourceExtractor.extractBinary = original
  }
})
```

Add the `ResourceExtractor` import.

- [ ] **Step 3: Compile and run the tests to confirm failure**

Run from `hosts/vscode-plugin`:

```powershell
pnpm run compile
pnpm exec vscode-test --label unit --grep "ResourceExtractor|pass extension version"
```

Expected: compile or assertions FAIL because the extractor accepts no version and uses one shared destination.

- [ ] **Step 4: Resolve and sanitize the extension version**

Change the public signature and pass the version into `doExtract`:

```ts
static extractBinary(extensionPath: string, extensionVersion?: string): Promise<string> {
  if (this.pending) return this.pending
  this.pending = this.doExtract(extensionPath, extensionVersion)
  return this.pending
}
```

Add version resolution inside `ResourceExtractor`:

```ts
private static async resolveVersion(extensionPath: string, extensionVersion?: string): Promise<string> {
  const supplied = extensionVersion?.trim()
  if (supplied) return supplied.replace(/[^0-9A-Za-z._-]/g, "_")
  const input = await fs.promises.readFile(path.join(extensionPath, "package.json"), "utf8")
  const value = (JSON.parse(input) as { version?: unknown }).version
  if (typeof value !== "string" || !value.trim()) throw new Error("Extension version is unavailable")
  return value.trim().replace(/[^0-9A-Za-z._-]/g, "_")
}
```

An unavailable version is a hard extraction error; `BackendLauncher` may then follow its existing system-PATH fallback rather than reuse an unversioned old backend.

- [ ] **Step 5: Use the versioned stable directory**

Change the private implementation signature to:

```ts
private static async doExtract(
  extensionPath: string,
  extensionVersion?: string,
  tempRoot: string = os.tmpdir(),
): Promise<string>
```

Inside that function, replace the destination construction with:

```ts
const version = await this.resolveVersion(extensionPath, extensionVersion)
const stableRoot = path.join(tempRoot, this.STABLE_DIR)
const stableDir = path.join(stableRoot, version)
const destPath = path.join(stableDir, binaryName)
```

Keep `canReuse` unchanged because it now compares only files belonging to the same extension version.

Replace random-temp cleanup with version cleanup plus the existing legacy cleanup:

```ts
this.cleanupOldVersions(stableRoot, version).catch((error) => this.logFsError("cleanup old versions", error))
this.cleanupStaleTempFiles().catch((error) => this.logFsError("cleanup stale temp files", error))
```

Add:

```ts
private static async cleanupOldVersions(stableRoot: string, current: string): Promise<void> {
  const entries = await fs.promises.readdir(stableRoot).catch(() => [])
  await Promise.all(
    entries
      .filter((entry) => entry !== current)
      .map((entry) => fs.promises.rm(path.join(stableRoot, entry), { recursive: true, force: true }).catch(() => {})),
  )
}
```

- [ ] **Step 6: Forward the version from BackendLauncher**

Change the bundled extraction call:

```ts
return await ResourceExtractor.extractBinary(extPath, this.extensionVersion)
```

Production already supplies `extensionVersion` from `extension.ts`; string-constructor compatibility falls back to reading the extension's `package.json`.

- [ ] **Step 7: Verify compile and focused tests**

Run from `hosts/vscode-plugin`:

```powershell
pnpm run compile
pnpm exec vscode-test --label unit --grep "ResourceExtractor|pass extension version"
```

Expected: compile exits 0 and focused tests PASS.

- [ ] **Step 8: Review checkpoint**

Confirm no path can select `%TEMP%/opencode-bin/opencode.exe` without a version component. Verify old-directory deletion failures are swallowed and current startup still succeeds. Do not commit without explicit user approval.

---

## Plan Verification

Run from `hosts/vscode-plugin`:

```powershell
pnpm run compile
pnpm run lint
pnpm exec vscode-test --label unit
```

Then rebuild the Windows VSIX using the repository's existing script and verify:

1. The manifest version equals the WebGUI version.
2. The bundled backend reports the expected backend version.
3. Starting the bundled backend and requesting `/app` returns HTML/JS containing the current WebGUI version.
4. The extracted path includes `opencode-bin/26.7.902/` for the current package version.

Expected: all checks pass. Do not publish the VSIX without explicit user approval.
