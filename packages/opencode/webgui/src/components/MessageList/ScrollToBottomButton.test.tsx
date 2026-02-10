import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ScrollToBottomButton } from "./ScrollToBottomButton"

describe("ScrollToBottomButton", () => {
  it("visible=false 时应隐藏", () => {
    render(<ScrollToBottomButton visible={false} onClick={() => {}} />)

    const button = screen.getByRole("button", { name: "滚动到底部" })
    expect(button).toHaveClass("opacity-0")
    expect(button).toHaveClass("pointer-events-none")
  })

  it("按钮尺寸应减小", () => {
    render(<ScrollToBottomButton visible={true} onClick={() => {}} />)

    const button = screen.getByRole("button", { name: "滚动到底部" })
    expect(button).toHaveClass("w-5")
    expect(button).toHaveClass("h-5")
  })
})
