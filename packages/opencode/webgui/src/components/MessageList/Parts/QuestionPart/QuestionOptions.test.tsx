import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { QuestionInfo } from "@opencode-ai/sdk/v2/client"
import { QuestionOptions } from "./QuestionOptions"

const question = (input: Partial<QuestionInfo> & Pick<QuestionInfo, "question" | "header" | "options">): QuestionInfo =>
  input

const baseProps = {
  answers: [] as string[],
  customInput: "",
  onToggleOption: vi.fn(),
  onCustomInputChange: vi.fn(),
  isCustomSelected: false,
  onSelectCustom: vi.fn(),
  onConfirmCustom: vi.fn(),
  isEditing: false,
  onStopEditing: vi.fn(),
}

describe("QuestionOptions", () => {
  it("question 字段支持 Markdown 渲染", () => {
    render(
      <QuestionOptions
        {...baseProps}
        question={question({
          header: "确认",
          question: "请确认 **关键项**",
          multiple: false,
          custom: true,
          options: [{ label: "确认" }],
        })}
      />,
    )

    expect(screen.getByText("关键项", { selector: "strong" })).toBeInTheDocument()
  })

  it("自定义答案与提示文案为中文", () => {
    render(
      <QuestionOptions
        {...baseProps}
        question={question({
          header: "选择",
          question: "请选择：",
          multiple: true,
          custom: true,
          options: [{ label: "A" }, { label: "B" }],
        })}
        isCustomSelected={true}
        isEditing={true}
      />,
    )

    expect(screen.getByText("（可多选）")).toBeInTheDocument()
    expect(screen.getByText("输入自定义答案")).toBeInTheDocument()
    expect(screen.getByPlaceholderText("请输入自定义答案…")).toBeInTheDocument()
    expect(screen.getByText("按 Enter 或勾选选项确认，按 Esc 取消")).toBeInTheDocument()
  })

  it("option.label 与 option.description 保持纯文本", () => {
    const { container } = render(
      <QuestionOptions
        {...baseProps}
        question={question({
          header: "普通",
          question: "普通问题",
          multiple: false,
          custom: true,
          options: [{ label: "**危险**", description: "`desc`" }],
        })}
      />,
    )

    expect(screen.getByText("**危险**")).toBeInTheDocument()
    expect(screen.getByText("`desc`")).toBeInTheDocument()
    expect(container.querySelector("strong")).toBeNull()
    expect(container.querySelector("code")).toBeNull()
  })

  it("输入框失焦不关闭编辑也不确认，窗口重获焦点后回到输入框", async () => {
    const user = userEvent.setup()
    const onConfirmCustom = vi.fn()
    const onStopEditing = vi.fn()
    render(
      <QuestionOptions
        {...baseProps}
        question={question({
          header: "自定义",
          question: "请选择：",
          multiple: false,
          custom: true,
          options: [{ label: "A" }],
        })}
        customInput="我的答案"
        isEditing={true}
        onConfirmCustom={onConfirmCustom}
        onStopEditing={onStopEditing}
      />,
    )

    const textarea = screen.getByPlaceholderText("请输入自定义答案…")
    await user.click(textarea)
    textarea.blur()

    // vscode 失焦（例如打开系统粘贴板）：输入框仍在，草稿不丢、不提交
    expect(screen.getByPlaceholderText("请输入自定义答案…")).toBeInTheDocument()
    expect(onStopEditing).not.toHaveBeenCalled()
    expect(onConfirmCustom).not.toHaveBeenCalled()

    window.dispatchEvent(new Event("focus"))
    expect(document.activeElement).toBe(textarea)

    await user.click(screen.getByRole("radio", { name: "勾选自定义答案" }))
    expect(onConfirmCustom).toHaveBeenCalledTimes(1)
  })
})
