import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { QuestionOptions } from "./QuestionOptions"

describe("QuestionOptions", () => {
  it("自定义答案与提示文案为中文", () => {
    render(
      <QuestionOptions
        question={{
          id: "q1",
          question: "请选择：",
          multiple: true,
          custom: true,
          options: [{ label: "A" }, { label: "B" }],
        } as any}
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
})
