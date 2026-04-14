import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("./MessagePart", () => ({
  MessagePart: ({ part }: { part: { id: string } }) => <div data-testid={`part-${part.id}`} />,
}))

vi.mock("./SessionErrorPart", () => ({
  SessionErrorPart: () => <div data-testid="session-error-part" />,
}))

vi.mock("./ActionButtons", () => ({
  ActionButtons: () => <div data-testid="action-buttons" />,
}))

vi.mock("./AssistantMeta", () => ({
  AssistantMeta: () => <div data-testid="assistant-meta" />,
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
})
