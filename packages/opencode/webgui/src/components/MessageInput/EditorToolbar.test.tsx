import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { EditorToolbar } from "./EditorToolbar"

const approvalProps = {
  approvalMode: "manual" as const,
  approvalPending: false,
  onApprovalSelect: vi.fn(),
}

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
  it("按附件、Agent、模型、variant、审批模式的顺序显示左侧控件", async () => {
    const user = userEvent.setup()
    const { container } = render(
      <EditorToolbar
        {...approvalProps}
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
    const approval = screen.getByTitle("选择审批模式")
    expect(approval).toHaveTextContent("手动审批")
    await user.click(approval)
    expect(screen.getByRole("menu")).toBeInTheDocument()
    expect(screen.getByRole("menuitemradio", { name: /手动审批\s*Manual/ })).toHaveAttribute("aria-checked", "true")
    expect(screen.getByRole("menuitemradio", { name: /自动审批\s*Automatic/ })).toHaveAttribute("aria-checked", "false")
    await user.click(screen.getByRole("menuitemradio", { name: /完全访问\s*Full access/ }))
    expect(approvalProps.onApprovalSelect).toHaveBeenCalledWith("full")
    expect(screen.getByTestId("model-selector")).toHaveAttribute("data-render-in-portal", "true")
    expect(screen.getByTestId("auto-approve").querySelector("path")).toHaveAttribute(
      "d",
      "M12 3l7 3v5c0 5-3.5 8.4-7 10-3.5-1.6-7-5-7-10V6l7-3z",
    )
  })

  it("重试与添加文件按钮文案为中文", () => {
    render(
      <EditorToolbar
        {...approvalProps}
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
        {...approvalProps}
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

  it("无有效 session 时审批模式选择器禁用", () => {
    render(
      <EditorToolbar
        {...approvalProps}
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
        approvalDisabled
      />,
    )

    expect(screen.getByTitle("选择审批模式")).toBeDisabled()
  })

  it("审批挂起时审批模式选择器禁用", () => {
    render(
      <EditorToolbar
        {...approvalProps}
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
        approvalPending
      />,
    )

    expect(screen.getByTitle("选择审批模式")).toBeDisabled()
  })

  it("selection 切换期间显示加载占位而不是旧选择器", () => {
    render(
      <EditorToolbar
        {...approvalProps}
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
