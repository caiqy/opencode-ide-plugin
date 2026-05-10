import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { ideBridge } from "../lib/ideBridge"
import { scopedStateGetJSON, scopedStateSetJSON } from "./scopedStorage"
import { useToast } from "./ToastContext"

type UpdateStatus = "idle" | "available" | "downloading" | "installing" | "success" | "error"

type UpdateRelease = {
  version: string
  manualUpdate?: boolean
  releaseUrl?: string
  notes?: string
  publishedAt?: string
  vsixUrl?: string
}

type UpdateValue = {
  currentVersion: string
  latest: UpdateRelease | null
  status: UpdateStatus
  isChecking: boolean
  lastCheckMessage: string | null
  /** Whether the current latest version has been dismissed by the user */
  dismissed: boolean
  installUpdate: (version: string) => Promise<void>
  checkForUpdates: () => Promise<void>
  dismissUpdate: () => void
  confirmOpen: boolean
  confirmVersion: string | null
  confirmInstall: () => Promise<void>
  cancelInstallConfirm: () => void
  openRelease: () => Promise<void>
}

type UpdateMessage = {
  type: string
  payload?: unknown
  version?: unknown
  releaseUrl?: unknown
  notes?: unknown
  publishedAt?: unknown
  vsixUrl?: unknown
}

type UpdateInfoResult = {
  latest?: unknown
  hasUpdate?: unknown
  supported?: unknown
  reason?: unknown
}

type CheckForUpdatesResult = {
  status?: unknown
  latest?: unknown
  currentVersion?: unknown
  reason?: unknown
}

const Ctx = createContext<UpdateValue | null>(null)

function toRelease(input: unknown): UpdateRelease | null {
  if (!input || typeof input !== "object") return null
  const data = input as Record<string, unknown>
  if (typeof data.version !== "string" || data.version.length === 0) return null
  return {
    version: data.version,
    manualUpdate: typeof data.manualUpdate === "boolean" ? data.manualUpdate : undefined,
    releaseUrl: typeof data.releaseUrl === "string" ? data.releaseUrl : undefined,
    notes: typeof data.notes === "string" ? data.notes : undefined,
    publishedAt: typeof data.publishedAt === "string" ? data.publishedAt : undefined,
    vsixUrl: typeof data.vsixUrl === "string" ? data.vsixUrl : undefined,
  }
}

function mergeRelease(current: UpdateRelease | null, input: unknown): UpdateRelease | null {
  const next = toRelease(input)
  if (next)
    return {
      version: next.version,
      manualUpdate: next.manualUpdate ?? current?.manualUpdate,
      releaseUrl: next.releaseUrl ?? current?.releaseUrl,
      notes: next.notes ?? current?.notes,
      publishedAt: next.publishedAt ?? current?.publishedAt,
      vsixUrl: next.vsixUrl ?? current?.vsixUrl,
    }
  if (!input || typeof input !== "object") return current
  const data = input as Record<string, unknown>
  if (typeof data.version !== "string" || data.version.length === 0) return current
  return {
    version: data.version,
    manualUpdate: typeof data.manualUpdate === "boolean" ? data.manualUpdate : current?.manualUpdate,
    releaseUrl: typeof data.releaseUrl === "string" ? data.releaseUrl : current?.releaseUrl,
    notes: typeof data.notes === "string" ? data.notes : current?.notes,
    publishedAt: typeof data.publishedAt === "string" ? data.publishedAt : current?.publishedAt,
    vsixUrl: typeof data.vsixUrl === "string" ? data.vsixUrl : current?.vsixUrl,
  }
}

function getInitialStatus(message: UpdateInfoResult | undefined, latest: UpdateRelease | null): UpdateStatus {
  if (message?.hasUpdate === true && latest) return "available"
  if (message?.hasUpdate === false) return "idle"
  return latest ? "available" : "idle"
}

export function useUpdate() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useUpdate must be used within UpdateProvider")
  return ctx
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const { showToast } = useToast()
  const [latest, setLatest] = useState<UpdateRelease | null>(null)
  const [status, setStatus] = useState<UpdateStatus>("idle")
  const [isChecking, setIsChecking] = useState(false)
  const [lastCheckMessage, setLastCheckMessage] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmVersion, setConfirmVersion] = useState<string | null>(null)
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null)

  const clearInstallConfirm = useCallback(() => {
    setConfirmOpen(false)
    setConfirmVersion(null)
  }, [])

  useEffect(() => {
    if (!ideBridge.isInstalled()) return

    let disposed = false

    void Promise.all([
      ideBridge.request<UpdateInfoResult>("getUpdateInfo"),
      scopedStateGetJSON<string | null>("global", "update.dismissedVersion", null),
    ])
      .then(([message, savedDismissed]) => {
        if (disposed) return
        if (savedDismissed) {
          setDismissedVersion(savedDismissed)
        }

        if (message.result?.supported === false) {
          setLatest(null)
          setStatus("idle")
          return
        }

        const next = toRelease(message.result?.latest)
        setLatest(next)
        const initialStatus = getInitialStatus(message.result, next)
        setStatus(initialStatus)
      })
      .catch(() => {
        if (disposed) return
        setStatus((current) => (current === "idle" ? "idle" : current))
      })

    const handler = (message: UpdateMessage) => {
      const payload = message.payload ?? message

      if (message.type === "updateAvailable") {
        clearInstallConfirm()
        setLatest((current) => mergeRelease(current, payload))
        setStatus("available")
        return
      }

      if (message.type === "downloading") {
        clearInstallConfirm()
        setLatest((current) => mergeRelease(current, payload))
        setStatus("downloading")
        return
      }

      if (message.type === "installing") {
        clearInstallConfirm()
        setLatest((current) => mergeRelease(current, payload))
        setStatus("installing")
        return
      }

      if (message.type === "error") {
        clearInstallConfirm()
        setLatest((current) => mergeRelease(current, payload))
        setStatus("error")
        return
      }

      if (message.type === "success") {
        clearInstallConfirm()
        setLatest((current) => mergeRelease(current, payload))
        setStatus("success")
      }
    }

    ideBridge.on(handler)
    return () => {
      disposed = true
      ideBridge.off(handler)
    }
  }, [clearInstallConfirm])

  const installUpdate = useCallback(
    async (version: string) => {
      clearInstallConfirm()
      setDismissedVersion(null)
      void scopedStateSetJSON("global", "update.dismissedVersion", null)
      if (latest?.manualUpdate === true) {
        try {
          await ideBridge.request("openPluginManager", { version })
          showToast("请在 JetBrains 插件管理页面完成更新")
        } catch {
          showToast("无法打开插件管理页面，请手动打开 Settings | Plugins")
        }
        return
      }
      setStatus("downloading")
      try {
        await ideBridge.request("installUpdate", { version })
      } catch {
        setStatus("error")
      }
    },
    [clearInstallConfirm, latest?.manualUpdate, showToast],
  )

  const cancelInstallConfirm = useCallback(() => {
    clearInstallConfirm()
  }, [clearInstallConfirm])

  const confirmInstall = useCallback(async () => {
    if (!confirmVersion) return
    const version = confirmVersion
    setConfirmOpen(false)
    setConfirmVersion(null)
    await installUpdate(version)
  }, [confirmVersion, installUpdate])

  const checkForUpdates = useCallback(async () => {
    setIsChecking(true)
    setLastCheckMessage(null)
    // Manual check always clears dismissed state
    setDismissedVersion(null)
    void scopedStateSetJSON("global", "update.dismissedVersion", null)
    try {
      const message = await ideBridge.request<CheckForUpdatesResult>("checkForUpdates")
      const result = message.result

      if (result?.status === "unsupported") {
        const message = "当前安装包不支持站内更新，请使用 JetBrains Marketplace 安装版"
        setLatest(null)
        setStatus("idle")
        clearInstallConfirm()
        setLastCheckMessage(message)
        showToast(message)
        return
      }

      if (result?.status === "up-to-date") {
        const message = "已是最新版"
        setLatest(null)
        setStatus("idle")
        clearInstallConfirm()
        setLastCheckMessage(message)
        showToast(message)
        return
      }

      if (result?.status === "manual-check") {
        const message = "无法确认最新版本，请到 JetBrains 插件管理页面手动检查更新"
        setLatest(null)
        setStatus("idle")
        clearInstallConfirm()
        setLastCheckMessage(message)
        showToast(message)
        return
      }

      if (result?.status === "available") {
        const next = toRelease(result.latest)
        if (!next) {
          const message = "检查更新失败，请稍后重试"
          clearInstallConfirm()
          setLastCheckMessage(message)
          showToast(message)
          return
        }
        setLatest(next)
        setStatus("available")
        setLastCheckMessage(`发现新版本 ${next.version}`)
        if (next.manualUpdate === true) {
          clearInstallConfirm()
          return
        }
        setConfirmOpen(true)
        setConfirmVersion(next.version)
        return
      }

      const fallback = "检查更新失败，请稍后重试"
      setLatest(null)
      setStatus("idle")
      clearInstallConfirm()
      setLastCheckMessage(fallback)
      showToast(fallback)
    } catch {
      const message = "检查更新失败，请稍后重试"
      clearInstallConfirm()
      setLastCheckMessage(message)
      showToast(message)
    } finally {
      setIsChecking(false)
    }
  }, [clearInstallConfirm, showToast])

  const openRelease = useCallback(async () => {
    if (!latest?.releaseUrl) return
    if (ideBridge.isInstalled()) {
      try {
        await ideBridge.request("openUrl", { url: latest.releaseUrl })
        return
      } catch {
        // fall through
      }
    }
    window.open(latest.releaseUrl, "_blank", "noopener,noreferrer")
  }, [latest?.releaseUrl])

  const dismissUpdate = useCallback(() => {
    if (!latest?.version) return
    const version = latest.version
    setDismissedVersion(version)
    void scopedStateSetJSON("global", "update.dismissedVersion", version)
  }, [latest?.version])

  const dismissed = !!(dismissedVersion && latest?.version === dismissedVersion)

  const value = useMemo<UpdateValue>(
    () => ({
      currentVersion: __APP_VERSION__,
      latest,
      status,
      isChecking,
      lastCheckMessage,
      dismissed,
      installUpdate,
      checkForUpdates,
      dismissUpdate,
      confirmOpen,
      confirmVersion,
      confirmInstall,
      cancelInstallConfirm,
      openRelease,
    }),
    [
      cancelInstallConfirm,
      checkForUpdates,
      confirmInstall,
      confirmOpen,
      confirmVersion,
      dismissed,
      dismissUpdate,
      installUpdate,
      isChecking,
      latest,
      lastCheckMessage,
      openRelease,
      status,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
