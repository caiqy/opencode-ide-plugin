import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  useSettingsForm: vi.fn(),
  useUnsavedChanges: vi.fn(),
  globalConfigUpdate: vi.fn(),
  authSet: vi.fn(),
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
        update: (...args: unknown[]) => mocks.globalConfigUpdate(...args),
      },
    },
    auth: {
      set: (...args: unknown[]) => mocks.authSet(...args),
    },
  },
}))

import { SettingsPanel } from "./index"

describe("SettingsPanel", () => {
  beforeEach(() => {
    mocks.globalConfigUpdate.mockResolvedValue({ data: {}, error: null })
    mocks.authSet.mockResolvedValue(undefined)

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
