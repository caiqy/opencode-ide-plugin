import * as assert from "assert"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import * as sinon from "sinon"
import { ResourceExtractor } from "../../backend/ResourceExtractor"

async function waitForLeasesToSettle(root: string): Promise<void> {
  const leaseRoots = [
    path.join(root, ".opencode-extract-leases"),
    path.join(root, "opencode-bin", ".opencode-extract-leases"),
  ]
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    const leases = await Promise.all(
      leaseRoots.map((leaseRoot) => fs.promises.readdir(leaseRoot).then((entries) => entries.filter((entry) => entry.startsWith(".candidate-") || entry === ".opencode-extract-lock")).catch(() => [])),
    )
    if (leases.every((entries) => entries.length === 0)) {
      await new Promise<void>((resolve) => setImmediate(resolve))
      const stable = await Promise.all(
        leaseRoots.map((leaseRoot) => fs.promises.readdir(leaseRoot).then((entries) => entries.filter((entry) => entry.startsWith(".candidate-") || entry === ".opencode-extract-lock")).catch(() => [])),
      )
      if (stable.every((entries) => entries.length === 0)) return
    }
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
  const active = await Promise.all(leaseRoots.map((leaseRoot) => fs.promises.readdir(leaseRoot).catch(() => [])))
  assert.fail(`leases did not settle for ${root}: ${active.flat().join(", ")}`)
}

async function removeWhenLeasesSettle(root: string): Promise<void> {
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    await waitForLeasesToSettle(root)
    const removed = await fs.promises.rm(root, { recursive: true, force: true }).then(
      () => true,
      () => false,
    )
    if (removed) return
  }
  await fs.promises.rm(root, { recursive: true, force: true })
}

suite("ResourceExtractor Test Suite", () => {
  const roots: string[] = []

  teardown(async () => {
    await Promise.all(
      roots.splice(0).map(async (root) => {
        await removeWhenLeasesSettle(root)
      }),
    )
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

  test("rejects empty and dot extension versions", async () => {
    const extension = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-version-test-"))
    roots.push(extension)
    const extractor = ResourceExtractor as unknown as {
      resolveVersion(extensionPath: string, extensionVersion?: string): Promise<string>
    }

    await assert.rejects(() => extractor.resolveVersion(extension, "   "))
    await assert.rejects(() => extractor.resolveVersion(extension, "."))
    await assert.rejects(() => extractor.resolveVersion(extension, ".."))
  })

  test("rejects illegal version characters instead of creating colliding names", async () => {
    const extension = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-version-test-"))
    roots.push(extension)
    const extractor = ResourceExtractor as unknown as {
      resolveVersion(extensionPath: string, extensionVersion?: string): Promise<string>
    }
    await assert.rejects(() => extractor.resolveVersion(extension, "26.7/902"))
    assert.strictEqual(await extractor.resolveVersion(extension, "26.7_902"), "26.7_902")
    await assert.rejects(() => extractor.resolveVersion(extension, "26.7.902 "))
    await assert.rejects(() => extractor.resolveVersion(extension, "26.7.902."))
  })

  test("uses package version when no extension version is supplied", async () => {
    const extension = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-version-test-"))
    roots.push(extension)
    await fs.promises.writeFile(path.join(extension, "package.json"), JSON.stringify({ version: "26.7.902" }))
    const extractor = ResourceExtractor as unknown as {
      resolveVersion(extensionPath: string, extensionVersion?: string): Promise<string>
    }

    assert.strictEqual(await extractor.resolveVersion(extension), "26.7.902")
  })

  test("canonicalizes case and rejects Windows reserved version names", async () => {
    const extension = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-version-test-"))
    roots.push(extension)
    const extractor = ResourceExtractor as unknown as {
      resolveVersion(extensionPath: string, extensionVersion?: string): Promise<string>
    }

    assert.strictEqual(await extractor.resolveVersion(extension, "V1"), "v1")
    assert.strictEqual(await extractor.resolveVersion(extension, "v1"), "v1")
    await assert.rejects(() => extractor.resolveVersion(extension, "CON"))
    await assert.rejects(() => extractor.resolveVersion(extension, "nul.txt"))
    await assert.rejects(() => extractor.resolveVersion(extension, "LPT9.log"))
  })

  test("coalesces same version extraction but keeps versions independent", async () => {
    const extractor = ResourceExtractor as unknown as {
      doExtract(extensionPath: string, extensionVersion?: string): Promise<string>
      pending: Map<string, Promise<string>>
    }
    const original = extractor.doExtract
    const resolvers: Array<(value: string) => void> = []
    let calls = 0
    extractor.pending.clear()
    extractor.doExtract = async (_path, version) =>
      new Promise<string>((resolve) => {
        calls++
        resolvers.push(() => resolve(version!))
      })
    try {
      const first = ResourceExtractor.extractBinary("/tmp/extension", "V1")
      const same = ResourceExtractor.extractBinary("/tmp/extension", "v1")
      const second = ResourceExtractor.extractBinary("/tmp/extension", "26.7.902-b")
      await new Promise((resolve) => setImmediate(resolve))

      assert.strictEqual(calls, 2)
      resolvers[0]("a")
      resolvers[1]("b")
      assert.strictEqual(await first, "v1")
      assert.strictEqual(await same, "v1")
      assert.strictEqual(await second, "26.7.902-b")
      const next = ResourceExtractor.extractBinary("/tmp/extension", "v1")
      await new Promise((resolve) => setImmediate(resolve))
      assert.strictEqual(calls, 3)
      resolvers[2]("a")
      assert.strictEqual(await next, "v1")
    } finally {
      extractor.doExtract = original
      extractor.pending.clear()
    }
  })

  test("does not reuse a directory or damaged destination after publish failure", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-publish-test-"))
    roots.push(root)
    const source = path.join(root, "bundled")
    const destination = path.join(root, "opencode")
    await fs.promises.writeFile(source, "current")
    await fs.promises.mkdir(destination)
    const rename = fs.promises.rename
    fs.promises.rename = async () => {
      throw new Error("locked")
    }
    try {
      const extractor = ResourceExtractor as unknown as {
        copyWithFallback(binaryPath: string, destPath: string, makeExecutable: boolean): Promise<string>
      }
      assert.strictEqual(await extractor.copyWithFallback(source, destination, false), source)
      await fs.promises.rm(destination, { recursive: true, force: true })
      await fs.promises.writeFile(destination, "bad")
      assert.strictEqual(await extractor.copyWithFallback(source, destination, false), source)
    } finally {
      fs.promises.rename = rename
    }
  })

  test("falls back to an executable bundled binary when chmod fails", async function () {
    if (process.platform === "win32") this.skip()

    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-chmod-test-"))
    roots.push(root)
    const source = path.join(root, "bundled")
    const destination = path.join(root, "opencode")
    await fs.promises.writeFile(source, "current")
    await fs.promises.chmod(source, 0o755)
    const chmod = fs.promises.chmod
    fs.promises.chmod = async (target, mode) => {
      if (target === destination) throw new Error("denied")
      return chmod(target, mode)
    }
    try {
      const extractor = ResourceExtractor as unknown as {
        copyWithFallback(binaryPath: string, destPath: string, makeExecutable: boolean): Promise<string>
      }
      assert.strictEqual(await extractor.copyWithFallback(source, destination, true), source)
    } finally {
      fs.promises.chmod = chmod
    }
  })

  test("only removes aged stale temporary files in the current version directory", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-stale-test-"))
    roots.push(root)
    const stale = path.join(root, "opencode.exe.old.tmp")
    const fresh = path.join(root, "opencode.exe.new.tmp")
    await Promise.all([fs.promises.writeFile(stale, "partial"), fs.promises.writeFile(fresh, "partial")])
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await fs.promises.utimes(stale, old, old)
    const extractor = ResourceExtractor as unknown as {
      cleanupStaleTempFiles(stableDir: string, binaryName: string): Promise<void>
    }

    await extractor.cleanupStaleTempFiles(root, "opencode.exe")

    await assert.rejects(() => fs.promises.access(stale))
    await fs.promises.access(fresh)
  })

  test("cleans current version temporary files during extraction", async () => {
    const extension = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-stale-test-"))
    roots.push(extension)
    const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux"
    const arch = process.arch === "arm64" ? "arm64" : "amd64"
    const name = process.platform === "win32" ? "opencode.exe" : "opencode"
    const bundled = path.join(extension, "resources", "bin", platform, arch, name)
    const stale = path.join(extension, "opencode-bin", "26.7.902-stale", `${name}.1.tmp`)
    await fs.promises.mkdir(path.dirname(bundled), { recursive: true })
    await fs.promises.writeFile(bundled, "current")
    await fs.promises.mkdir(path.dirname(stale), { recursive: true })
    await fs.promises.writeFile(stale, "partial")
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await fs.promises.utimes(stale, old, old)
    const extractor = ResourceExtractor as unknown as {
      doExtract(extensionPath: string, extensionVersion?: string, tempRoot?: string): Promise<string>
    }

    await extractor.doExtract(extension, "26.7.902-stale", extension)

    await assert.rejects(() => fs.promises.access(stale))
  })

  test("preserves a fresh temporary file created during another publish", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-stale-test-"))
    roots.push(root)
    const temp = path.join(root, "opencode.exe.copy-window.tmp")
    await fs.promises.writeFile(temp, "copied")
    const extractor = ResourceExtractor as unknown as {
      cleanupStaleTempFiles(stableDir: string, binaryName: string): Promise<void>
    }

    await extractor.cleanupStaleTempFiles(root, "opencode.exe")

    await fs.promises.access(temp)
  })

  test("only removes aged legacy temporary entries", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-legacy-test-"))
    roots.push(root)
    const stale = path.join(root, "opencode-123-old")
    const fresh = path.join(root, "opencode-456-new")
    await Promise.all([fs.promises.mkdir(stale), fs.promises.mkdir(fresh)])
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await fs.promises.utimes(stale, old, old)
    const extractor = ResourceExtractor as unknown as {
      cleanupLegacyTempFiles(tempRoot: string): Promise<void>
    }

    await extractor.cleanupLegacyTempFiles(root)

    await assert.rejects(() => fs.promises.access(stale))
    await fs.promises.access(fresh)
  })

  test("concurrent same-version extraction safely returns the published binary", async () => {
    const extension = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-race-test-"))
    roots.push(extension)
    const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux"
    const arch = process.arch === "arm64" ? "arm64" : "amd64"
    const name = process.platform === "win32" ? "opencode.exe" : "opencode"
    const bundled = path.join(extension, "resources", "bin", platform, arch, name)
    await fs.promises.mkdir(path.dirname(bundled), { recursive: true })
    await fs.promises.writeFile(bundled, "current")
    const extractor = ResourceExtractor as unknown as {
      doExtract(extensionPath: string, extensionVersion?: string, tempRoot?: string): Promise<string>
    }

    const extracted = await Promise.all([
      extractor.doExtract(extension, "26.7.902-race", extension),
      extractor.doExtract(extension, "26.7.902-race", extension),
    ])

    assert.strictEqual(extracted[0], extracted[1])
    assert.strictEqual(await fs.promises.readFile(extracted[0], "utf8"), "current")
  })

  test("keeps young old versions but removes aged inactive versions and preserves busy directories", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-cleanup-test-"))
    roots.push(root)
    const current = path.join(root, "26.7.902")
    const old = path.join(root, "26.7.901")
    const busy = path.join(root, "26.7.900")
    const young = path.join(root, "26.7.899")
    await Promise.all([current, old, busy, young].map((dir) => fs.promises.mkdir(dir)))
    const aged = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await Promise.all([old, busy].map((dir) => fs.promises.utimes(dir, aged, aged)))
    const remove = fs.promises.rm
    fs.promises.rm = async (target, options) => {
      if (target === busy) {
        const error = new Error("busy") as NodeJS.ErrnoException
        error.code = "EBUSY"
        throw error
      }
      return remove(target, options)
    }
    try {
      const extractor = ResourceExtractor as unknown as {
        cleanupOldVersions(stableRoot: string, current: string): Promise<void>
      }
      await extractor.cleanupOldVersions(root, "26.7.902")
      await fs.promises.access(current)
      await fs.promises.access(busy)
      await fs.promises.access(young)
      await assert.rejects(() => fs.promises.access(old))
    } finally {
      fs.promises.rm = remove
    }
  })

  test("does not remove a concurrently extracted young version", async () => {
    const extension = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-version-cleanup-test-"))
    roots.push(extension)
    const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux"
    const arch = process.arch === "arm64" ? "arm64" : "amd64"
    const name = process.platform === "win32" ? "opencode.exe" : "opencode"
    const bundled = path.join(extension, "resources", "bin", platform, arch, name)
    await fs.promises.mkdir(path.dirname(bundled), { recursive: true })
    await fs.promises.writeFile(bundled, "current")
    const extractor = ResourceExtractor as unknown as {
      doExtract(extensionPath: string, extensionVersion?: string, tempRoot?: string): Promise<string>
    }

    const first = await extractor.doExtract(extension, "v1", extension)
    const second = await extractor.doExtract(extension, "v2", extension)

    await Promise.all([fs.promises.access(first), fs.promises.access(second)])
  })

  test("cleanup skips an aged version while another extraction holds the root lock", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-lock-test-"))
    roots.push(root)
    const version = path.join(root, "v1")
    await fs.promises.mkdir(version)
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await fs.promises.utimes(version, old, old)
    const extractor = ResourceExtractor as unknown as {
      acquireRootLock(stableRoot: string, retries: number): Promise<{ ownerPath: string; token: string } | undefined>
      releaseRootLock(stableRoot: string, lock: { ownerPath: string; token: string }): Promise<void>
      cleanupOldVersions(stableRoot: string, current: string): Promise<void>
    }
    const lock = await extractor.acquireRootLock(root, 0)
    assert.ok(lock)
    try {
      await extractor.cleanupOldVersions(root, "v2")
      await fs.promises.access(version)
    } finally {
      await extractor.releaseRootLock(root, lock)
    }
  })

  test("reusing an aged version touches it before another cleaner can remove it", async () => {
    const extension = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-lock-test-"))
    roots.push(extension)
    const platform = process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux"
    const arch = process.arch === "arm64" ? "arm64" : "amd64"
    const name = process.platform === "win32" ? "opencode.exe" : "opencode"
    const bundled = path.join(extension, "resources", "bin", platform, arch, name)
    const stableDir = path.join(extension, "opencode-bin", "v1")
    const destination = path.join(stableDir, name)
    await fs.promises.mkdir(path.dirname(bundled), { recursive: true })
    await Promise.all([fs.promises.writeFile(bundled, "current"), fs.promises.mkdir(stableDir, { recursive: true })])
    await fs.promises.writeFile(destination, "current")
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000)
    await fs.promises.utimes(stableDir, old, old)
    const extractor = ResourceExtractor as unknown as {
      doExtract(extensionPath: string, extensionVersion?: string, tempRoot?: string): Promise<string>
      cleanupOldVersions(stableRoot: string, current: string): Promise<void>
    }

    const reused = await extractor.doExtract(extension, "v1", extension)
    await extractor.cleanupOldVersions(path.join(extension, "opencode-bin"), "v2")

    await fs.promises.access(reused)
  })

  test("does not reclaim an aged lock whose owner is alive", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-owner-lock-test-"))
    roots.push(root)
    const lockPath = path.join(root, ".opencode-extract-leases", ".opencode-extract-lock")
    await fs.promises.mkdir(path.dirname(lockPath))
    await fs.promises.writeFile(lockPath, JSON.stringify({ pid: process.pid, token: "11111111-1111-4111-8111-111111111111" }))
    const old = new Date(Date.now() - 6 * 60 * 1000)
    await fs.promises.utimes(lockPath, old, old)
    const extractor = ResourceExtractor as unknown as {
      acquireRootLock(stableRoot: string, retries: number): Promise<{ ownerPath: string; token: string } | undefined>
    }

    assert.strictEqual(await extractor.acquireRootLock(root, 0), undefined)
    await fs.promises.rm(lockPath, { force: true })
  })

  test("reclaims an aged lock whose owner PID is dead", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-owner-lock-test-"))
    roots.push(root)
    const lockPath = path.join(root, ".opencode-extract-leases", ".opencode-extract-lock")
    await fs.promises.mkdir(path.dirname(lockPath))
    await fs.promises.writeFile(lockPath, JSON.stringify({ pid: 99999999, token: "22222222-2222-4222-8222-222222222222" }))
    const old = new Date(Date.now() - 6 * 60 * 1000)
    await fs.promises.utimes(lockPath, old, old)
    const extractor = ResourceExtractor as unknown as {
      acquireRootLock(stableRoot: string, retries: number): Promise<{ ownerPath: string; token: string } | undefined>
      releaseRootLock(stableRoot: string, lock: { ownerPath: string; token: string }): Promise<void>
    }
    const lock = await extractor.acquireRootLock(root, 1)
    assert.ok(lock)
    await extractor.releaseRootLock(root, lock)
  })

  test("publishes a complete owner only when candidate links to shared", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-lock-test-"))
    roots.push(root)
    const leaseRoot = path.join(root, ".opencode-extract-leases")
    const candidate = path.join(leaseRoot, `.candidate-${process.pid}-test`)
    const shared = path.join(leaseRoot, ".opencode-extract-lock")
    await fs.promises.mkdir(leaseRoot)
    await fs.promises.writeFile(candidate, JSON.stringify({ pid: process.pid, token: "33333333-3333-4333-8333-333333333333" }))
    await fs.promises.link(candidate, shared)
    assert.deepStrictEqual(JSON.parse(await fs.promises.readFile(shared, "utf8")), { pid: process.pid, token: "33333333-3333-4333-8333-333333333333" })
    await fs.promises.rm(shared, { force: true })
    await fs.promises.rm(candidate, { force: true })
  })

  test("keeps malformed owners and an empty shared directory as contention", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-owner-lock-test-"))
    roots.push(root)
    const lockPath = path.join(root, ".opencode-extract-leases", ".opencode-extract-lock")
    const extractor = ResourceExtractor as unknown as {
      acquireRootLock(stableRoot: string, retries: number): Promise<{ ownerPath: string; token: string } | undefined>
    }
    for (const owner of ["", JSON.stringify({ pid: process.pid, token: "" }), JSON.stringify({ pid: 1.5, token: "11111111-1111-4111-8111-111111111111" }), JSON.stringify({ pid: -1, token: "11111111-1111-4111-8111-111111111111" }), JSON.stringify({ pid: process.pid, token: "invalid" })]) {
      await fs.promises.mkdir(path.dirname(lockPath), { recursive: true })
      await fs.promises.writeFile(lockPath, owner)
      assert.strictEqual(await extractor.acquireRootLock(root, 0), undefined)
      await fs.promises.rm(lockPath, { force: true })
    }
    await fs.promises.mkdir(lockPath)
    assert.strictEqual(await extractor.acquireRootLock(root, 0), undefined)
    await fs.promises.rm(lockPath, { recursive: true, force: true })
  })

  test("a permanent tombstone prevents an old reclaimer from moving a new lock", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-lock-test-"))
    roots.push(root)
    const leaseRoot = path.join(root, ".opencode-extract-leases")
    await fs.promises.mkdir(leaseRoot)
    await fs.promises.writeFile(path.join(leaseRoot, ".reclaimed-dead"), "")
    await fs.promises.writeFile(path.join(leaseRoot, ".opencode-extract-lock"), JSON.stringify({ pid: process.pid, token: "44444444-4444-4444-8444-444444444444" }))
    const extractor = ResourceExtractor as unknown as { acquireRootLock(root: string, retries: number): Promise<{ ownerPath: string; token: string } | undefined> }
    assert.strictEqual(await extractor.acquireRootLock(root, 0), undefined)
    await fs.promises.access(path.join(leaseRoot, ".opencode-extract-lock"))
    await fs.promises.rm(path.join(leaseRoot, ".opencode-extract-lock"), { force: true })
  })

  test("an old holder release does not remove a newer token lock", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-owner-lock-test-"))
    roots.push(root)
    const extractor = ResourceExtractor as unknown as {
      acquireRootLock(stableRoot: string, retries: number): Promise<{ ownerPath: string; token: string } | undefined>
      releaseRootLock(stableRoot: string, lock: { ownerPath: string; token: string }): Promise<void>
    }
    const old = await extractor.acquireRootLock(root, 0)
    assert.ok(old)
    const lockPath = path.join(root, ".opencode-extract-leases", `ticket-0000000000000002-${process.pid}-00000000-0000-0000-0000-000000000005`)
    await fs.promises.writeFile(lockPath, "")

    await extractor.releaseRootLock(root, old)

    await fs.promises.access(lockPath)
    await fs.promises.rm(lockPath, { force: true })
  })

  test("release cleans only its renamed lock after a new shared lock publishes", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-owner-lock-test-"))
    roots.push(root)
    const extractor = ResourceExtractor as unknown as {
      acquireRootLock(stableRoot: string, retries: number): Promise<{ ownerPath: string; token: string } | undefined>
      releaseRootLock(stableRoot: string, lock: { ownerPath: string; token: string }): Promise<void>
    }
    const old = await extractor.acquireRootLock(root, 0)
    assert.ok(old)
    const originalRm = fs.promises.rm
    let resume: (() => void) | undefined
    const paused = new Promise<void>((resolve) => (resume = resolve))
    const rm = sinon.stub(fs.promises, "rm").callsFake(async (target, options) => {
      if (String(target).includes(`.released-${old.token}`)) await paused
      return originalRm(target, options)
    })
    try {
      const release = extractor.releaseRootLock(root, old)
      const leaseRoot = path.join(root, ".opencode-extract-leases")
      while (!(await fs.promises.readdir(leaseRoot).then((entries) => entries.some((entry) => entry.startsWith(`.released-${old.token}-`))))) await new Promise((resolve) => setImmediate(resolve))
      while (await fs.promises.access(old.ownerPath).then(() => true, () => false)) await new Promise((resolve) => setImmediate(resolve))
      const next = await extractor.acquireRootLock(root, 0)
      assert.ok(next)
      resume?.()
      await release
      await fs.promises.access(next.ownerPath)
      await extractor.releaseRootLock(root, next)
    } finally {
      rm.restore()
    }
  })

  test("release leaves shared lock untouched when rename fails or token differs", async () => {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "opencode-owner-lock-test-"))
    roots.push(root)
    const extractor = ResourceExtractor as unknown as {
      acquireRootLock(stableRoot: string, retries: number): Promise<{ ownerPath: string; token: string } | undefined>
      releaseRootLock(stableRoot: string, lock: { ownerPath: string; token: string }): Promise<void>
    }
    const lock = await extractor.acquireRootLock(root, 0)
    assert.ok(lock)
    const rename = sinon.stub(fs.promises, "link").rejects(new Error("locked"))
    await extractor.releaseRootLock(root, lock)
    rename.restore()
    await fs.promises.access(lock.ownerPath)
    const mismatch = sinon.spy(fs.promises, "link")
    await extractor.releaseRootLock(root, { ...lock, token: "wrong" })
    assert.strictEqual(mismatch.called, false)
    mismatch.restore()
    await fs.promises.rm(lock.ownerPath, { force: true })
  })
})
