import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

const assistantMetaSpy = vi.fn(() => <div data-testid="assistant-meta" />)
const actionButtonsSpy = vi.fn(() => <div data-testid="action-buttons" />)

vi.mock("./MessagePart", () => ({
  MessagePart: ({ part }: { part: { id: string } }) => <div data-testid={`part-${part.id}`} />,
}))

vi.mock("./SessionErrorPart", () => ({
  SessionErrorPart: () => <div data-testid="session-error-part" />,
}))

vi.mock("./ActionButtons", () => ({
  ActionButtons: (props: Record<string, unknown>) => actionButtonsSpy(props),
}))

vi.mock("./AssistantMeta", () => ({
  AssistantMeta: (props: Record<string, unknown>) => assistantMetaSpy(props),
}))

vi.mock("../../hooks/useProviderStore", () => ({
  useProviderStore: () => ({
    resolveModelName: () => "Claude Sonnet 4",
  }),
}))

import { MessageRow } from "./MessageRow"

describe("MessageRow", () => {
  it("统一使用 flex gap 管理 part 间距，且用户消息外层不再额外补底部 padding", () => {
    const message = {
      info: {
        id: "u1",
        sessionID: "s1",
        role: "user",
        time: { created: 1 },
      },
      parts: [
        {
          id: "p1",
          type: "text",
          text: "hello",
        },
      ],
    }

    const { container } = render(<MessageRow message={message as never} isLast />)

    const row = container.firstElementChild
    expect(row).toHaveClass("flex", "justify-end")
    expect(row).not.toHaveClass("pb-2")

    const partStack = screen.getByText("你").parentElement
    expect(partStack).toHaveClass("flex", "flex-col", "gap-3")
    expect(partStack).not.toHaveClass("space-y-1")
  })

  it("把 assistant 完成时间与中断状态透传给 AssistantMeta", () => {
    const completedAt = new Date(2026, 4, 5, 14, 23, 18).getTime()

    const message = {
      info: {
        id: "a1",
        sessionID: "s1",
        role: "assistant",
        agent: "build",
        providerID: "anthropic",
        modelID: "claude-sonnet-4",
        variant: "high",
        time: { created: 1, completed: completedAt },
        error: { name: "MessageAbortedError", message: "stopped" },
      },
      parts: [
        {
          id: "p1",
          type: "text",
          text: "done",
        },
      ],
    }

    render(<MessageRow message={message as never} isLast showMeta turnDurationMs={71000} />)

    expect(screen.getByTestId("assistant-meta")).toBeInTheDocument()
    expect(assistantMetaSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: "build",
        modelName: "Claude Sonnet 4",
        variant: "high",
        durationMs: 71000,
        completedAt,
        interrupted: true,
      }),
    )
  })

  it("工具续写期间隐藏 meta，最终 assistant 完成后显示", () => {
    const base = {
      id: "a-turn",
      sessionID: "s1",
      role: "assistant",
      agent: "build",
      providerID: "openai",
      modelID: "gpt-5",
      time: { created: 1, completed: 2 },
    }
    const tool = {
      id: "tool-1",
      type: "tool",
      callID: "call-1",
      tool: "bash",
      state: { status: "completed", input: {}, output: "done", title: "bash", metadata: {}, time: { start: 1, end: 2 } },
    }

    const view = render(
      <MessageRow message={{ info: { ...base, finish: "tool-calls" }, parts: [tool] } as never} showMeta />,
    )
    expect(screen.queryByTestId("assistant-meta")).not.toBeInTheDocument()

    view.rerender(
      <MessageRow
        message={{ info: { ...base, finish: "tool-calls" }, parts: [tool] } as never}
        showMeta
        sessionInterrupted
      />,
    )
    expect(screen.getByTestId("assistant-meta")).toBeInTheDocument()
    expect(assistantMetaSpy).toHaveBeenLastCalledWith(expect.objectContaining({ interrupted: true }))

    view.rerender(
      <MessageRow
        message={{
          info: { ...base, time: { created: 1 } },
          parts: [{ ...tool, state: { status: "running", input: {}, time: { start: 9000 } } }],
        } as never}
        showMeta
        sessionInterrupted
      />,
    )
    expect(screen.getByTestId("assistant-meta")).toBeInTheDocument()
    expect(assistantMetaSpy).toHaveBeenLastCalledWith(expect.objectContaining({ completedAt: 9000, interrupted: true }))

    view.rerender(
      <MessageRow
        message={{
          info: { ...base, finish: "unknown", time: { created: 1 } },
          parts: [{ id: "text-stream", type: "text", text: "partial", time: { start: 7000 } }],
        } as never}
        showMeta
        sessionInterrupted
      />,
    )
    expect(screen.getByTestId("assistant-meta")).toBeInTheDocument()
    expect(assistantMetaSpy).toHaveBeenLastCalledWith(expect.objectContaining({ completedAt: 7000, interrupted: true }))

    view.rerender(<MessageRow message={{ info: { ...base, finish: "stop" }, parts: [tool] } as never} showMeta />)
    expect(screen.queryByTestId("assistant-meta")).not.toBeInTheDocument()

    view.rerender(<MessageRow message={{ info: base, parts: [tool] } as never} showMeta />)
    expect(screen.getByTestId("assistant-meta")).toBeInTheDocument()

    view.rerender(
      <MessageRow
        message={{ info: { ...base, finish: "stop" }, parts: [{ id: "text-1", type: "text", text: "done" }] } as never}
        showMeta
      />,
    )
    expect(screen.getByTestId("assistant-meta")).toBeInTheDocument()
  })

  it("同一条 assistant 消息中的多个思考片段只渲染一个 part", () => {
    const message = {
      info: { id: "a-reasoning", sessionID: "s1", role: "assistant", time: { created: 1 } },
      parts: [
        { id: "r1", type: "reasoning", text: "先分析", time: { start: 100, end: 200 } },
        { id: "r2", type: "reasoning", text: "再验证", time: { start: 220, end: 500 } },
      ],
    }

    render(<MessageRow message={message as never} />)

    expect(screen.getByTestId("part-r1")).toBeInTheDocument()
    expect(screen.queryByTestId("part-r2")).not.toBeInTheDocument()
  })

  it("用户消息复制按钮应接收 canonical copyText", () => {
    const message = {
      info: {
        id: "u-copy",
        sessionID: "s1",
        role: "user",
        time: { created: 1 },
      },
      parts: [
        { id: "p1", type: "text", text: "  第一段" },
        { id: "p2", type: "text", text: "忽略", synthetic: true },
        { id: "p3", type: "text", text: "第二段  " },
      ],
    }

    const { container } = render(<MessageRow message={message as never} isLast />)
    fireEvent.mouseEnter(container.firstElementChild!)

    expect(actionButtonsSpy).toHaveBeenCalledWith(expect.objectContaining({ copyText: "第一段\n第二段" }))
  })

  it("用户消息 hover 时在气泡下方显示本地时间和 inline 操作栏", () => {
    const message = {
      info: {
        id: "u-meta",
        sessionID: "s1",
        role: "user",
        time: { created: new Date(2026, 7, 20, 21, 8).getTime() },
      },
      parts: [{ id: "p1", type: "text", text: "hello" }],
    }

    const { container } = render(<MessageRow message={message as never} onFork={vi.fn()} onRevert={vi.fn()} />)

    const meta = screen.getByTestId("user-message-meta")
    expect(meta).toHaveClass("opacity-0", "pointer-events-none")
    expect(screen.getByTestId("user-message-time")).toHaveTextContent("8月20日 21:08")
    expect(actionButtonsSpy).toHaveBeenCalledWith(expect.objectContaining({ inline: true }))

    fireEvent.mouseEnter(container.firstElementChild!)
    expect(meta).toHaveClass("opacity-100", "pointer-events-auto")
  })

  it("assistant 消息 hover 时不显示操作控件", () => {
    actionButtonsSpy.mockClear()
    const message = {
      info: { id: "a-actions", sessionID: "s1", role: "assistant", time: { created: 1 } },
      parts: [{ id: "p1", type: "text", text: "done" }],
    }
    const { container } = render(<MessageRow message={message as never} />)

    fireEvent.mouseEnter(container.firstElementChild!)

    expect(actionButtonsSpy).not.toHaveBeenCalled()
  })
})
