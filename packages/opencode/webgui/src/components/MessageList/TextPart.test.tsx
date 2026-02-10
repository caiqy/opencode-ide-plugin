import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { TextPart } from "./TextPart"

describe("TextPart", () => {
  it("用户消息使用宽度函数方案并靠右", () => {
    render(<TextPart part={{ id: "p1", type: "text", text: "短句" } as any} isUser={true} />)

    const inner = screen.getByText("短句")
    const bubble = inner.parentElement
    expect(bubble).toBeTruthy()
    expect(bubble).toHaveClass("w-[min(70%,fit-content)]")

    const wrap = bubble?.parentElement
    expect(wrap).toBeTruthy()
    expect(wrap).toHaveClass("w-full")
    expect(wrap).toHaveClass("flex")
    expect(wrap).toHaveClass("justify-end")
  })
})
