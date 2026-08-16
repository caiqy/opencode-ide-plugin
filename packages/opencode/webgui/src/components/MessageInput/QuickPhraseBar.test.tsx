import { afterEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import { QuickPhraseBar } from "./QuickPhraseBar"

const items = [
  { id: "a", title: "提交总结", body: "x" },
  { id: "b", title: "风险检查", body: "y" },
]

function stubPointerCapture(row: HTMLElement) {
  Object.defineProperty(row, "setPointerCapture", { value: vi.fn(), configurable: true })
  Object.defineProperty(row, "hasPointerCapture", { value: vi.fn(() => false), configurable: true })
  Object.defineProperty(row, "releasePointerCapture", { value: vi.fn(), configurable: true })
}

describe("QuickPhraseBar", () => {
  afterEach(() => {
    vi.useRealTimers()
  })
  it("默认单行横向滚动并显示展开按钮", () => {
    const { container } = render(<QuickPhraseBar items={items} disabled={false} onSend={vi.fn()} onFill={vi.fn()} />)

    expect(screen.getByText("提交总结")).toBeInTheDocument()
    expect(screen.getByText("风险检查")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "展开快捷短语" })).toBeInTheDocument()
    expect(screen.getByTestId("quick-phrase-row")).toHaveClass("whitespace-nowrap")
    expect(screen.getByTestId("quick-phrase-row")).toHaveClass("overflow-x-auto")
    expect(screen.getByTestId("quick-phrase-row")).toHaveClass("gap-1.5")
    expect(screen.getByRole("button", { name: "提交总结" })).toHaveClass(
      "border-gray-200",
      "bg-gray-100",
      "hover:bg-gray-200",
      "dark:bg-[rgb(26,26,26)]",
      "dark:hover:bg-gray-700",
      "text-gray-700",
    )
    expect(container.firstElementChild).toHaveClass("first:rounded-t-lg", "bg-white", "dark:bg-[rgb(30,30,30)]")
    expect(container.firstElementChild).not.toHaveClass("border-t", "border-b")
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

  it("仅禁用发送时仍允许展开和右键双击回填", () => {
    const onSend = vi.fn()
    const onFill = vi.fn()
    render(<QuickPhraseBar items={items} disabled={false} sendDisabled onSend={onSend} onFill={onFill} />)

    const phrase = screen.getByRole("button", { name: "提交总结" })
    const expand = screen.getByRole("button", { name: "展开快捷短语" })
    expect(phrase).toBeEnabled()
    expect(expand).toBeEnabled()

    fireEvent.click(expand)
    fireEvent.click(phrase, { detail: 1 })
    fireEvent.click(phrase, { detail: 1 })
    fireEvent.contextMenu(phrase)
    fireEvent.contextMenu(phrase)

    expect(onSend).not.toHaveBeenCalled()
    expect(onFill).toHaveBeenCalledWith(items[0])
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

  it("400ms 内两次左键点击短语会发送", () => {
    const onSend = vi.fn()
    const onFill = vi.fn()
    render(<QuickPhraseBar items={items} disabled={false} onSend={onSend} onFill={onFill} />)

    const btn = screen.getByRole("button", { name: "提交总结" })
    fireEvent.click(btn, { detail: 1 })
    fireEvent.click(btn, { detail: 1 })

    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSend).toHaveBeenCalledWith(items[0])
    expect(onFill).not.toHaveBeenCalled()
  })

  it("单次左键点击短语不发送", () => {
    const onSend = vi.fn()
    const onFill = vi.fn()
    render(<QuickPhraseBar items={items} disabled={false} onSend={onSend} onFill={onFill} />)

    fireEvent.click(screen.getByRole("button", { name: "提交总结" }), { detail: 1 })

    expect(onSend).not.toHaveBeenCalled()
    expect(onFill).not.toHaveBeenCalled()
  })

  it("连续两次键盘激活 click（detail 0）不发送", () => {
    const onSend = vi.fn()
    render(<QuickPhraseBar items={items} disabled={false} onSend={onSend} onFill={vi.fn()} />)

    const btn = screen.getByRole("button", { name: "提交总结" })
    fireEvent.click(btn, { detail: 0 })
    fireEvent.click(btn, { detail: 0 })
    fireEvent.click(btn, { detail: 1 })

    expect(onSend).not.toHaveBeenCalled()
  })

  it("键盘 click（detail 0）不更新左键配对状态", () => {
    vi.useFakeTimers()
    const onSend = vi.fn()
    render(<QuickPhraseBar items={items} disabled={false} onSend={onSend} onFill={vi.fn()} />)

    const btn = screen.getByRole("button", { name: "提交总结" })
    fireEvent.click(btn, { detail: 1 })
    vi.advanceTimersByTime(500)
    fireEvent.click(btn, { detail: 0 })
    fireEvent.click(btn, { detail: 1 })

    expect(onSend).not.toHaveBeenCalled()
  })

  it("超过 400ms 的两次左键点击不发送", () => {
    vi.useFakeTimers()
    const onSend = vi.fn()
    render(<QuickPhraseBar items={items} disabled={false} onSend={onSend} onFill={vi.fn()} />)

    const btn = screen.getByRole("button", { name: "提交总结" })
    fireEvent.click(btn, { detail: 1 })
    vi.advanceTimersByTime(401)
    fireEvent.click(btn, { detail: 1 })

    expect(onSend).not.toHaveBeenCalled()
  })

  it("两次点击落在不同短语上不配对", () => {
    const onSend = vi.fn()
    render(<QuickPhraseBar items={items} disabled={false} onSend={onSend} onFill={vi.fn()} />)

    fireEvent.click(screen.getByRole("button", { name: "提交总结" }), { detail: 1 })
    fireEvent.click(screen.getByRole("button", { name: "风险检查" }), { detail: 1 })

    expect(onSend).not.toHaveBeenCalled()
  })

  it("拖动滚动后的点击不发送也不参与配对", () => {
    const onSend = vi.fn()
    const onFill = vi.fn()
    render(<QuickPhraseBar items={items} disabled={false} onSend={onSend} onFill={onFill} />)

    const row = screen.getByTestId("quick-phrase-row")
    const btn = screen.getByRole("button", { name: "提交总结" })
    stubPointerCapture(row)

    fireEvent.pointerDown(row, { button: 0, pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(row, { pointerId: 1, clientX: 110 })
    fireEvent.pointerUp(row, { pointerId: 1 })
    fireEvent.click(btn, { detail: 1 })
    fireEvent.click(btn, { detail: 1 })

    expect(onSend).not.toHaveBeenCalled()
    expect(onFill).not.toHaveBeenCalled()
  })

  it("拖动未产生 click 时下一次 pointerDown 复位忽略标记", () => {
    const onSend = vi.fn()
    render(<QuickPhraseBar items={items} disabled={false} onSend={onSend} onFill={vi.fn()} />)

    const row = screen.getByTestId("quick-phrase-row")
    const btn = screen.getByRole("button", { name: "提交总结" })
    stubPointerCapture(row)

    fireEvent.pointerDown(row, { button: 0, pointerId: 1, clientX: 100 })
    fireEvent.pointerMove(row, { pointerId: 1, clientX: 110 })
    fireEvent.pointerUp(row, { pointerId: 1 })

    fireEvent.pointerDown(row, { button: 0, pointerId: 2, clientX: 50 })
    fireEvent.pointerUp(row, { pointerId: 2 })

    fireEvent.click(btn, { detail: 1 })
    fireEvent.click(btn, { detail: 1 })

    expect(onSend).toHaveBeenCalledTimes(1)
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
    fireEvent.click(btn, { detail: 1 })
    fireEvent.click(btn, { detail: 1 })
    fireEvent.contextMenu(btn)
    fireEvent.contextMenu(btn)

    expect(onSend).not.toHaveBeenCalled()
    expect(onFill).not.toHaveBeenCalled()
  })
})
