import { renderHook, waitFor, act } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "../test/test-utils"

const mocks = vi.hoisted(() => {
  type Handler = (message: { type: string; payload?: unknown }) => void

  let handler: Handler | null = null

  return {
    request: vi.fn(),
    showToast: vi.fn(),
    scopedStateGetJSON: vi.fn(),
    scopedStateSetJSON: vi.fn(),
    on: vi.fn((next: Handler) => {
      handler = next
    }),
    off: vi.fn((next: Handler) => {
      if (handler === next) handler = null
    }),
    emit: (message: { type: string; payload?: unknown }) => {
      handler?.(message)
    },
  }
})

vi.mock("../lib/ideBridge", () => ({
  ideBridge: {
    isInstalled: () => true,
    request: (type: string, payload?: unknown) => mocks.request(type, payload),
    on: (handler: (message: { type: string; payload?: unknown }) => void) => mocks.on(handler),
    off: (handler: (message: { type: string; payload?: unknown }) => void) => mocks.off(handler),
  },
}))

vi.mock("./ToastContext", () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))

vi.mock("./scopedStorage", () => ({
  scopedStateGetJSON: (...args: unknown[]) => mocks.scopedStateGetJSON(...args),
  scopedStateSetJSON: (...args: unknown[]) => mocks.scopedStateSetJSON(...args),
}))

import { UpdateProvider, useUpdate } from "./UpdateContext"
import { UpdateBanner } from "../components/UpdateBanner"

function wrapper(props: { children: ReactNode }) {
  return <UpdateProvider>{props.children}</UpdateProvider>
}

describe("UpdateContext", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    Reflect.set(globalThis, "__APP_VERSION__", "26.4.1405")
    mocks.scopedStateGetJSON.mockResolvedValue(null)
    mocks.scopedStateSetJSON.mockResolvedValue({ ok: true })
    mocks.request.mockResolvedValue({
      result: {
        latest: {
          version: "26.4.1406",
          releaseUrl: "https://example.test/releases/26.4.1406",
        },
        hasUpdate: true,
      },
    })
  })

  it("初始化时会请求 getUpdateInfo", async () => {
    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledWith("getUpdateInfo", undefined)
      expect(result.current.currentVersion).toBe("26.4.1405")
      expect(result.current.latest?.version).toBe("26.4.1406")
      expect(result.current.status).toBe("available")
    })
  })

  it("会把原始下载事件映射为 downloading 状态", async () => {
    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(result.current.latest?.version).toBe("26.4.1406")
      expect(result.current.latest?.releaseUrl).toBe("https://example.test/releases/26.4.1406")
    })

    act(() => {
      mocks.emit({
        type: "downloading",
        payload: { version: "26.4.1406" },
      })
    })

    expect(result.current.status).toBe("downloading")
    expect(result.current.latest?.releaseUrl).toBe("https://example.test/releases/26.4.1406")
  })

  it("会把原始安装事件映射为 installing 状态", async () => {
    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(result.current.latest?.version).toBe("26.4.1406")
    })

    act(() => {
      mocks.emit({
        type: "installing",
        payload: { version: "26.4.1406" },
      })
    })

    expect(result.current.status).toBe("installing")
    expect(result.current.latest?.releaseUrl).toBe("https://example.test/releases/26.4.1406")
  })

  it("success 事件只有 version 和 filePath 时保留已有 releaseUrl", async () => {
    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(result.current.latest).toEqual({
        version: "26.4.1406",
        releaseUrl: "https://example.test/releases/26.4.1406",
        notes: undefined,
        publishedAt: undefined,
        vsixUrl: undefined,
      })
    })

    act(() => {
      mocks.emit({
        type: "success",
        payload: {
          version: "26.4.1406",
          filePath: "/tmp/opencode-26.4.1406.vsix",
        },
      })
    })

    expect(result.current.status).toBe("success")
    expect(result.current.latest?.releaseUrl).toBe("https://example.test/releases/26.4.1406")
  })

  it("installUpdate 请求失败时会进入 error 状态", async () => {
    mocks.request.mockResolvedValueOnce({
      result: {
        latest: {
          version: "26.4.1406",
          releaseUrl: "https://example.test/releases/26.4.1406",
        },
        hasUpdate: true,
      },
    })
    mocks.request.mockRejectedValueOnce(new Error("install failed"))

    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(result.current.status).toBe("available")
    })

    await act(async () => {
      await result.current.installUpdate("26.4.1406")
    })

    expect(mocks.request).toHaveBeenLastCalledWith("installUpdate", { version: "26.4.1406" })
    expect(result.current.status).toBe("error")
  })

  it("会把原始错误事件映射为 error 状态", async () => {
    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(result.current.status).toBe("available")
    })

    act(() => {
      mocks.emit({
        type: "error",
        payload: { version: "26.4.1406", error: "install failed" },
      })
    })

    expect(result.current.status).toBe("error")
    expect(result.current.latest?.releaseUrl).toBe("https://example.test/releases/26.4.1406")
  })

  it("getUpdateInfo 表示无更新时保持 idle 且不展示 Banner", async () => {
    const response = {
      result: {
        latest: {
          version: "26.4.1406",
          releaseUrl: "https://example.test/releases/26.4.1406",
        },
        hasUpdate: false,
      },
    }
    mocks.request.mockResolvedValueOnce(response)
    mocks.request.mockResolvedValueOnce(response)

    const { result } = renderHook(() => useUpdate(), { wrapper })
    render(
      <UpdateProvider>
        <UpdateBanner />
      </UpdateProvider>,
    )

    await waitFor(() => {
      expect(result.current.status).toBe("idle")
    })

    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("手动检查更新发现已是最新版时会提示 toast", async () => {
    mocks.request.mockResolvedValueOnce({
      result: {
        latest: {
          version: "26.4.1406",
          releaseUrl: "https://example.test/releases/26.4.1406",
        },
        hasUpdate: true,
      },
    })
    mocks.request.mockResolvedValueOnce({
      result: {
        status: "up-to-date",
        currentVersion: "26.4.1405",
      },
    })

    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledWith("getUpdateInfo", undefined)
    })

    await act(async () => {
      await result.current.checkForUpdates()
    })

    expect(mocks.request).toHaveBeenLastCalledWith("checkForUpdates", undefined)
    expect(mocks.showToast).toHaveBeenCalledWith("已是最新版")
    expect(result.current.lastCheckMessage).toBe("已是最新版")
    expect(result.current.isChecking).toBe(false)
    expect(result.current.confirmOpen).toBe(false)
    expect(result.current.confirmVersion).toBe(null)
  })

  it("JetBrains 返回 unsupported 时提示仅 Marketplace 安装版支持", async () => {
    mocks.request.mockResolvedValueOnce({
      result: {
        supported: false,
        reason: "marketplace-only",
        latest: null,
        hasUpdate: false,
      },
    })
    mocks.request.mockResolvedValueOnce({
      result: {
        status: "unsupported",
        reason: "marketplace-only",
        currentVersion: "26.5.501",
      },
    })

    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledWith("getUpdateInfo", undefined)
    })

    await act(async () => {
      await result.current.checkForUpdates()
    })

    expect(mocks.showToast).toHaveBeenCalledWith("当前安装包不支持站内更新，请使用 JetBrains Marketplace 安装版")
    expect(result.current.lastCheckMessage).toBe("当前安装包不支持站内更新，请使用 JetBrains Marketplace 安装版")
    expect(result.current.status).toBe("idle")
    expect(result.current.confirmOpen).toBe(false)
    expect(result.current.confirmVersion).toBe(null)
    expect(result.current.latest).toBe(null)
  })

  it("手动检查更新发现新版本时会记录 latest 并等待确认", async () => {
    mocks.request.mockResolvedValueOnce({
      result: {
        latest: {
          version: "26.4.1406",
          releaseUrl: "https://example.test/releases/26.4.1406",
        },
        hasUpdate: true,
      },
    })
    mocks.request.mockResolvedValueOnce({
      result: {
        status: "available",
        latest: {
          version: "26.4.1407",
          releaseUrl: "https://example.test/releases/26.4.1407",
          notes: "new",
        },
      },
    })

    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledWith("getUpdateInfo", undefined)
    })

    await act(async () => {
      await result.current.checkForUpdates()
    })

    expect(result.current.latest).toEqual({
      version: "26.4.1407",
      releaseUrl: "https://example.test/releases/26.4.1407",
      notes: "new",
      publishedAt: undefined,
      vsixUrl: undefined,
    })
    expect(result.current.status).toBe("available")
    expect(result.current.lastCheckMessage).toBe("发现新版本 26.4.1407")
    expect(result.current.confirmOpen).toBe(true)
    expect(result.current.confirmVersion).toBe("26.4.1407")
    expect(mocks.showToast).not.toHaveBeenCalled()
  })

  it("手动更新结果会记录 latest.manualUpdate，但手动检查后不打开确认框", async () => {
    mocks.request.mockResolvedValueOnce({
      result: {
        latest: {
          version: "26.4.1406",
          releaseUrl: "https://example.test/releases/26.4.1406",
        },
        hasUpdate: true,
      },
    })
    mocks.request.mockResolvedValueOnce({
      result: {
        status: "available",
        latest: {
          version: "26.4.1407",
          manualUpdate: true,
          releaseUrl: "https://example.test/releases/26.4.1407",
        },
      },
    })
    mocks.request.mockResolvedValueOnce({ result: undefined })

    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledWith("getUpdateInfo", undefined)
    })

    await act(async () => {
      await result.current.checkForUpdates()
    })

    expect(result.current.latest).toEqual({
      version: "26.4.1407",
      manualUpdate: true,
      releaseUrl: "https://example.test/releases/26.4.1407",
      notes: undefined,
      publishedAt: undefined,
      vsixUrl: undefined,
    })
    expect(result.current.status).toBe("available")
    expect(result.current.confirmOpen).toBe(false)
    expect(result.current.confirmVersion).toBe(null)
  })

  it("旧确认框已打开时，手动更新检查结果会关闭确认框", async () => {
    mocks.request.mockResolvedValueOnce({
      result: {
        latest: {
          version: "26.4.1406",
          releaseUrl: "https://example.test/releases/26.4.1406",
        },
        hasUpdate: true,
      },
    })
    mocks.request.mockResolvedValueOnce({
      result: {
        status: "available",
        latest: {
          version: "26.4.1407",
          releaseUrl: "https://example.test/releases/26.4.1407",
        },
      },
    })
    mocks.request.mockResolvedValueOnce({
      result: {
        status: "available",
        latest: {
          version: "26.4.1407",
          manualUpdate: true,
          releaseUrl: "https://example.test/releases/26.4.1407",
        },
      },
    })

    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledWith("getUpdateInfo", undefined)
    })

    await act(async () => {
      await result.current.checkForUpdates()
    })

    expect(result.current.confirmOpen).toBe(true)
    expect(result.current.confirmVersion).toBe("26.4.1407")

    await act(async () => {
      await result.current.checkForUpdates()
    })

    expect(result.current.latest).toEqual({
      version: "26.4.1407",
      manualUpdate: true,
      releaseUrl: "https://example.test/releases/26.4.1407",
      notes: undefined,
      publishedAt: undefined,
      vsixUrl: undefined,
    })
    expect(result.current.status).toBe("available")
    expect(result.current.confirmOpen).toBe(false)
    expect(result.current.confirmVersion).toBe(null)
  })

  it("手动更新安装时不会调用 installUpdate bridge，而是打开插件管理页面", async () => {
    mocks.request.mockResolvedValueOnce({
      result: {
        latest: {
          version: "26.4.1406",
          releaseUrl: "https://example.test/releases/26.4.1406",
        },
        hasUpdate: true,
      },
    })
    mocks.request.mockResolvedValueOnce({
      result: {
        status: "available",
        latest: {
          version: "26.4.1407",
          manualUpdate: true,
          releaseUrl: "https://example.test/releases/26.4.1407",
        },
      },
    })
    mocks.request.mockResolvedValueOnce({ result: undefined })

    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledWith("getUpdateInfo", undefined)
    })

    await act(async () => {
      await result.current.checkForUpdates()
    })

    await act(async () => {
      await result.current.installUpdate("26.4.1407")
    })

    expect(mocks.request).toHaveBeenLastCalledWith("openPluginManager", { version: "26.4.1407" })
    expect(mocks.request).not.toHaveBeenCalledWith("installUpdate", { version: "26.4.1407" })
    expect(mocks.showToast).toHaveBeenCalledWith("请在 JetBrains 插件管理页面完成更新")
    expect(result.current.status).toBe("available")
  })

  it("手动更新打开插件管理页面失败时提示手动打开 Settings | Plugins", async () => {
    mocks.request.mockResolvedValueOnce({
      result: {
        latest: {
          version: "26.4.1406",
          releaseUrl: "https://example.test/releases/26.4.1406",
        },
        hasUpdate: true,
      },
    })
    mocks.request.mockResolvedValueOnce({
      result: {
        status: "available",
        latest: {
          version: "26.4.1407",
          manualUpdate: true,
          releaseUrl: "https://example.test/releases/26.4.1407",
        },
      },
    })
    mocks.request.mockRejectedValueOnce(new Error("open failed"))

    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledWith("getUpdateInfo", undefined)
    })

    await act(async () => {
      await result.current.checkForUpdates()
    })

    await act(async () => {
      await result.current.installUpdate("26.4.1407")
    })

    expect(mocks.request).toHaveBeenLastCalledWith("openPluginManager", { version: "26.4.1407" })
    expect(mocks.request).not.toHaveBeenCalledWith("installUpdate", { version: "26.4.1407" })
    expect(mocks.showToast).toHaveBeenCalledWith("无法打开插件管理页面，请手动打开 Settings | Plugins")
    expect(result.current.status).toBe("available")
  })

  it("手动更新标记在 bridge 事件 merge 时会保留", async () => {
    mocks.request.mockResolvedValueOnce({
      result: {
        latest: {
          version: "26.4.1407",
          manualUpdate: true,
          releaseUrl: "https://example.test/releases/26.4.1407",
        },
        hasUpdate: true,
      },
    })

    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(result.current.latest).toEqual({
        version: "26.4.1407",
        manualUpdate: true,
        releaseUrl: "https://example.test/releases/26.4.1407",
        notes: undefined,
        publishedAt: undefined,
        vsixUrl: undefined,
      })
    })

    act(() => {
      mocks.emit({
        type: "error",
        payload: {
          version: "26.4.1407",
          notes: "keep manual flag",
        },
      })
    })

    expect(result.current.latest).toEqual({
      version: "26.4.1407",
      manualUpdate: true,
      releaseUrl: "https://example.test/releases/26.4.1407",
      notes: "keep manual flag",
      publishedAt: undefined,
      vsixUrl: undefined,
    })
    expect(result.current.status).toBe("error")
  })

  it("确认框已打开时收到新的 updateAvailable 事件会关闭旧确认态并切到新版本", async () => {
    mocks.request.mockResolvedValueOnce({
      result: {
        latest: {
          version: "26.4.1406",
          releaseUrl: "https://example.test/releases/26.4.1406",
        },
        hasUpdate: true,
      },
    })
    mocks.request.mockResolvedValueOnce({
      result: {
        status: "available",
        latest: {
          version: "26.4.1407",
          releaseUrl: "https://example.test/releases/26.4.1407",
        },
      },
    })

    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledWith("getUpdateInfo", undefined)
    })

    await act(async () => {
      await result.current.checkForUpdates()
    })

    expect(result.current.confirmOpen).toBe(true)
    expect(result.current.confirmVersion).toBe("26.4.1407")

    act(() => {
      mocks.emit({
        type: "updateAvailable",
        payload: {
          version: "26.4.1408",
          releaseUrl: "https://example.test/releases/26.4.1408",
        },
      })
    })

    expect(result.current.confirmOpen).toBe(false)
    expect(result.current.confirmVersion).toBe(null)
    expect(result.current.latest).toEqual({
      version: "26.4.1408",
      releaseUrl: "https://example.test/releases/26.4.1408",
      notes: undefined,
      publishedAt: undefined,
      vsixUrl: undefined,
      manualUpdate: undefined,
    })
    expect(result.current.status).toBe("available")
  })

  it("manual-check 时会提示手动检查更新并隐藏 Banner", async () => {
    mocks.request.mockResolvedValueOnce({
      result: {
        latest: {
          version: "26.4.1406",
          releaseUrl: "https://example.test/releases/26.4.1406",
        },
        hasUpdate: true,
      },
    })
    mocks.request.mockResolvedValueOnce({
      result: {
        status: "manual-check",
        currentVersion: "26.4.1405",
        reason: "marketplace-unavailable",
      },
    })

    function TestHarness({ onUpdate }: { onUpdate: (u: ReturnType<typeof useUpdate>) => void }) {
      const update = useUpdate()
      onUpdate(update)
      return <UpdateBanner />
    }

    let updateRef: ReturnType<typeof useUpdate> | null = null
    render(
      <UpdateProvider>
        <TestHarness
          onUpdate={(update) => {
            updateRef = update
          }}
        />
      </UpdateProvider>,
    )

    await waitFor(() => {
      expect(updateRef?.status).toBe("available")
    })
    expect(screen.getByRole("status")).toBeInTheDocument()

    await act(async () => {
      await updateRef!.checkForUpdates()
    })

    expect(mocks.showToast).toHaveBeenCalledWith("无法确认最新版本，请到 JetBrains 插件管理页面手动检查更新")
    expect(updateRef!.lastCheckMessage).toBe("无法确认最新版本，请到 JetBrains 插件管理页面手动检查更新")
    expect(updateRef!.status).toBe("idle")
    expect(updateRef!.latest).toBe(null)
    expect(updateRef!.confirmOpen).toBe(false)
    expect(updateRef!.confirmVersion).toBe(null)
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("手动打开确认态后收到 downloading 事件会关闭确认态", async () => {
    mocks.request.mockResolvedValueOnce({
      result: {
        latest: {
          version: "26.4.1406",
          releaseUrl: "https://example.test/releases/26.4.1406",
        },
        hasUpdate: true,
      },
    })
    mocks.request.mockResolvedValueOnce({
      result: {
        status: "available",
        latest: {
          version: "26.4.1407",
          releaseUrl: "https://example.test/releases/26.4.1407",
        },
      },
    })

    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledWith("getUpdateInfo", undefined)
    })

    await act(async () => {
      await result.current.checkForUpdates()
    })

    expect(result.current.confirmOpen).toBe(true)
    expect(result.current.confirmVersion).toBe("26.4.1407")

    act(() => {
      mocks.emit({
        type: "downloading",
        payload: { version: "26.4.1407" },
      })
    })

    expect(result.current.status).toBe("downloading")
    expect(result.current.confirmOpen).toBe(false)
    expect(result.current.confirmVersion).toBe(null)
  })

  it("直接调用 installUpdate() 会关闭确认态", async () => {
    mocks.request.mockResolvedValueOnce({
      result: {
        latest: {
          version: "26.4.1406",
          releaseUrl: "https://example.test/releases/26.4.1406",
        },
        hasUpdate: true,
      },
    })
    mocks.request.mockResolvedValueOnce({
      result: {
        status: "available",
        latest: {
          version: "26.4.1407",
          releaseUrl: "https://example.test/releases/26.4.1407",
        },
      },
    })
    mocks.request.mockResolvedValueOnce({ result: undefined })

    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledWith("getUpdateInfo", undefined)
    })

    await act(async () => {
      await result.current.checkForUpdates()
    })

    expect(result.current.confirmOpen).toBe(true)
    expect(result.current.confirmVersion).toBe("26.4.1407")

    await act(async () => {
      await result.current.installUpdate("26.4.1407")
    })

    expect(result.current.status).toBe("downloading")
    expect(result.current.confirmOpen).toBe(false)
    expect(result.current.confirmVersion).toBe(null)
  })

  it("手动检查更新失败时会提示失败 toast", async () => {
    mocks.request.mockResolvedValueOnce({
      result: {
        latest: {
          version: "26.4.1406",
          releaseUrl: "https://example.test/releases/26.4.1406",
        },
        hasUpdate: true,
      },
    })
    mocks.request.mockRejectedValueOnce(new Error("network failed"))

    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledWith("getUpdateInfo", undefined)
    })

    await act(async () => {
      await result.current.checkForUpdates()
    })

    expect(mocks.request).toHaveBeenLastCalledWith("checkForUpdates", undefined)
    expect(mocks.showToast).toHaveBeenCalledWith("检查更新失败，请稍后重试")
    expect(result.current.lastCheckMessage).toBe("检查更新失败，请稍后重试")
    expect(result.current.isChecking).toBe(false)
  })

  it("checkForUpdates 返回未知成功结果时会显示失败兜底", async () => {
    mocks.request.mockResolvedValueOnce({
      result: {
        latest: {
          version: "26.4.1406",
          releaseUrl: "https://example.test/releases/26.4.1406",
        },
        hasUpdate: true,
      },
    })
    mocks.request.mockResolvedValueOnce({
      result: {
        status: "unexpected",
      },
    })

    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledWith("getUpdateInfo", undefined)
    })

    await act(async () => {
      await result.current.checkForUpdates()
    })

    expect(mocks.showToast).toHaveBeenCalledWith("检查更新失败，请稍后重试")
    expect(result.current.lastCheckMessage).toBe("检查更新失败，请稍后重试")
    expect(result.current.status).toBe("idle")
    expect(result.current.latest).toBe(null)
    expect(result.current.confirmOpen).toBe(false)
    expect(result.current.confirmVersion).toBe(null)
    expect(result.current.isChecking).toBe(false)
  })

  it("available 但 latest 非法时会提示失败并清理确认态", async () => {
    mocks.request.mockResolvedValueOnce({
      result: {
        latest: {
          version: "26.4.1406",
          releaseUrl: "https://example.test/releases/26.4.1406",
        },
        hasUpdate: true,
      },
    })
    mocks.request.mockResolvedValueOnce({
      result: {
        status: "available",
        latest: {
          version: "26.4.1407",
          releaseUrl: "https://example.test/releases/26.4.1407",
        },
      },
    })
    mocks.request.mockResolvedValueOnce({
      result: {
        status: "available",
        latest: {
          version: 1408,
        },
      },
    })

    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledWith("getUpdateInfo", undefined)
    })

    await act(async () => {
      await result.current.checkForUpdates()
    })

    expect(result.current.confirmOpen).toBe(true)
    expect(result.current.confirmVersion).toBe("26.4.1407")

    await act(async () => {
      await result.current.checkForUpdates()
    })

    expect(mocks.showToast).toHaveBeenCalledWith("检查更新失败，请稍后重试")
    expect(result.current.lastCheckMessage).toBe("检查更新失败，请稍后重试")
    expect(result.current.confirmOpen).toBe(false)
    expect(result.current.confirmVersion).toBe(null)
    expect(result.current.isChecking).toBe(false)
  })

  it("用户确认后会调用 installUpdate(version)", async () => {
    mocks.request.mockResolvedValueOnce({
      result: {
        latest: {
          version: "26.4.1406",
          releaseUrl: "https://example.test/releases/26.4.1406",
        },
        hasUpdate: true,
      },
    })
    mocks.request.mockResolvedValueOnce({
      result: {
        status: "available",
        latest: {
          version: "26.4.1407",
          releaseUrl: "https://example.test/releases/26.4.1407",
        },
      },
    })
    mocks.request.mockResolvedValueOnce({ result: undefined })

    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(mocks.request).toHaveBeenCalledWith("getUpdateInfo", undefined)
    })

    await act(async () => {
      await result.current.checkForUpdates()
    })

    await act(async () => {
      await result.current.confirmInstall()
    })

    expect(mocks.request).toHaveBeenLastCalledWith("installUpdate", { version: "26.4.1407" })
    expect(result.current.confirmOpen).toBe(false)
    expect(result.current.confirmVersion).toBe(null)
    expect(result.current.status).toBe("downloading")
  })

  it("dismissUpdate 后 dismissed 为 true 且持久化到 scopedStorage", async () => {
    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(result.current.latest?.version).toBe("26.4.1406")
      expect(result.current.status).toBe("available")
    })

    act(() => {
      result.current.dismissUpdate()
    })

    expect(result.current.dismissed).toBe(true)
    expect(mocks.scopedStateSetJSON).toHaveBeenCalledWith("global", "update.dismissedVersion", "26.4.1406")
  })

  it("dismissed 状态下 Banner 不显示", async () => {
    function TestHarness({ onUpdate }: { onUpdate: (u: ReturnType<typeof useUpdate>) => void }) {
      const update = useUpdate()
      onUpdate(update)
      return <UpdateBanner />
    }

    let updateRef: ReturnType<typeof useUpdate> | null = null
    const { rerender } = render(
      <UpdateProvider>
        <TestHarness
          onUpdate={(u) => {
            updateRef = u
          }}
        />
      </UpdateProvider>,
    )

    await waitFor(() => {
      expect(updateRef?.status).toBe("available")
    })
    expect(screen.getByRole("status")).toBeInTheDocument()

    act(() => {
      updateRef!.dismissUpdate()
    })

    rerender(
      <UpdateProvider>
        <TestHarness
          onUpdate={(u) => {
            updateRef = u
          }}
        />
      </UpdateProvider>,
    )

    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  it("dismissed 版本与新版本不同时 Banner 重新显示", async () => {
    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(result.current.latest?.version).toBe("26.4.1406")
    })

    act(() => {
      result.current.dismissUpdate()
    })

    expect(result.current.dismissed).toBe(true)

    act(() => {
      mocks.emit({
        type: "updateAvailable",
        payload: { version: "26.4.1407" },
      })
    })

    expect(result.current.latest?.version).toBe("26.4.1407")
    expect(result.current.dismissed).toBe(false)
  })

  it("手动检查更新会清除 dismissed 状态", async () => {
    mocks.request.mockResolvedValueOnce({
      result: {
        latest: {
          version: "26.4.1406",
          releaseUrl: "https://example.test/releases/26.4.1406",
        },
        hasUpdate: true,
      },
    })
    mocks.request.mockResolvedValueOnce({
      result: {
        status: "available",
        latest: {
          version: "26.4.1406",
          releaseUrl: "https://example.test/releases/26.4.1406",
        },
      },
    })

    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(result.current.status).toBe("available")
    })

    act(() => {
      result.current.dismissUpdate()
    })

    expect(result.current.dismissed).toBe(true)

    await act(async () => {
      await result.current.checkForUpdates()
    })

    expect(result.current.dismissed).toBe(false)
    expect(mocks.scopedStateSetJSON).toHaveBeenCalledWith("global", "update.dismissedVersion", null)
  })

  it("installUpdate 会清除 dismissed 状态", async () => {
    mocks.request.mockResolvedValueOnce({
      result: {
        latest: {
          version: "26.4.1406",
          releaseUrl: "https://example.test/releases/26.4.1406",
        },
        hasUpdate: true,
      },
    })
    mocks.request.mockResolvedValueOnce({ result: undefined })

    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(result.current.status).toBe("available")
    })

    act(() => {
      result.current.dismissUpdate()
    })

    expect(result.current.dismissed).toBe(true)

    await act(async () => {
      await result.current.installUpdate("26.4.1406")
    })

    expect(result.current.dismissed).toBe(false)
    expect(result.current.status).toBe("downloading")
  })

  it("初始化时从 scopedStorage 恢复 dismissedVersion", async () => {
    mocks.scopedStateGetJSON.mockResolvedValueOnce("26.4.1406")

    const { result } = renderHook(() => useUpdate(), { wrapper })

    await waitFor(() => {
      expect(result.current.latest?.version).toBe("26.4.1406")
    })

    expect(result.current.dismissed).toBe(true)
  })
})
