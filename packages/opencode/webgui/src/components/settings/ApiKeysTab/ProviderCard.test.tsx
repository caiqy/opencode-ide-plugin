import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import { ProviderCard } from "./ProviderCard"

function createBaseProps() {
  return {
    provider: { id: "openai", name: "OpenAI" } as any,
    isExpanded: true,
    isConnected: false,
    isTemporary: true,
    isLoading: false,
    methods: [
      { label: "OAuth", type: "oauth" as const },
      { label: "API Key", type: "api" as const },
    ],
    authStatus: "",
    authInstructions: undefined,
    manualCodeState: null,
    manualCodeInput: "",
    apiKey: "",
    showApiKey: false,
    onToggleExpand: vi.fn(),
    onDelete: vi.fn(),
    onOAuthLogin: vi.fn(),
    onCancelOAuth: vi.fn(),
    onManualCodeChange: vi.fn(),
    onManualCodeSubmit: vi.fn(),
    onManualCodeCancel: vi.fn(),
    onApiKeyChange: vi.fn(),
    onToggleApiKeyVisibility: vi.fn(),
  }
}

describe("ProviderCard", () => {
  it("展示中文状态与操作文案", () => {
    render(<ProviderCard {...createBaseProps()} />)

    expect(screen.getByText("新")).toBeInTheDocument()
    expect(screen.getByText("未配置")).toBeInTheDocument()
    expect(screen.getByTitle("移除提供方")).toBeInTheDocument()
    expect(screen.getByText("或使用 API Key")).toBeInTheDocument()
  })

  it("加载认证方式时显示中文提示", () => {
    render(<ProviderCard {...createBaseProps()} isLoading={true} />)

    expect(screen.getByText("正在加载认证方式…")).toBeInTheDocument()
  })
})
