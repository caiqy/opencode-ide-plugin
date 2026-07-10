import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { randomUUID } from "crypto"

/**
 * Binary extraction utility - mirrors ResourceExtractor.kt
 * Handles OS/architecture detection and binary extraction from extension resources
 */
export class ResourceExtractor {
  private static readonly STABLE_DIR = "opencode-bin"
  private static readonly LEGACY_PREFIX = "opencode-"
  private static readonly TEMP_MAX_AGE = 60 * 60 * 1000
  private static readonly OLD_VERSION_MAX_AGE = 24 * 60 * 60 * 1000
  private static readonly LOCK_MAX_AGE = 5 * 60 * 1000
  private static readonly LEASE_DIR = ".opencode-extract-leases"
  private static pending = new Map<string, Promise<string>>()

  /**
   * Extract the appropriate opencode binary for the current platform.
   * Reuses the stable temp binary when it already matches the bundled
   * binary size, avoiding unnecessary rewrites and Windows security scans.
   * Subsequent calls return the cached result.
   * @param extensionPath Path to the extension directory
   * @returns Promise resolving to the path of the extracted binary
   */
  static async extractBinary(extensionPath: string, extensionVersion?: string): Promise<string> {
    const version = await this.resolveVersion(extensionPath, extensionVersion)
    const existing = this.pending.get(version)
    if (existing) {
      console.log("[ResourceExtractor] Skipping extraction, using cached binary promise")
      return existing
    }

    console.log("[ResourceExtractor] Starting extraction")
    let pending: Promise<string>
    pending = this.doExtract(extensionPath, version).finally(() => {
      if (this.pending.get(version) === pending) this.pending.delete(version)
    })
    this.pending.set(version, pending)
    return pending
  }

  private static async doExtract(extensionPath: string, extensionVersion?: string, tempRoot = os.tmpdir()): Promise<string> {
    const osType = this.detectOS()
    const arch = this.detectArchitecture()

    const binaryName = osType === "windows" ? "opencode.exe" : "opencode"

    const binaryPath = path.join(extensionPath, "resources", "bin", osType, arch, binaryName)

    if (!fs.existsSync(binaryPath)) {
      console.log(`[ResourceExtractor] Binary not found for platform ${osType}/${arch} at ${binaryPath}`)
      throw new Error(`Binary not found for platform ${osType}/${arch} at ${binaryPath}`)
    }

    const version = await this.resolveVersion(extensionPath, extensionVersion)
    const stableRoot = path.join(tempRoot, this.STABLE_DIR)
    const stableDir = path.join(stableRoot, version)
    const destPath = path.join(stableDir, binaryName)

    await fs.promises.mkdir(stableRoot, { recursive: true }).catch((error) => this.logFsError(`create stable root ${stableRoot}`, error))
    const lock = await this.acquireRootLock(stableRoot, 2)
    if (!lock) {
      if (await this.isUsableBinary(binaryPath, osType !== "windows")) return binaryPath
      throw new Error(`Could not lock extraction root ${stableRoot}`)
    }

    console.log(`[ResourceExtractor] Preparing stable directory ${stableDir}`)
    let result: string
    try {
      await fs.promises.mkdir(stableDir, { recursive: true })
      await this.cleanupStaleTempFiles(stableDir, binaryName).catch((error) => this.logFsError("cleanup stale temp files", error))
      if (await this.canReuse(binaryPath, destPath) && (await this.makeExecutable(destPath, osType !== "windows"))) {
        console.log(`[ResourceExtractor] Reusing extracted binary at ${destPath}`)
        await fs.promises.utimes(stableDir, new Date(), new Date())
        result = destPath
      } else {
        result = await this.copyWithFallback(binaryPath, destPath, osType !== "windows")
        await fs.promises.utimes(stableDir, new Date(), new Date())
        console.log(`[ResourceExtractor] Extraction complete, binary at ${result}`)
      }
    } finally {
      await this.cleanupStaleTempFiles(stableDir, binaryName).catch((error) =>
        this.logFsError("cleanup stale temp files", error),
      )
      await this.releaseRootLock(stableRoot, lock)
    }
    this.cleanupOldVersions(stableRoot, version, tempRoot).catch((error) => this.logFsError("coordinated cleanup", error))
    return result!
  }

  private static async copyWithFallback(binaryPath: string, destPath: string, executable = false): Promise<string> {
    console.log(`[ResourceExtractor] Writing binary to ${destPath}`)
    const tempPath = `${destPath}.${randomUUID()}.tmp`
    const copied = await fs.promises
      .copyFile(binaryPath, tempPath)
      .then(() => fs.promises.rename(tempPath, destPath))
      .then(() => true)
      .catch(async (error) => {
        await fs.promises.rm(tempPath, { force: true }).catch(() => {})
        this.logFsError(`copy binary to ${destPath}`, error)
        return false
      })

    if (copied && (await this.makeExecutable(destPath, executable))) {
      console.log(`[ResourceExtractor] Finished writing binary to ${destPath}`)
      return destPath
    }

    if (!copied && (await this.canReuse(binaryPath, destPath)) && (await this.makeExecutable(destPath, executable))) {
      console.log(`[ResourceExtractor] Continuing with existing extracted binary at ${destPath}`)
      return destPath
    }

    if (!(await this.isUsableBinary(binaryPath, executable))) throw new Error(`Bundled binary is unusable at ${binaryPath}`)
    console.log(`[ResourceExtractor] Continuing with bundled binary at ${binaryPath}`)
    return binaryPath
  }

  private static async canReuse(binaryPath: string, destPath: string): Promise<boolean> {
    const [source, dest] = await Promise.all([
      fs.promises.stat(binaryPath).catch(() => undefined),
      fs.promises.stat(destPath).catch(() => undefined),
    ])

    return Boolean(source?.isFile() && dest?.isFile() && source.size === dest.size)
  }

  private static async resolveVersion(extensionPath: string, extensionVersion?: string): Promise<string> {
    if (extensionVersion !== undefined) return this.sanitizeVersion(extensionVersion)

    const input = await fs.promises.readFile(path.join(extensionPath, "package.json"), "utf8")
    const value = (JSON.parse(input) as { version?: unknown }).version
    if (typeof value !== "string" || !value.trim()) throw new Error("Extension version is unavailable")
    return this.sanitizeVersion(value)
  }

  private static sanitizeVersion(value: string): string {
    const version = value.toLowerCase()
    const basename = version.split(".")[0]
    if (
      !version ||
      value !== value.trim() ||
      version.endsWith(".") ||
      version === "." ||
      version === ".." ||
      !/^[0-9a-z._-]+$/.test(version) ||
      /^(con|nul|prn|aux|com[1-9]|lpt[1-9])$/.test(basename)
    ) {
      throw new Error("Extension version is unavailable")
    }
    return version
  }

  private static async runBestEffort(label: string, op: () => Promise<unknown>): Promise<void> {
    await op()
      .then(() => {
        console.log(`[ResourceExtractor] Completed ${label}`)
      })
      .catch((error) => {
        this.logFsError(label, error)
      })
  }

  private static logFsError(label: string, error: unknown): void {
    console.log(`[ResourceExtractor] Could not ${label}: ${this.errorMessage(error)}`)
  }

  private static errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message
    return String(error)
  }

  private static async cleanupOldVersions(stableRoot: string, current: string, tempRoot = os.tmpdir()): Promise<void> {
    const lock = await this.acquireRootLock(stableRoot, 0)
    if (!lock) return
    try {
      const entries = await fs.promises.readdir(stableRoot).catch(() => [])
      await Promise.all(
        entries.map(async (entry) => {
          const version = await Promise.resolve(entry).then((value) => this.sanitizeVersion(value)).catch(() => undefined)
          if (!version || version === current) return
          const full = path.join(stableRoot, entry)
          const stat = await fs.promises.stat(full).catch(() => undefined)
          if (!stat?.isDirectory() || Date.now() - stat.mtimeMs < this.OLD_VERSION_MAX_AGE) return
          await fs.promises.rm(full, { recursive: true, force: true }).catch(() => {})
        }),
      )
      await this.cleanupLegacyTempFiles(tempRoot)
    } finally {
      await this.releaseRootLock(stableRoot, lock)
    }
  }

  private static async readLock(lockPath: string) {
    return fs.promises
      .readFile(lockPath, "utf8")
      .then((input) => JSON.parse(input) as { pid?: unknown; token?: unknown })
      .then((owner) =>
        typeof owner.pid === "number" &&
        Number.isSafeInteger(owner.pid) &&
        owner.pid > 0 &&
        typeof owner.token === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(owner.token)
          ? { pid: owner.pid, token: owner.token }
          : undefined,
      )
      .catch(() => undefined)
  }

  private static async acquireRootLock(stableRoot: string, retries: number): Promise<{ ownerPath: string; token: string; released: boolean } | undefined> {
    const leaseRoot = path.join(stableRoot, this.LEASE_DIR)
    await fs.promises.mkdir(leaseRoot, { recursive: true }).catch(() => {})
    for (let attempt = 0; attempt <= retries; attempt++) {
      const token = randomUUID()
      const candidate = path.join(leaseRoot, `.candidate-${process.pid}-${token}`)
      const shared = path.join(leaseRoot, ".opencode-extract-lock")
      const lock = await fs.promises.open(candidate, "wx").catch(() => undefined)
      if (!lock) continue
      let acquired = false
      try {
        await lock.writeFile(JSON.stringify({ pid: process.pid, token }))
        await lock.close()
        for (let selection = 0; selection <= retries; selection++) {
          if (await fs.promises.link(candidate, shared).then(() => true, () => false)) {
            acquired = true
            await fs.promises.rm(candidate, { force: true }).catch(() => {})
            return { ownerPath: shared, token, released: false }
          }
          const owner = await this.readLock(shared)
          if (owner && this.isDeadOwner(owner.pid)) {
            const tombstone = path.join(leaseRoot, `.reclaimed-${owner.token}`)
            // ponytail: tombstones prevent paused reclaimers; GC only if their tiny crash residue is measured.
            if (await fs.promises.link(shared, tombstone).then(() => true, () => false)) {
              // ponytail: retain tombstone/shared on persistent unlink failure; add measured temp cleanup if residue matters.
              if (await this.unlinkWithRetry(shared)) continue
              return
            }
          }
          if (selection < retries) await new Promise((resolve) => setTimeout(resolve, 25))
        }
      } catch {
      } finally {
        if (!acquired) {
          await lock.close().catch(() => {})
          await fs.promises.rm(candidate, { force: true }).catch(() => {})
        }
      }
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }

  private static async releaseRootLock(stableRoot: string, lease: { ownerPath: string; token: string; released?: boolean }): Promise<void> {
    if (lease.released) return
    lease.released = true
    if ((await this.readLock(lease.ownerPath))?.token !== lease.token) return
    const released = path.join(path.dirname(lease.ownerPath), `.released-${lease.token}-${randomUUID()}`)
    if (!(await fs.promises.link(lease.ownerPath, released).then(() => true, () => false))) return
    if ((await this.readLock(released))?.token !== lease.token) {
      await fs.promises.rm(released, { force: true }).catch(() => {})
      return
    }
    if (!(await this.unlinkWithRetry(lease.ownerPath))) return
    await fs.promises.rm(released, { force: true, maxRetries: 3, retryDelay: 25 }).catch(() => {})
  }

  private static async unlinkWithRetry(filePath: string): Promise<boolean> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const removed = await fs.promises.rm(filePath, { force: true }).then(() => true, (error: NodeJS.ErrnoException) => {
        if (!["EPERM", "EBUSY", "ENOTEMPTY"].includes(error.code ?? "")) return false
        return undefined
      })
      if (removed !== undefined) return removed
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    return false
  }

  private static isDeadOwner(pid: number): boolean {
    try {
      process.kill(pid, 0)
      return false
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH"
    }
  }

  private static async cleanupStaleTempFiles(stableDir: string, binaryName: string): Promise<void> {
    const entries = await fs.promises.readdir(stableDir).catch(() => [])
    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.startsWith(`${binaryName}.`) || !entry.endsWith(".tmp")) return
        const full = path.join(stableDir, entry)
        const stat = await fs.promises.stat(full).catch(() => undefined)
        if (!stat || Date.now() - stat.mtimeMs < this.TEMP_MAX_AGE) return
        await fs.promises.rm(full, { force: true }).catch(() => {})
      }),
    )
  }

  private static async cleanupLegacyTempFiles(tempRoot = os.tmpdir()): Promise<void> {
    const entries = await fs.promises.readdir(tempRoot).catch(() => [])
    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.startsWith(this.LEGACY_PREFIX) || entry === this.STABLE_DIR || !/^opencode-\d/.test(entry)) return
        const full = path.join(tempRoot, entry)
        const stat = await fs.promises.stat(full).catch(() => undefined)
        if (!stat || Date.now() - stat.mtimeMs < this.OLD_VERSION_MAX_AGE) return
        await fs.promises.rm(full, { recursive: true, force: true }).catch(() => {})
      }),
    )
  }

  /**
   * Detect the current operating system
   * @returns OS identifier (windows, macos, linux)
   */
  private static detectOS(): string {
    const platform = os.platform()

    switch (platform) {
      case "win32":
        return "windows"
      case "darwin":
        return "macos"
      case "linux":
        return "linux"
      default:
        throw new Error(`Unsupported platform: ${platform}`)
    }
  }

  /**
   * Detect the current architecture
   * @returns Architecture identifier (amd64, arm64)
   */
  private static detectArchitecture(): string {
    const arch = os.arch()

    switch (arch) {
      case "x64":
        return "amd64"
      case "arm64":
        return "arm64"
      default:
        throw new Error(`Unsupported architecture: ${arch}`)
    }
  }

  /**
   * Make a file executable (Unix-like systems)
   * @param filePath Path to the file to make executable
   */
  private static async makeExecutable(filePath: string, required: boolean): Promise<boolean> {
    if (!required) return true
    return fs.promises.chmod(filePath, 0o755).then(
      () => true,
      (error) => {
      this.logFsError(`make ${filePath} executable`, error)
        return false
      },
    )
  }

  private static async isUsableBinary(filePath: string, executable: boolean): Promise<boolean> {
    const stat = await fs.promises.stat(filePath).catch(() => undefined)
    if (!stat?.isFile()) return false
    if (!executable) return true
    return fs.promises.access(filePath, fs.constants.X_OK).then(
      () => true,
      () => false,
    )
  }
}
