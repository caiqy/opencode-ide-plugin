import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { EditorToolbar } from "./EditorToolbar"

vi.mock("../AgentSelector", () => {
  return {
    AgentSelector: () => <div data-testid="agent-selector" />,
  }
})

vi.mock("../ModelSelector", () => {
  return {
    ModelSelector: () => <div data-testid="model-selector" />,
  }
})

vi.mock("../VariantSelector", () => {
  return {
    VariantSelector: () => <div data-testid="variant-selector" />,
  }
})

vi.mock("./MessageActions", () => {
  return {
    MessageActions: () => <div data-testid="message-actions" />,
  }
})

vi.mock("../../state/uiBridgeState", () => {
  return {
    uiBridgeUpdate: vi.fn(),
  }
})

describe("EditorToolbar", () => {
  it("重试与添加文件按钮文案为中文", () => {
    render(
      <EditorToolbar
        selectedProviderId="openai"
        selectedModelId="gpt-4.1"
        selectedAgent="build"
        onModelSelect={vi.fn()}
        onAgentSelect={vi.fn()}
        onFileSelect={vi.fn()}
        isDisabled={false}
        modelSelectorKey={0}
        lastFailedMessage="oops"
        onRetry={vi.fn()}
        fileInputRef={{ current: null } as any}
        onFileChange={vi.fn()}
        isIdle={true}
        isButtonDisabled={false}
        isCompactDisabled={false}
        onSubmit={vi.fn()}
        onAbort={vi.fn()}
        onCompactClick={vi.fn()}
        variants={["low"]}
        selectedVariant={undefined}
        onVariantSelect={vi.fn()}
        isReasoningModel={true}
      />,
    )

    const retry = screen.getByRole("button", { name: "重试" })
    expect(retry).toHaveAttribute("title", "恢复失败消息")
    expect(retry).toHaveAttribute("data-tip", "恢复失败消息")

    const addFile = screen.getByRole("button", { name: "添加文件" })
    expect(addFile).toHaveAttribute("title", "添加文件")
  })
})
