import * as fs from "fs"
import * as path from "path"
import * as os from "os"

/**
 * Binary extraction utility - mirrors ResourceExtractor.kt
 * Handles OS/architecture detection and binary extraction from extension resources
 */
export class ResourceExtractor {
  private static readonly STABLE_DIR = "opencode-bin"
  private static readonly STALE_PREFIX = "opencode-"
  private static pending: Promise<string> | null = null

  /**
   * Extract the appropriate opencode binary for the current platform.
   * On the first call per extension host process the entire stable
   * directory is deleted so the new bundled binary always replaces
   * the old one.  Subsequent calls return the cached result.
   * @param extensionPath Path to the extension directory
   * @returns Promise resolving to the path of the extracted binary
   */
  static extractBinary(extensionPath: string): Promise<string> {
    if (this.pending) {
      console.log("[ResourceExtractor] Skipping extraction, using cached binary promise")
      return this.pending
    }

    console.log("[ResourceExtractor] Starting extraction")
    this.pending = this.doExtract(extensionPath)
    return this.pending
  }

  private static async doExtract(extensionPath: string): Promise<string> {
    const osType = this.detectOS()
    const arch = this.detectArchitecture()

    const binaryName = osType === "windows" ? "opencode.exe" : "opencode"

    const binaryPath = path.join(extensionPath, "resources", "bin", osType, arch, binaryName)

    if (!fs.existsSync(binaryPath)) {
      console.log(`[ResourceExtractor] Binary not found for platform ${osType}/${arch} at ${binaryPath}`)
      throw new Error(`Binary not found for platform ${osType}/${arch} at ${binaryPath}`)
    }

    const stableDir = path.join(os.tmpdir(), this.STABLE_DIR)

    // Wipe the previous directory so a stale binary is never reused
    console.log(`[ResourceExtractor] Deleting stable directory ${stableDir}`)
    await this.runBestEffort(`delete stable directory ${stableDir}`, () =>
      fs.promises.rm(stableDir, { recursive: true, force: true }),
    )
    await this.runBestEffort(`create stable directory ${stableDir}`, () =>
      fs.promises.mkdir(stableDir, { recursive: true }),
    )

    const destPath = path.join(stableDir, binaryName)
    const extractedPath = await this.copyWithFallback(binaryPath, destPath)

    if (osType !== "windows") {
      await this.makeExecutable(extractedPath)
    }

    // Best-effort cleanup of stale random temp files from previous versions
    this.cleanupStaleTempFiles().catch((error) => {
      this.logFsError("cleanup stale temp files", error)
    })

    console.log(`[ResourceExtractor] Extraction complete, binary at ${extractedPath}`)
    return extractedPath
  }

  private static async copyWithFallback(binaryPath: string, destPath: string): Promise<string> {
    console.log(`[ResourceExtractor] Writing binary to ${destPath}`)
    const copied = await fs.promises
      .copyFile(binaryPath, destPath)
      .then(() => true)
      .catch((error) => {
        this.logFsError(`copy binary to ${destPath}`, error)
        return false
      })

    if (copied) {
      console.log(`[ResourceExtractor] Finished writing binary to ${destPath}`)
      return destPath
    }

    const hasDest = await fs.promises
      .access(destPath, fs.constants.F_OK)
      .then(() => true)
      .catch(() => false)

    if (hasDest) {
      console.log(`[ResourceExtractor] Continuing with existing extracted binary at ${destPath}`)
      return destPath
    }

    console.log(`[ResourceExtractor] Continuing with bundled binary at ${binaryPath}`)
    return binaryPath
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

  /**
   * Remove stale opencode-* temp files/dirs left by older plugin versions.
   */
  private static async cleanupStaleTempFiles(): Promise<void> {
    const tmpDir = os.tmpdir()
    const entries = await fs.promises.readdir(tmpDir)
    for (const entry of entries) {
      if (!entry.startsWith(this.STALE_PREFIX) || entry === this.STABLE_DIR) continue
      // Match old random pattern: opencode-<timestamp>-<random> or opencode-<random-dir>
      if (!/^opencode-\d/.test(entry)) continue
      const full = path.join(tmpDir, entry)
      try {
        const stat = await fs.promises.stat(full)
        if (stat.isDirectory()) {
          await fs.promises.rm(full, { recursive: true, force: true })
        } else {
          await fs.promises.unlink(full)
        }
      } catch {
        // ignore – file may be in use or already removed
      }
    }
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
  private static async makeExecutable(filePath: string): Promise<void> {
    await fs.promises.chmod(filePath, 0o755).catch((error) => {
      this.logFsError(`make ${filePath} executable`, error)
    })
  }
}
