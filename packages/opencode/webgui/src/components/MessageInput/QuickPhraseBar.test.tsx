import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QuickPhraseBar } from "./QuickPhraseBar"

const items = [
  { id: "a", title: "提交总结", body: "x" },
  { id: "b", title: "风险检查", body: "y" },
]

describe("QuickPhraseBar", () => {
  it("默认单行横向滚动并显示展开按钮", () => {
    render(<QuickPhraseBar items={items} disabled={false} onActivate={vi.fn()} />)

    expect(screen.getByText("提交总结")).toBeInTheDocument()
    expect(screen.getByText("风险检查")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "展开" })).toBeInTheDocument()
    expect(screen.getByTestId("quick-phrase-row")).toHaveClass("whitespace-nowrap")
    expect(screen.getByTestId("quick-phrase-row")).toHaveClass("overflow-x-auto")
  })

  it("点击展开后显示收起状态", () => {
    render(<QuickPhraseBar items={items} disabled={false} onActivate={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: "展开" }))
    expect(screen.getByRole("button", { name: "收起" })).toBeInTheDocument()
    expect(screen.getByTestId("quick-phrase-row")).toHaveClass("flex-wrap")
  })

  it("禁用时标签与展开按钮不可交互", () => {
    const onActivate = vi.fn()
    render(<QuickPhraseBar items={items} disabled={true} onActivate={onActivate} />)

    expect(screen.getByRole("button", { name: "提交总结" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "展开" })).toBeDisabled()
  })
})
