import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PendingInputBar } from "./PendingInputBar"
import { InputDeliveryModal } from "./InputDeliveryModal"

describe("待发送交互", () => {
  it("仅有待发送消息时显示与快捷栏之间的分隔线", () => {
    const props = {
      snapshot: null as Parameters<typeof PendingInputBar>[0]["snapshot"],
      error: null as string | null,
      pending: [],
      disabled: false,
      busy: false,
      onUpdate: vi.fn(),
      onMoveUp: vi.fn(),
      onRemove: vi.fn(),
      onNext: vi.fn(),
      onRefresh: vi.fn(),
    }
    const view = render(<PendingInputBar {...props} />)
    expect(screen.queryByRole("region", { name: "待发送消息" })).not.toBeInTheDocument()

    view.rerender(<PendingInputBar {...props} error="加载失败" />)
    expect(screen.getByRole("region", { name: "待发送消息" })).not.toHaveClass("border-t")

    view.rerender(
      <PendingInputBar
        {...props}
        snapshot={{ sessionID: "s", revision: 1, paused: false, items: [{ id: "a", sequence: 1, delivery: "queue", text: "继续" }] }}
      />,
    )
    expect(screen.getByRole("region", { name: "待发送消息" })).toHaveClass("border-t", "border-t-gray-100")
  })

  it("默认展开各项并可收起，隐藏当前模式按钮", () => {
    const onUpdate = vi.fn()
    const onMoveUp = vi.fn()
    const onRemove = vi.fn()
    render(
      <PendingInputBar
        snapshot={{
          sessionID: "s",
          revision: 1,
          paused: false,
          items: [
            { id: "a", sequence: 1, delivery: "steer", text: "第一条补充" },
            { id: "b", sequence: 2, delivery: "queue", text: "第二条排队" },
          ],
        }}
        error={null}
        pending={[]}
        disabled={false}
        busy
        onUpdate={onUpdate}
        onMoveUp={onMoveUp}
        onRemove={onRemove}
        onNext={vi.fn()}
        onRefresh={vi.fn()}
      />,
    )
    expect(screen.getByText("第一条补充")).toBeInTheDocument()
    expect(screen.getByText("第二条排队")).toBeInTheDocument()
    const collapse = screen.getByRole("button", { name: "收起待发送消息" })
    expect(collapse).toHaveAttribute("aria-expanded", "true")
    expect(collapse.textContent).toBe("")
    fireEvent.click(collapse)
    expect(screen.queryByText("第二条排队")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "转补充" })).not.toBeInTheDocument()
    const expand = screen.getByRole("button", { name: "展开待发送消息" })
    fireEvent.click(expand)
    expect(screen.getByRole("button", { name: "收起待发送消息" })).toHaveAttribute("aria-expanded", "true")
    const rows = screen.getAllByRole("listitem")
    expect(rows[0]).toHaveClass("border-b")
    expect(rows[0]).not.toHaveClass("rounded-lg")
    expect(rows[0]).toHaveClass("ps-1")
    expect(screen.getByRole("button", { name: "收起待发送消息" })).toHaveClass("h-6", "w-6")
    expect(within(rows[0]).getByRole("button", { name: "删除待发送消息" })).toHaveClass("h-6", "w-6")
    expect(within(rows[0]).queryByRole("button", { name: "向上移动待发送消息" })).not.toBeInTheDocument()
    const moveUp = within(rows[1]).getByRole("button", { name: "向上移动待发送消息" })
    expect(moveUp.compareDocumentPosition(within(rows[1]).getByRole("button", { name: "删除待发送消息" }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    expect(within(rows[0]).queryByRole("button", { name: "转补充" })).not.toBeInTheDocument()
    expect(within(rows[1]).queryByRole("button", { name: "转排队" })).not.toBeInTheDocument()
    fireEvent.click(within(rows[1]).getByRole("button", { name: "转补充" }))
    expect(onUpdate).toHaveBeenCalledWith("b", "steer")
    fireEvent.click(moveUp)
    expect(onMoveUp).toHaveBeenCalledWith("b")
    fireEvent.click(within(rows[0]).getByRole("button", { name: "删除待发送消息" }))
    expect(onRemove).toHaveBeenCalledWith("a")
  })
  it("停止尚未结束不能发送下一条，空闲后可恢复", () => {
    const props = {
      snapshot: {
        sessionID: "s",
        revision: 1,
        paused: true,
        items: [{ id: "a", sequence: 1, delivery: "queue" as const, text: "排队" }],
      },
      error: null,
      pending: [],
      disabled: false,
      onUpdate: vi.fn(),
      onMoveUp: vi.fn(),
      onRemove: vi.fn(),
      onNext: vi.fn(),
      onRefresh: vi.fn(),
    }
    const view = render(<PendingInputBar {...props} busy />)
    expect(screen.getByRole("button", { name: "发送下一条" })).toBeDisabled()
    view.rerender(<PendingInputBar {...props} busy={false} />)
    fireEvent.click(screen.getByRole("button", { name: "发送下一条" }))
    expect(props.onNext).toHaveBeenCalledOnce()
  })
  it("发送弹窗具有焦点、键盘边界和取消操作", () => {
    const select = vi.fn()
    const close = vi.fn()
    render(<InputDeliveryModal pending={false} error={null} onSelect={select} onClose={close} />)
    const first = screen.getByRole("button", { name: /立即补充/ })
    expect(first).toHaveFocus()
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true })
    expect(screen.getByRole("button", { name: "取消" })).toHaveFocus()
    fireEvent.click(screen.getByRole("button", { name: /排队发送/ }))
    expect(select).toHaveBeenCalledWith("queue")
    fireEvent.keyDown(document, { key: "Escape" })
    expect(close).toHaveBeenCalledOnce()
  })
  it("发送弹窗在两个选项间循环切换、回车提交、Esc 取消", () => {
    const select = vi.fn()
    const close = vi.fn()
    render(<InputDeliveryModal pending={false} error={null} onSelect={select} onClose={close} />)
    const steer = screen.getByRole("button", { name: /立即补充/ })
    const queue = screen.getByRole("button", { name: /排队发送/ })
    const cancel = screen.getByRole("button", { name: "取消" })
    expect(steer).toHaveFocus()
    fireEvent.keyDown(steer, { key: "ArrowUp" })
    expect(queue).toHaveFocus()
    fireEvent.keyDown(queue, { key: "ArrowDown" })
    expect(steer).toHaveFocus()
    cancel.focus()
    fireEvent.keyDown(cancel, { key: "ArrowDown" })
    expect(steer).toHaveFocus()
    cancel.focus()
    fireEvent.keyDown(cancel, { key: "ArrowUp" })
    expect(queue).toHaveFocus()
    fireEvent.keyDown(queue, { key: "Enter" })
    expect(select).toHaveBeenCalledWith("queue")
    expect(select).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: "Escape" })
    expect(close).toHaveBeenCalledOnce()
  })
})
