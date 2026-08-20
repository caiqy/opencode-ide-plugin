import { describe, it, expect, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

const assistantMetaSpy = vi.fn((_props: Record<string, unknown>) => <div data-testid="assistant-meta" />)
const actionButtonsSpy = vi.fn((_props: Record<string, unknown>) => <div data-testid="action-buttons" />)

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
})
