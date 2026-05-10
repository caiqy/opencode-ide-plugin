import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"

import { ActionButtons } from "./ActionButtons"

function renderButtons(overrides: Partial<ComponentProps<typeof ActionButtons>> = {}) {
  const defaults = {
    theme: "light",
    toggleTheme: vi.fn(),
    onOpenCommandPalette: vi.fn(),
    onOpenSettings: vi.fn(),
    onOpenConfigFile: vi.fn(),
    onNewSession: vi.fn(),
    onToggleHistory: vi.fn(),
    isCreatingSession: false,
    isShared: false,
    isSharing: false,
    onToggleShare: vi.fn(),
  }
  const props: ComponentProps<typeof ActionButtons> = { ...defaults, ...overrides }
  return { ...render(<ActionButtons {...props} />), props }
}

describe("CompactHeader/ActionButtons", () => {
  beforeEach(() => {
    Reflect.set(globalThis, "__APP_VERSION__", "test")
  })

  it("按钮 tooltip 为中文", () => {
    renderButtons()

    expect(screen.getByTitle("新建会话（Cmd/Ctrl+N）")).toBeInTheDocument()
    expect(screen.getByTitle("历史会话")).toBeInTheDocument()
    expect(screen.getByTitle("更多选项")).toBeInTheDocument()
  })

  it("菜单项文案为中文", async () => {
    const user = userEvent.setup()
    renderButtons()

    await user.click(screen.getByTitle("更多选项"))

    expect(screen.getByText("深色模式")).toBeInTheDocument()
    expect(screen.getByText("命令面板")).toBeInTheDocument()
    expect(screen.getByText("配置文件")).toBeInTheDocument()
    expect(screen.getByText("设置")).toBeInTheDocument()
    expect(screen.getByText("分享会话")).toBeInTheDocument()
  })

  it("已分享会话时显示取消分享会话", async () => {
    const user = userEvent.setup()
    renderButtons({ isShared: true })

    await user.click(screen.getByTitle("更多选项"))
    expect(screen.getByText("取消分享会话")).toBeInTheDocument()
  })

  it("配置文件菜单项显示在设置上方", async () => {
    const user = userEvent.setup()
    renderButtons()

    await user.click(screen.getByTitle("更多选项"))

    const configItem = screen.getByText("配置文件").closest("button")!
    const settingsItem = screen.getByText("设置").closest("button")!
    // DOCUMENT_POSITION_FOLLOWING means configItem comes before settingsItem in DOM
    expect(configItem.compareDocumentPosition(settingsItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("支持重启时显示重启插件且位于配置文件下方", async () => {
    const user = userEvent.setup()
    const onRestart = vi.fn()
    renderButtons({ canRestart: true, onRestart })

    await user.click(screen.getByTitle("更多选项"))

    const configItem = screen.getByText("配置文件").closest("button")!
    const restartItem = screen.getByText("重启插件").closest("button")!
    expect(configItem.compareDocumentPosition(restartItem) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.click(screen.getByText("重启插件"))
    expect(onRestart).toHaveBeenCalledOnce()
  })

  it("不支持重启时不显示重启插件", async () => {
    const user = userEvent.setup()
    renderButtons({ canRestart: false })

    await user.click(screen.getByTitle("更多选项"))
    expect(screen.queryByText("重启插件")).not.toBeInTheDocument()
  })

  it("点击配置文件触发 onOpenConfigFile", async () => {
    const user = userEvent.setup()
    const onOpenConfigFile = vi.fn()
    renderButtons({ onOpenConfigFile })

    await user.click(screen.getByTitle("更多选项"))
    await user.click(screen.getByText("配置文件"))

    expect(onOpenConfigFile).toHaveBeenCalledOnce()
  })

  it("受控模式下通过 onMenuOpenChange 切换更多菜单", async () => {
    const user = userEvent.setup()
    const onMenuOpenChange = vi.fn()
    renderButtons({ menuOpen: false, onMenuOpenChange })

    await user.click(screen.getByTitle("更多选项"))
    expect(onMenuOpenChange).toHaveBeenCalledWith(true)
  })

  it("版本号右侧显示检查更新按钮", async () => {
    const user = userEvent.setup()
    renderButtons({ onCheckForUpdates: vi.fn() })

    await user.click(screen.getByTitle("更多选项"))

    const versionRow = screen.getByText("vtest").parentElement
    expect(versionRow).toBeTruthy()
    expect(screen.getByTitle("检查更新")).toBeInTheDocument()
    expect(versionRow).toContainElement(screen.getByTitle("检查更新"))
  })

  it("点击检查更新按钮时触发 onCheckForUpdates", async () => {
    const user = userEvent.setup()
    const onCheckForUpdates = vi.fn()
    renderButtons({ onCheckForUpdates })

    await user.click(screen.getByTitle("更多选项"))
    await user.click(screen.getByTitle("检查更新"))

    expect(onCheckForUpdates).toHaveBeenCalledOnce()
  })

  it("checking 时检查更新按钮禁用", async () => {
    const user = userEvent.setup()
    renderButtons({ onCheckForUpdates: vi.fn(), isCheckingForUpdates: true })

    await user.click(screen.getByTitle("更多选项"))

    expect(screen.getByTitle("检查更新")).toBeDisabled()
  })

  it("检查更新完成后不在版本区域显示结果", async () => {
    const user = userEvent.setup()
    renderButtons({ onCheckForUpdates: vi.fn() })

    await user.click(screen.getByTitle("更多选项"))

    expect(screen.queryByText("已是最新版")).not.toBeInTheDocument()
  })
})
