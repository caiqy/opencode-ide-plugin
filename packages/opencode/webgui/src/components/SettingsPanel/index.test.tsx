import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  useSettingsForm: vi.fn(),
  useUnsavedChanges: vi.fn(),
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

import { SettingsPanel } from "./index"

describe("SettingsPanel", () => {
  beforeEach(() => {
    mocks.useSettingsForm.mockReturnValue({
      formData: {},
      setFormData: vi.fn(),
      originalFormData: {},
      setOriginalFormData: vi.fn(),
      apiKeys: {},
      setApiKeys: vi.fn(),
      showApiKeys: {},
      setShowApiKeys: vi.fn(),
      providers: [],
      configuredProviders: [],
      setConfiguredProviders: vi.fn(),
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
})
