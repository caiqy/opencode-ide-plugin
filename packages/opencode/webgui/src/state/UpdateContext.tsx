import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { ideBridge } from "../lib/ideBridge"
import { useToast } from "./ToastContext"

type UpdateStatus = "idle" | "available" | "downloading" | "installing" | "success" | "error"

type UpdateRelease = {
  version: string
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
  installUpdate: (version: string) => Promise<void>
  checkForUpdates: () => Promise<void>
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
}

type CheckForUpdatesResult = {
  status?: unknown
  latest?: unknown
}

const Ctx = createContext<UpdateValue | null>(null)

function toRelease(input: unknown): UpdateRelease | null {
  if (!input || typeof input !== "object") return null
  const data = input as Record<string, unknown>
  if (typeof data.version !== "string" || data.version.length === 0) return null
  return {
    version: data.version,
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
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmVersion, setConfirmVersion] = useState<string | null>(null)

  const clearInstallConfirm = useCallback(() => {
    setConfirmOpen(false)
    setConfirmVersion(null)
  }, [])

  useEffect(() => {
    if (!ideBridge.isInstalled()) return

    let disposed = false

    void ideBridge
      .request<UpdateInfoResult>("getUpdateInfo")
      .then((message) => {
        if (disposed) return
        const next = toRelease(message.result?.latest)
        setLatest(next)
        setStatus(getInitialStatus(message.result, next))
      })
      .catch(() => {
        if (disposed) return
        setStatus((current) => (current === "idle" ? "idle" : current))
      })

    const handler = (message: UpdateMessage) => {
      const payload = message.payload ?? message

      if (message.type === "updateAvailable") {
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
      setStatus("downloading")
      try {
        await ideBridge.request("installUpdate", { version })
      } catch {
        setStatus("error")
      }
    },
    [clearInstallConfirm],
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
    try {
      const message = await ideBridge.request<CheckForUpdatesResult>("checkForUpdates")
      const result = message.result

      if (result?.status === "up-to-date") {
        setLatest(null)
        setStatus("idle")
        clearInstallConfirm()
        showToast("已是最新版")
        return
      }

      if (result?.status === "available") {
        const next = toRelease(result.latest)
        if (!next) {
          clearInstallConfirm()
          showToast("检查更新失败，请稍后重试")
          return
        }
        setLatest(next)
        setStatus("available")
        setConfirmOpen(true)
        setConfirmVersion(next.version)
      }
    } catch {
      clearInstallConfirm()
      showToast("检查更新失败，请稍后重试")
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

  const value = useMemo<UpdateValue>(
    () => ({
      currentVersion: __APP_VERSION__,
      latest,
      status,
      isChecking,
      installUpdate,
      checkForUpdates,
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
      installUpdate,
      isChecking,
      latest,
      openRelease,
      status,
    ],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
