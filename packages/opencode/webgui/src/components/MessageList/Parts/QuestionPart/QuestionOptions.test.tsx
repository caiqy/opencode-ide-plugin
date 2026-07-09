import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QuestionOptions } from "./QuestionOptions"

describe("QuestionOptions", () => {
  it("question 字段支持 Markdown 渲染", () => {
    render(
      <QuestionOptions
        question={
          {
            id: "q-markdown",
            question: "请确认 **关键项**",
            multiple: false,
            custom: true,
            options: [{ label: "确认" }],
          } as any
        }
        answers={[]}
        customInput=""
        onToggleOption={vi.fn()}
        onCustomInputChange={vi.fn()}
        isCustomSelected={false}
        onSelectCustom={vi.fn()}
        isEditing={false}
        onStartEditing={vi.fn()}
        onFinishEditing={vi.fn()}
      />,
    )

    expect(screen.getByText("关键项", { selector: "strong" })).toBeInTheDocument()
  })

  it("自定义答案与提示文案为中文", () => {
    render(
      <QuestionOptions
        question={
          {
            id: "q1",
            question: "请选择：",
            multiple: true,
            custom: true,
            options: [{ label: "A" }, { label: "B" }],
          } as any
        }
        answers={[]}
        customInput=""
        onToggleOption={vi.fn()}
        onCustomInputChange={vi.fn()}
        isCustomSelected={true}
        onSelectCustom={vi.fn()}
        isEditing={true}
        onStartEditing={vi.fn()}
        onFinishEditing={vi.fn()}
      />,
    )

    expect(screen.getByText("（可多选）")).toBeInTheDocument()
    expect(screen.getByText("输入自定义答案")).toBeInTheDocument()
    expect(screen.getByPlaceholderText("请输入自定义答案…")).toBeInTheDocument()
    expect(screen.getByText("按 Enter 确认，按 Esc 取消")).toBeInTheDocument()
  })

  it("option.label 与 option.description 保持纯文本", () => {
    const { container } = render(
      <QuestionOptions
        question={
          {
            id: "q-option-plain",
            question: "普通问题",
            multiple: false,
            custom: true,
            options: [{ label: "**危险**", description: "`desc`" }],
          } as any
        }
        answers={[]}
        customInput=""
        onToggleOption={vi.fn()}
        onCustomInputChange={vi.fn()}
        isCustomSelected={false}
        onSelectCustom={vi.fn()}
        isEditing={false}
        onStartEditing={vi.fn()}
        onFinishEditing={vi.fn()}
      />,
    )

    expect(screen.getByText("**危险**")).toBeInTheDocument()
    expect(screen.getByText("`desc`")).toBeInTheDocument()
    expect(container.querySelector("strong")).toBeNull()
    expect(container.querySelector("code")).toBeNull()
  })
})
