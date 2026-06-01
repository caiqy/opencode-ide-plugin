import { beforeEach, describe, expect, it, vi } from "vitest"
import userEvent from "@testing-library/user-event"
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  useSettingsForm: vi.fn(),
  useUnsavedChanges: vi.fn(),
  globalConfigUpdate: vi.fn(),
  authSet: vi.fn(),
  appAgents: vi.fn(),
  configProviders: vi.fn(),
  globalConfigGet: vi.fn(),
  loadModelPrefs: vi.fn(),
  addRecentModel: vi.fn(),
  updateModelPrefs: vi.fn(),
}))

vi.mock("./hooks/useSettingsForm", () => ({
  useSettingsForm: (...args: unknown[]) => mocks.useSettingsForm(...args),
}))

vi.mock("./hooks/useUnsavedChanges", () => ({
  useUnsavedChanges: (...args: unknown[]) => mocks.useUnsavedChanges(...args),
}))

vi.mock("../../state/ProvidersContext.tsx", () => ({
  useProviders: () => ({
    markProvidersDirty: vi.fn(),
  }),
}))

vi.mock("../../state/IdeBridgeContext", () => ({
  useCustomApi: () => true,
}))

vi.mock("../../state/ProjectContext", () => ({
  useProject: () => ({
    worktree: "D:/repo",
  }),
}))

vi.mock("../../lib/api/sdkClient", () => ({
  sdk: {
    global: {
      config: {
        get: (...args: unknown[]) => mocks.globalConfigGet(...args),
        update: (...args: unknown[]) => mocks.globalConfigUpdate(...args),
      },
    },
    app: {
      agents: (...args: unknown[]) => mocks.appAgents(...args),
    },
    config: {
      providers: (...args: unknown[]) => mocks.configProviders(...args),
    },
    auth: {
      set: (...args: unknown[]) => mocks.authSet(...args),
    },
  },
}))

vi.mock("../../state/repo/modelPrefsRepo", () => ({
  loadModelPrefs: (...args: unknown[]) => mocks.loadModelPrefs(...args),
  addRecentModel: (...args: unknown[]) => mocks.addRecentModel(...args),
  updateModelPrefs: (...args: unknown[]) => mocks.updateModelPrefs(...args),
}))

import { SettingsPanel } from "./index"

describe("SettingsPanel", () => {
  beforeEach(() => {
    mocks.globalConfigUpdate.mockResolvedValue({ data: {}, error: null })
    mocks.globalConfigGet.mockResolvedValue({ data: {}, error: null })
    mocks.authSet.mockResolvedValue(undefined)
    mocks.appAgents.mockResolvedValue({
      data: [{ name: "build", mode: "primary", description: "Build agent" }],
      error: null,
    })
    mocks.configProviders.mockResolvedValue({
      data: {
        providers: [
          {
            id: "openai",
            name: "OpenAI",
            models: {
              "gpt-5.5": { name: "GPT-5.5", capabilities: {}, variants: {} },
            },
          },
        ],
        default: { provider: "openai", model: "gpt-5.5" },
      },
      error: null,
    })
    mocks.loadModelPrefs.mockResolvedValue({ recent: [], favorite: [] })
    mocks.addRecentModel.mockResolvedValue({ recent: [], favorite: [] })
    mocks.updateModelPrefs.mockResolvedValue({ recent: [], favorite: [] })

    mocks.useSettingsForm.mockReturnValue({
      formData: {},
      setFormData: vi.fn(),
      originalFormData: {},
      setOriginalFormData: vi.fn(),
      isLoading: true,
      error: null,
    })

    mocks.useUnsavedChanges.mockReturnValue({
      hasUnsavedChanges: () => false,
      showCloseConfirm: false,
      setShowCloseConfirm: vi.fn(),
    })
  })

  it("加载中时显示中文提示", () => {
    render(<SettingsPanel isOpen={true} onClose={vi.fn()} />)
    expect(screen.getByText("正在加载设置…")).toBeInTheDocument()
  })

  it("未保存更改确认弹窗为中文", () => {
    mocks.useUnsavedChanges.mockReturnValue({
      hasUnsavedChanges: () => true,
      showCloseConfirm: true,
      setShowCloseConfirm: vi.fn(),
    })

    render(<SettingsPanel isOpen={true} onClose={vi.fn()} />)

    expect(screen.getByText("未保存的更改")).toBeInTheDocument()
    expect(screen.getByText("有未保存的更改。确定要直接关闭且不保存吗？")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "放弃更改" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "继续编辑" })).toBeInTheDocument()
  })

  it("Escape 已被子弹层处理时不关闭设置面板", async () => {
    const onClose = vi.fn()
    const setShowCloseConfirm = vi.fn()
    mocks.useUnsavedChanges.mockReturnValue({
      hasUnsavedChanges: () => true,
      showCloseConfirm: false,
      setShowCloseConfirm,
    })

    render(<SettingsPanel isOpen={true} onClose={onClose} />)
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })
    event.preventDefault()
    document.dispatchEvent(event)

    expect(onClose).not.toHaveBeenCalled()
    expect(setShowCloseConfirm).not.toHaveBeenCalled()
  })

  it("模型选择器打开时 Escape 只关闭下拉不关闭设置面板", async () => {
    const onClose = vi.fn()
    const setShowCloseConfirm = vi.fn()
    mocks.useSettingsForm.mockReturnValue({
      formData: {},
      setFormData: vi.fn(),
      originalFormData: { agent: { build: { model: "openai/gpt-5.5" } } },
      setOriginalFormData: vi.fn(),
      isLoading: false,
      error: null,
    })
    mocks.useUnsavedChanges.mockReturnValue({
      hasUnsavedChanges: () => true,
      showCloseConfirm: false,
      setShowCloseConfirm,
    })

    render(<SettingsPanel isOpen={true} onClose={onClose} />)
    const user = userEvent.setup()
    await user.click(screen.getByRole("button", { name: /Agent 配置/ }))
    await waitFor(() => expect(screen.getByText("build")).toBeInTheDocument())
    const buildRow = screen.getByText("build").closest("tr")!
    await waitFor(() => expect(within(buildRow).getByTitle("选择模型")).not.toBeDisabled())
    await user.click(within(buildRow).getByTitle("选择模型"))
    expect(screen.getByPlaceholderText("搜索模型…")).toBeInTheDocument()

    await user.keyboard("{Escape}")

    await waitFor(() => expect(screen.queryByPlaceholderText("搜索模型…")).not.toBeInTheDocument())
    expect(onClose).not.toHaveBeenCalled()
    expect(setShowCloseConfirm).not.toHaveBeenCalled()
    expect(screen.queryByText("未保存的更改")).not.toBeInTheDocument()
  })

  it("保存设置走全局配置接口", async () => {
    const setFormData = vi.fn()
    const setOriginalFormData = vi.fn()
    mocks.useSettingsForm.mockReturnValue({
      formData: { snapshot: true },
      setFormData,
      originalFormData: { snapshot: false },
      setOriginalFormData,
      isLoading: false,
      error: null,
    })
    mocks.useUnsavedChanges.mockReturnValue({
      hasUnsavedChanges: () => true,
      showCloseConfirm: false,
      setShowCloseConfirm: vi.fn(),
    })

    render(<SettingsPanel isOpen={true} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }))

    await waitFor(() => {
      expect(mocks.globalConfigUpdate).toHaveBeenCalledWith({
        body: { snapshot: true },
      })
    })
    expect(mocks.authSet).not.toHaveBeenCalled()
  })

  it("清空 Agent 模型时发送完整 agent 配置以删除旧字段", async () => {
    const setFormData = vi.fn()
    const setOriginalFormData = vi.fn()
    mocks.useSettingsForm.mockReturnValue({
      formData: {
        agent: {
          build: { prompt: "custom prompt" },
        },
      },
      setFormData,
      originalFormData: {
        agent: {
          build: { model: "openai/gpt-5.5", prompt: "custom prompt" },
        },
      },
      setOriginalFormData,
      isLoading: false,
      error: null,
    })
    mocks.useUnsavedChanges.mockReturnValue({
      hasUnsavedChanges: () => true,
      showCloseConfirm: false,
      setShowCloseConfirm: vi.fn(),
    })

    render(<SettingsPanel isOpen={true} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }))

    await waitFor(() => {
      expect(mocks.globalConfigUpdate).toHaveBeenCalledWith({
        body: {
          agent: {
            build: { prompt: "custom prompt" },
          },
        },
      })
    })
  })

  it("设置中不再显示 API 密钥与模型标签页", () => {
    mocks.useSettingsForm.mockReturnValue({
      formData: {},
      setFormData: vi.fn(),
      originalFormData: {},
      setOriginalFormData: vi.fn(),
      isLoading: false,
      error: null,
    })

    render(<SettingsPanel isOpen={true} onClose={vi.fn()} />)

    expect(screen.queryByRole("button", { name: /API\s*密钥/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /模型/ })).not.toBeInTheDocument()
  })

  it("可以切换到快捷短语标签页", async () => {
    mocks.useSettingsForm.mockReturnValue({
      formData: {},
      setFormData: vi.fn(),
      originalFormData: {},
      setOriginalFormData: vi.fn(),
      isLoading: false,
      error: null,
    })

    render(<SettingsPanel isOpen={true} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: /快捷短语/ }))
    await waitFor(() => {
      expect(screen.getByText("快捷短语设置")).toBeInTheDocument()
    })
  })
})
