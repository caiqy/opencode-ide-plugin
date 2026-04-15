import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "../test/test-utils"

const mocks = vi.hoisted(() => ({
  installUpdate: vi.fn(),
  openRelease: vi.fn(),
  update: {
    currentVersion: "26.4.1405",
    latest: {
      version: "26.4.1406",
      releaseUrl: "https://example.test/releases/26.4.1406",
    } as { version: string; releaseUrl?: string },
    status: "available" as "available" | "downloading" | "installing" | "success" | "error" | "idle",
  },
}))

vi.mock("../state/UpdateContext", () => ({
  useUpdate: () => ({
    currentVersion: mocks.update.currentVersion,
    latest: mocks.update.latest,
    status: mocks.update.status,
    installUpdate: mocks.installUpdate,
    openRelease: mocks.openRelease,
  }),
}))

import { UpdateBanner } from "./UpdateBanner"

describe("UpdateBanner", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.update.currentVersion = "26.4.1405"
    mocks.update.latest = {
      version: "26.4.1406",
      releaseUrl: "https://example.test/releases/26.4.1406",
    }
    mocks.update.status = "available"
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

    expect(screen.getByText("更新已安装完成，请重载 VSCode"))
    expect(screen.getByText("状态：安装完成，请重载 VSCode")).toBeInTheDocument()
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
})
