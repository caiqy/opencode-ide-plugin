import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  useMessages: vi.fn(),
  useSession: vi.fn(),
  useMessageScroll: vi.fn(),
}))

vi.mock("../../state/MessagesContext", () => ({
  useMessages: (...args: unknown[]) => mocks.useMessages(...args),
}))

vi.mock("../../state/SessionContext", () => ({
  useSession: (...args: unknown[]) => mocks.useSession(...args),
}))

vi.mock("../MessageList/hooks/useMessageScroll", () => ({
  useMessageScroll: (...args: unknown[]) => mocks.useMessageScroll(...args),
}))

vi.mock("../MessageList/PartOpenContext", () => ({
  PartOpenProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock("../MessageList/EmptyState", () => ({
  EmptyState: () => <div data-testid="empty-state" />,
}))

vi.mock("../MessageList/MessageRow", () => ({
  MessageRow: () => <div data-testid="message-row" />,
}))

vi.mock("../MessageList/Parts/QuestionPart", () => ({
  QuestionPart: () => <div data-testid="question-part" />,
}))

vi.mock("../TypingIndicator", () => ({
  TypingIndicator: () => null,
}))

vi.mock("../MessageList/ScrollToBottomButton", () => ({
  ScrollToBottomButton: () => null,
}))

import { SubtaskMessageList } from "./SubtaskMessageList"

describe("SubtaskMessageList", () => {
  beforeEach(() => {
    const messages = [
      {
        info: { id: "m2", sessionID: "s-child", role: "assistant", time: { created: 2 } },
        parts: [],
      },
      {
        info: { id: "m1", sessionID: "s-child", role: "assistant", time: { created: 1 } },
        parts: [],
      },
    ]

    mocks.useMessages.mockReturnValue({
      getMessagesBySession: () => messages,
      getQuestionsBySession: () => [],
    })
    mocks.useSession.mockReturnValue({
      isSessionIdle: () => false,
      isSessionReasoning: () => true,
    })
    mocks.useMessageScroll.mockReturnValue({
      messagesEndRef: { current: null },
      messagesContainerRef: { current: null },
      showScrollToBottom: false,
      scrollToBottom: vi.fn(),
    })
  })

  it("无 sessionID 时显示空态", () => {
    render(<SubtaskMessageList sessionID={null} />)
    expect(screen.getByTestId("empty-state")).toBeInTheDocument()
  })

  it("仅有 pending question 且无消息时，仍应渲染问题卡片", () => {
    mocks.useMessages.mockReturnValue({
      getMessagesBySession: () => [],
      getQuestionsBySession: () => [{ id: "q1" }],
    })

    render(<SubtaskMessageList sessionID="s-child" />)

    expect(screen.getByTestId("question-part")).toBeInTheDocument()
    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument()
  })

  it("有消息时应渲染消息行，并使用子会话 idle/reasoning 状态驱动滚动", () => {
    render(<SubtaskMessageList sessionID="s-child" />)

    expect(screen.getAllByTestId("message-row")).toHaveLength(2)
    expect(mocks.useMessageScroll).toHaveBeenCalled()

    const call = mocks.useMessageScroll.mock.calls.at(-1)
    expect(call).toBeTruthy()
    if (!call) return
    const [sid, sorted, isIdle, isReasoning] = call
    expect(sid).toBe("s-child")
    expect(Array.isArray(sorted)).toBe(true)
    expect(sorted.map((m: any) => m.info.id)).toEqual(["m1", "m2"])
    expect(isIdle).toBe(false)
    expect(isReasoning).toBe(true)
  })
})
