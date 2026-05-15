import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { ScrollToBottomButton } from "./ScrollToBottomButton"

describe("ScrollToBottomButton", () => {
  it("visible=false 时不渲染按钮", () => {
    render(<ScrollToBottomButton visible={false} onClick={() => {}} />)

    expect(screen.queryByRole("button", { name: "滚动到底部" })).not.toBeInTheDocument()
  })

  it("visible=true 时渲染 30x30 按钮并响应点击", () => {
    const onClick = vi.fn()

    render(<ScrollToBottomButton visible={true} onClick={onClick} />)

    const button = screen.getByRole("button", { name: "滚动到底部" })
    expect(button).toHaveClass("w-[30px]")
    expect(button).toHaveClass("h-[30px]")
    expect(button).toHaveClass("pointer-events-auto")
    expect(button).not.toHaveClass("fixed")

    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
