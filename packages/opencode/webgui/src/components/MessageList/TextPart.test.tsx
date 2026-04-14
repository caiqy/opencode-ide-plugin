import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { TextPart } from "./TextPart"

describe("TextPart", () => {
  it("用户消息气泡应使用稳定宽度约束并靠右", () => {
    render(<TextPart part={{ id: "p1", type: "text", text: "短句" } as any} isUser={true} />)

    const content = screen.getByText("短句")
    const bubble = content.parentElement

    expect(content).toBeTruthy()
    expect(content).toHaveClass("whitespace-pre-wrap")
    expect(content).toHaveClass("[overflow-wrap:anywhere]")

    expect(bubble).toBeTruthy()
    expect(bubble).toHaveClass("inline-block")
    expect(bubble).not.toHaveClass("w-fit")
    expect(bubble).not.toHaveClass("max-w-[70%]")

    const wrap = bubble?.parentElement
    expect(wrap).toBeTruthy()
    expect(wrap).toHaveClass("w-full")
    expect(wrap).toHaveClass("flex")
    expect(wrap).toHaveClass("justify-end")
  })

  it("用户消息应使用更克制的面板卡片样式，并与 ToolPart 保持同级圆角", () => {
    render(
      <TextPart
        part={{ id: "p2", type: "text", text: "根据历史提交惯例生成commit信息执行commit & push" } as any}
        isUser={true}
      />,
    )

    const content = screen.getByText("根据历史提交惯例生成commit信息执行commit & push")
    const bubble = content.parentElement

    expect(bubble).toBeTruthy()
    expect(bubble).toHaveClass("rounded-lg")
    expect(bubble).toHaveClass("border")
    expect(bubble).not.toHaveClass("rounded-xl")
    expect(bubble).not.toHaveClass("bg-blue-50")
    expect(bubble).not.toHaveClass("border-blue-400")
  })
})
