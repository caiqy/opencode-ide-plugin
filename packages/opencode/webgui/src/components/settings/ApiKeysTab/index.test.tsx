import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  useProviders: vi.fn(),
  useDropdown: vi.fn(),
  useApiKeys: vi.fn(),
  useOAuthFlow: vi.fn(),
  useProviderManagement: vi.fn(),
}))

vi.mock("../../../state/ProvidersContext", () => ({
  useProviders: (...args: unknown[]) => mocks.useProviders(...args),
}))

vi.mock("../../../hooks/useDropdown", () => ({
  useDropdown: (...args: unknown[]) => mocks.useDropdown(...args),
}))

vi.mock("./hooks/useApiKeys", () => ({
  useApiKeys: (...args: unknown[]) => mocks.useApiKeys(...args),
}))

vi.mock("./hooks/useOAuthFlow", () => ({
  useOAuthFlow: (...args: unknown[]) => mocks.useOAuthFlow(...args),
}))

vi.mock("./hooks/useProviderManagement", () => ({
  useProviderManagement: (...args: unknown[]) => mocks.useProviderManagement(...args),
}))

vi.mock("./ProviderDropdown", () => ({
  ProviderDropdown: () => <div data-testid="provider-dropdown" />,
}))

vi.mock("./ProviderCard", () => ({
  ProviderCard: () => <div data-testid="provider-card" />,
}))

vi.mock("./EmptyState", () => ({
  EmptyState: () => <div data-testid="empty-state" />,
}))

import { ApiKeysTab } from "./index"

describe("ApiKeysTab", () => {
  beforeEach(() => {
    mocks.useProviders.mockReturnValue({ markProvidersDirty: vi.fn() })
    mocks.useDropdown.mockReturnValue({
      isOpen: false,
      searchTerm: "",
      setSearchTerm: vi.fn(),
      dropdownRef: { current: null },
      close: vi.fn(),
      toggle: vi.fn(),
    })
    mocks.useApiKeys.mockReturnValue({ methods: {}, loadingMethods: {} })
    mocks.useOAuthFlow.mockReturnValue({
      authStatus: {},
      authInstructions: {},
      manualCodeState: null,
      manualCodeInput: "",
      setManualCodeInput: vi.fn(),
      handleOAuthLogin: vi.fn(),
      handleCancel: vi.fn(),
      handleManualCodeSubmit: vi.fn(),
    })
    mocks.useProviderManagement.mockReturnValue({
      expandedProvider: null,
      setExpandedProvider: vi.fn(),
      providerToDelete: "openai",
      setProviderToDelete: vi.fn(),
      isDeleting: false,
      handleAddProvider: vi.fn(),
      handleDeleteProvider: vi.fn(),
      confirmDeleteProvider: vi.fn(),
    })
  })

  it("说明与删除确认文案为中文", () => {
    render(
      <ApiKeysTab
        providers={[]}
        configuredProviders={[]}
        setConfiguredProviders={vi.fn()}
        apiKeys={{}}
        setApiKeys={vi.fn()}
        showApiKeys={{}}
        setShowApiKeys={vi.fn()}
      />,
    )

    expect(screen.getByText("配置 API Key 或登录 AI 提供方。密钥会被安全存储。")).toBeInTheDocument()
    expect(screen.getByText("移除提供方")).toBeInTheDocument()
    expect(screen.getByText("确定要移除 openai 吗？这会删除已存储的认证令牌。")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "移除" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument()
  })
})
