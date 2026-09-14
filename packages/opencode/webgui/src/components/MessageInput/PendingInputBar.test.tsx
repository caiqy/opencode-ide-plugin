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

  it("默认首条，展开后显示各项，隐藏当前模式按钮", () => {
    const onUpdate = vi.fn()
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
        onRemove={onRemove}
        onNext={vi.fn()}
        onRefresh={vi.fn()}
      />,
    )
    expect(screen.getByText("第一条补充")).toBeInTheDocument()
    expect(screen.queryByText("第二条排队")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "转补充" })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: /展开/ }))
    const rows = screen.getAllByRole("listitem")
    expect(within(rows[0]).queryByRole("button", { name: "转补充" })).not.toBeInTheDocument()
    expect(within(rows[1]).queryByRole("button", { name: "转排队" })).not.toBeInTheDocument()
    fireEvent.click(within(rows[1]).getByRole("button", { name: "转补充" }))
    expect(onUpdate).toHaveBeenCalledWith("b", "steer")
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
})
