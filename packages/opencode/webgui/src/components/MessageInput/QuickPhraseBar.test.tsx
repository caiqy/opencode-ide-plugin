import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QuickPhraseBar } from "./QuickPhraseBar"

const items = [
  { id: "a", title: "提交总结", body: "x" },
  { id: "b", title: "风险检查", body: "y" },
]

describe("QuickPhraseBar", () => {
  it("默认单行横向滚动并显示展开按钮", () => {
    render(<QuickPhraseBar items={items} disabled={false} onSend={vi.fn()} onFill={vi.fn()} />)

    expect(screen.getByText("提交总结")).toBeInTheDocument()
    expect(screen.getByText("风险检查")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "展开快捷短语" })).toBeInTheDocument()
    expect(screen.getByTestId("quick-phrase-row")).toHaveClass("whitespace-nowrap")
    expect(screen.getByTestId("quick-phrase-row")).toHaveClass("overflow-x-auto")
    expect(screen.getByTestId("quick-phrase-row")).toHaveClass("gap-1.5")
    expect(screen.getByRole("button", { name: "提交总结" })).toHaveClass("border-gray-200")
  })

  it("点击展开后显示收起状态", () => {
    render(<QuickPhraseBar items={items} disabled={false} onSend={vi.fn()} onFill={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: "展开快捷短语" }))
    expect(screen.getByRole("button", { name: "收起快捷短语" })).toBeInTheDocument()
    expect(screen.getByTestId("quick-phrase-row")).toHaveClass("flex-wrap")
  })

  it("禁用时标签与展开按钮不可交互", () => {
    render(<QuickPhraseBar items={items} disabled={true} onSend={vi.fn()} onFill={vi.fn()} />)

    expect(screen.getByRole("button", { name: "提交总结" })).toBeDisabled()
    expect(screen.getByRole("button", { name: "展开快捷短语" })).toBeDisabled()
  })

  it("按下短语行时不会立即捕获指针", () => {
    render(<QuickPhraseBar items={items} disabled={false} onSend={vi.fn()} onFill={vi.fn()} />)

    const row = screen.getByTestId("quick-phrase-row")
    const set = vi.fn()

    Object.defineProperty(row, "setPointerCapture", {
      value: set,
      configurable: true,
    })

    fireEvent.pointerDown(row, {
      button: 0,
      pointerId: 1,
      clientX: 100,
    })

    expect(set).not.toHaveBeenCalled()
  })

  it("左键双击短语会发送", () => {
    const onSend = vi.fn()
    const onFill = vi.fn()
    render(<QuickPhraseBar items={items} disabled={false} onSend={onSend} onFill={onFill} />)

    fireEvent.doubleClick(screen.getByRole("button", { name: "提交总结" }))

    expect(onSend).toHaveBeenCalledWith(items[0])
    expect(onFill).not.toHaveBeenCalled()
  })

  it("右键双击短语会回填且阻止系统菜单", () => {
    const onSend = vi.fn()
    const onFill = vi.fn()
    render(<QuickPhraseBar items={items} disabled={false} onSend={onSend} onFill={onFill} />)

    const btn = screen.getByRole("button", { name: "提交总结" })
    const first = fireEvent.contextMenu(btn)
    expect(first).toBe(false) // preventDefault 返回 false
    expect(onFill).not.toHaveBeenCalled()

    fireEvent.contextMenu(btn)
    expect(onFill).toHaveBeenCalledWith(items[0])
    expect(onSend).not.toHaveBeenCalled()
  })

  it("单次右键不触发回填", () => {
    const onFill = vi.fn()
    render(<QuickPhraseBar items={items} disabled={false} onSend={vi.fn()} onFill={onFill} />)

    fireEvent.contextMenu(screen.getByRole("button", { name: "提交总结" }))

    expect(onFill).not.toHaveBeenCalled()
  })

  it("两次右键落在不同短语上不触发回填", () => {
    const onFill = vi.fn()
    render(<QuickPhraseBar items={items} disabled={false} onSend={vi.fn()} onFill={onFill} />)

    fireEvent.contextMenu(screen.getByRole("button", { name: "提交总结" }))
    fireEvent.contextMenu(screen.getByRole("button", { name: "风险检查" }))

    expect(onFill).not.toHaveBeenCalled()
  })

  it("禁用时左键双击与右键双击都不触发", () => {
    const onSend = vi.fn()
    const onFill = vi.fn()
    render(<QuickPhraseBar items={items} disabled={true} onSend={onSend} onFill={onFill} />)

    const btn = screen.getByRole("button", { name: "提交总结" })
    fireEvent.doubleClick(btn)
    fireEvent.contextMenu(btn)
    fireEvent.contextMenu(btn)

    expect(onSend).not.toHaveBeenCalled()
    expect(onFill).not.toHaveBeenCalled()
  })
})
