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
})
