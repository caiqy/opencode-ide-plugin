import type { ReleaseChecker, ReleaseInfo } from "./ReleaseChecker"
import type { UpdateInstaller } from "./UpdateInstaller"

type UpdateEventPayload =
  | ReleaseInfo
  | { version: string }
  | { version: string; filePath: string }
  | { version: string; error: string }
type UpdateEvent = "updateAvailable" | "downloading" | "installing" | "success" | "error"
type UpdateSession = (type: UpdateEvent, payload: UpdateEventPayload) => void

type UpdateServiceOptions = {
  currentVersion: string
  checker: Pick<ReleaseChecker, "getLatest">
  installer: Pick<UpdateInstaller, "install">
  scheduler?: UpdateScheduler
  onScheduledError?: (error: unknown) => void
}

type TimerHandle = unknown

type UpdateScheduler = {
  setTimeout(task: () => void, delay: number): TimerHandle
  clearTimeout(handle: TimerHandle): void
  setInterval(task: () => void, delay: number): TimerHandle
  clearInterval(handle: TimerHandle): void
}

type UpdateInfo = {
  latest: ReleaseInfo | null
  notifiedVersion?: string
  hasUpdate: boolean
}

type CheckForUpdatesResult =
  | { status: "available"; latest: ReleaseInfo }
  | { status: "up-to-date"; currentVersion: string }

export const automaticUpdateStorageKey = "commonSettings.autoUpdate"

export class UpdateService {
  static readonly initialDelayMs = 30_000
  static readonly pollIntervalMs = 4 * 60 * 60 * 1000

  private sessions = new Map<string, UpdateSession>()
  private latest: ReleaseInfo | null = null
  private notifiedVersion?: string
  private currentVersion: string
  private readonly scheduler: UpdateScheduler
  private initialCheckTimer?: TimerHandle
  private pollTimer?: TimerHandle
  private automaticChecksEnabled = false

  constructor(private readonly options: UpdateServiceOptions) {
    this.currentVersion = options.currentVersion
    this.scheduler = options.scheduler ?? defaultScheduler
  }

  start(): void {
    this.automaticChecksEnabled = true
    if (this.initialCheckTimer || this.pollTimer) {
      return
    }

    this.initialCheckTimer = this.scheduler.setTimeout(() => {
      this.initialCheckTimer = undefined
      this.runScheduledCheck()
    }, UpdateService.initialDelayMs)

    this.pollTimer = this.scheduler.setInterval(() => {
      this.runScheduledCheck()
    }, UpdateService.pollIntervalMs)
  }

  dispose(): void {
    this.automaticChecksEnabled = false
    this.stopScheduledChecks()
  }

  setAutomaticChecks(enabled: boolean): void {
    if (enabled) {
      this.start()
      return
    }
    this.automaticChecksEnabled = false
    this.stopScheduledChecks()
  }

  isAutomaticChecksEnabled(): boolean {
    return this.automaticChecksEnabled
  }

  private stopScheduledChecks(): void {
    if (this.initialCheckTimer) {
      this.scheduler.clearTimeout(this.initialCheckTimer)
      this.initialCheckTimer = undefined
    }

    if (this.pollTimer) {
      this.scheduler.clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }
  }

  attachSession(sessionId: string, send: UpdateSession): void {
    this.sessions.set(sessionId, send)
  }

  detachSession(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  async checkNow(): Promise<ReleaseInfo | null> {
    const latest = await this.options.checker.getLatest(this.currentVersion)
    this.latest = latest

    if (latest && latest.version !== this.notifiedVersion) {
      this.notifiedVersion = latest.version
      this.broadcast("updateAvailable", latest)
    }

    return latest
  }

  async checkForUpdates(): Promise<CheckForUpdatesResult> {
    const latest = await this.options.checker.getLatest(this.currentVersion)
    this.latest = latest

    if (latest) {
      if (latest.version !== this.notifiedVersion) {
        this.notifiedVersion = latest.version
        this.broadcast("updateAvailable", latest)
      }
      return {
        status: "available",
        latest,
      }
    }

    return {
      status: "up-to-date",
      currentVersion: this.currentVersion,
    }
  }

  getUpdateInfo(): UpdateInfo {
    return {
      latest: this.latest,
      notifiedVersion: this.notifiedVersion,
      hasUpdate: this.latest !== null,
    }
  }

  async installUpdate(version: string): Promise<string> {
    if (!this.latest || this.latest.version !== version) {
      throw new Error(`Update not available: ${version}`)
    }

    this.broadcast("downloading", { version })

    let filePath: string

    try {
      filePath = await this.options.installer.install(this.latest, {
        onInstalling: () => {
          this.broadcast("installing", { version })
        },
      })
    } catch (error) {
      this.broadcast("error", {
        version,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }

    this.currentVersion = version
    this.latest = null
    this.notifiedVersion = version
    this.broadcast("success", { version, filePath })
    return filePath
  }

  private broadcast(type: UpdateEvent, payload: UpdateEventPayload): void {
    this.sessions.forEach((send) => send(type, payload))
  }

  private runScheduledCheck(): void {
    void this.checkNow().catch((error) => {
      this.options.onScheduledError?.(error)
    })
  }
}

const defaultScheduler: UpdateScheduler = {
  setTimeout(task, delay) {
    return globalThis.setTimeout(task, delay)
  },
  clearTimeout(handle) {
    globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>)
  },
  setInterval(task, delay) {
    return globalThis.setInterval(task, delay)
  },
  clearInterval(handle) {
    globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>)
  },
}

export type {
  CheckForUpdatesResult,
  UpdateEvent,
  UpdateEventPayload,
  UpdateInfo,
  UpdateScheduler,
  UpdateServiceOptions,
  UpdateSession,
}
