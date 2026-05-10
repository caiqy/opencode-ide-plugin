import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "../test/test-utils"

const bridge = vi.hoisted(() => ({
  restartMode: "window" as "window" | "ide" | null,
}))

const mocks = vi.hoisted(() => ({
  installUpdate: vi.fn(),
  openRelease: vi.fn(),
  dismissUpdate: vi.fn(),
  update: {
    currentVersion: "26.4.1405",
    latest: {
      version: "26.4.1406",
      releaseUrl: "https://example.test/releases/26.4.1406",
    } as { version: string; releaseUrl?: string; manualUpdate?: boolean },
    status: "available" as "available" | "downloading" | "installing" | "success" | "error" | "idle",
    dismissed: false,
  },
}))

vi.mock("../lib/ideBridge", () => ({
  ideBridge: bridge,
}))

vi.mock("../state/UpdateContext", () => ({
  useUpdate: () => ({
    currentVersion: mocks.update.currentVersion,
    latest: mocks.update.latest,
    status: mocks.update.status,
    dismissed: mocks.update.dismissed,
    installUpdate: mocks.installUpdate,
    openRelease: mocks.openRelease,
    dismissUpdate: mocks.dismissUpdate,
  }),
}))

import { UpdateBanner } from "./UpdateBanner"

describe("UpdateBanner", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    bridge.restartMode = "window"
    mocks.update.currentVersion = "26.4.1405"
    mocks.update.latest = {
      version: "26.4.1406",
      releaseUrl: "https://example.test/releases/26.4.1406",
    }
    mocks.update.status = "available"
    mocks.update.dismissed = false
  })

  it("能显示版本信息并响应按钮点击", async () => {
    const user = userEvent.setup()

    render(<UpdateBanner />)

    expect(screen.getByText("发现新版本可更新")).toBeInTheDocument()
    expect(screen.getByText("当前版本：26.4.1405")).toBeInTheDocument()
    expect(screen.getByText("最新版本：26.4.1406")).toBeInTheDocument()
    expect(screen.getByText("状态：待更新")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "立即更新" }))
    await user.click(screen.getByRole("button", { name: "查看 Release" }))

    expect(mocks.installUpdate).toHaveBeenCalledWith("26.4.1406")
    expect(mocks.openRelease).toHaveBeenCalledTimes(1)
  })

  it("installing 状态展示安装中并禁用立即更新按钮", () => {
    mocks.update.status = "installing"

    render(<UpdateBanner />)

    expect(screen.getByText("正在安装更新")).toBeInTheDocument()
    expect(screen.getByText("状态：安装中")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "立即更新" })).toBeDisabled()
  })

  it("success 状态展示安装已完成并提示重载 VSCode", () => {
    mocks.update.status = "success"

    render(<UpdateBanner />)

    expect(screen.getByText("更新已安装完成，请重载 VSCode")).toBeInTheDocument()
    expect(screen.getByText("状态：安装完成，请重载 VSCode")).toBeInTheDocument()
  })

  it("JetBrains success 状态提示按 IDE 提示重启", () => {
    bridge.restartMode = "ide"
    mocks.update.status = "success"

    render(<UpdateBanner />)

    expect(screen.getByText("更新已安装完成，请按 IDE 提示重启")).toBeInTheDocument()
    expect(screen.getByText("状态：安装完成，请按 IDE 提示重启")).toBeInTheDocument()
  })

  it("error 状态展示失败提示并允许重试", () => {
    mocks.update.status = "error"

    render(<UpdateBanner />)

    expect(screen.getByText("更新失败，请重试")).toBeInTheDocument()
    expect(screen.getByText("状态：更新失败")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "立即更新" })).not.toBeDisabled()
  })

  it("没有 releaseUrl 时不显示查看 Release 按钮", () => {
    mocks.update.latest = {
      version: "26.4.1406",
    }

    render(<UpdateBanner />)

    expect(screen.queryByRole("button", { name: "查看 Release" })).not.toBeInTheDocument()
  })

  it("显示暂不更新按钮并响应点击", async () => {
    const user = userEvent.setup()

    render(<UpdateBanner />)

    const btn = screen.getByRole("button", { name: "暂不更新" })
    expect(btn).toBeInTheDocument()
    expect(btn).not.toBeDisabled()

    await user.click(btn)
    expect(mocks.dismissUpdate).toHaveBeenCalledTimes(1)
  })

  it("manualUpdate 时显示打开插件管理按钮", () => {
    mocks.update.latest = {
      version: "26.4.1406",
      releaseUrl: "https://example.test/releases/26.4.1406",
      manualUpdate: true,
    }

    render(<UpdateBanner />)

    expect(screen.getByText("发现新版本，请到插件管理页面更新")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "打开插件管理" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "立即更新" })).not.toBeInTheDocument()
  })

  it("downloading/installing/success 时暂不更新按钮禁用", () => {
    for (const status of ["downloading", "installing", "success"] as const) {
      mocks.update.status = status

      const { unmount } = render(<UpdateBanner />)

      expect(screen.getByRole("button", { name: "暂不更新" })).toBeDisabled()
      unmount()
    }
  })

  it("error 时暂不更新按钮可点击", () => {
    mocks.update.status = "error"

    render(<UpdateBanner />)

    expect(screen.getByRole("button", { name: "暂不更新" })).not.toBeDisabled()
  })

  it("dismissed 为 true 时不渲染 Banner", () => {
    mocks.update.dismissed = true

    render(<UpdateBanner />)

    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })
})
