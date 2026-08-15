import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { EditorToolbar } from "./EditorToolbar"

vi.mock("../AgentSelector", () => {
  return {
    AgentSelector: () => <div data-testid="agent-selector">Agent</div>,
  }
})

vi.mock("../ModelSelector", () => {
  return {
    ModelSelector: ({ renderInPortal }: { renderInPortal?: boolean }) => (
      <div data-testid="model-selector" data-render-in-portal={renderInPortal ? "true" : "false"}>
        Model
      </div>
    ),
  }
})

vi.mock("../VariantSelector", () => {
  return {
    VariantSelector: () => <div data-testid="variant-selector">Variant</div>,
  }
})

vi.mock("./MessageActions", () => {
  return {
    MessageActions: () => <div data-testid="message-actions" />,
  }
})

describe("EditorToolbar", () => {
  it("按附件、Agent、模型、variant、自动审批的顺序显示左侧控件", () => {
    const { container } = render(
      <EditorToolbar
        selectedProviderId="openai"
        selectedModelId="gpt-4.1"
        selectedAgent="build"
        onModelSelect={vi.fn()}
        onAgentSelect={vi.fn()}
        onFileSelect={vi.fn()}
        isDisabled={false}
        modelSelectorKey={0}
        lastFailedMessage={null}
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

    const controls = container.querySelector('[data-testid="composer-toolbar-controls"]')
    expect(controls).toBeInTheDocument()
    expect(controls).toHaveClass("flex-1", "flex-wrap", "sm:flex-nowrap")
    expect(controls).not.toHaveClass("overflow-x-auto")
    expect(Array.from(controls!.children).map((element) => element.getAttribute("data-testid"))).toEqual([
      "add-file",
      "agent-selector",
      "model-selector",
      "variant-selector",
      "auto-approve",
      null,
    ])
    expect(screen.getByRole("button", { name: "自动审批" })).toBeDisabled()
    expect(screen.getByTestId("model-selector")).toHaveAttribute("data-render-in-portal", "true")
    const autoApprove = screen.getByRole("button", { name: "自动审批" })
    expect(autoApprove).toHaveAttribute("title", "自动审批（暂未启用）")
    expect(autoApprove.querySelector("path")).toHaveAttribute("d", "M12 3l7 3v5c0 5-3.5 8.4-7 10-3.5-1.6-7-5-7-10V6l7-3z")
  })

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
        lastFailedMessage={true}
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

  it("隐藏文件输入框提供表单标识与可访问名称", () => {
    const { container } = render(
      <EditorToolbar
        selectedProviderId="openai"
        selectedModelId="gpt-4.1"
        selectedAgent="build"
        onModelSelect={vi.fn()}
        onAgentSelect={vi.fn()}
        onFileSelect={vi.fn()}
        isDisabled={false}
        modelSelectorKey={0}
        lastFailedMessage={null}
        onRetry={vi.fn()}
        fileInputRef={{ current: null } as any}
        onFileChange={vi.fn()}
        isIdle={true}
        isButtonDisabled={false}
        isCompactDisabled={false}
        onSubmit={vi.fn()}
        onAbort={vi.fn()}
        onCompactClick={vi.fn()}
        variants={[]}
        selectedVariant={undefined}
        onVariantSelect={vi.fn()}
        isReasoningModel={false}
      />,
    )

    const input = container.querySelector('input[type="file"]')
    expect(input).toHaveAttribute("id", "opencode-file-input")
    expect(input).toHaveAttribute("name", "opencode-file-input")
    expect(input).toHaveAttribute("aria-label", "添加文件")
  })

  it("selection 切换期间显示加载占位而不是旧选择器", () => {
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
        lastFailedMessage={null}
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
        selectionPending
      />,
    )

    expect(screen.getByText("正在切换会话设置…")).toBeInTheDocument()
    expect(screen.queryByTestId("agent-selector")).not.toBeInTheDocument()
    expect(screen.queryByTestId("model-selector")).not.toBeInTheDocument()
    expect(screen.queryByTestId("variant-selector")).not.toBeInTheDocument()
  })
})
