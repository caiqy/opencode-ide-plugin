import { fireEvent, render, screen } from "@testing-library/react"
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

vi.mock("../MessageList/EmptyState", () => ({
  EmptyState: () => <div data-testid="empty-state" />,
}))

vi.mock("../MessageList/MessageRow", async () => {
  const actual = await vi.importActual<typeof import("../MessageList/PartOpenContext")>(
    "../MessageList/PartOpenContext",
  )

  return {
    MessageRow: ({ message, sessionInterrupted }: { message: any; sessionInterrupted?: boolean }) => {
      const open = actual.usePartOpen()
      const toolParts = message.parts.filter((part: any) => part.type === "tool")
      const reasoningParts = message.parts.filter((part: any) => part.type === "reasoning")

      return (
        <div data-testid={`message-row-${message.info.id}`}>
          {toolParts.length === 0 ? <div data-testid="message-row" /> : null}
          {reasoningParts.map((part: any) => (
            <div key={part.id} data-testid={`part-${part.id}`}>
              {sessionInterrupted ? "思考已中断" : "思考中…"}
            </div>
          ))}
          {toolParts.map((part: any) => (
            <div key={part.id} data-testid={`part-${part.id}`}>
              {sessionInterrupted ? "已中断" : open.isOpen(part.id) ? "open" : "closed"}
            </div>
          ))}
        </div>
      )
    },
  }
})

vi.mock("../MessageList/Parts/QuestionPart", () => ({
  QuestionPart: () => <div data-testid="question-part" />,
}))

vi.mock("../TypingIndicator", () => ({
  TypingIndicator: () => null,
}))

vi.mock("../MessageList/ScrollToBottomButton", () => ({
  ScrollToBottomButton: ({ visible, onClick }: { visible: boolean; onClick: () => void }) =>
    visible ? (
      <button type="button" data-testid="mock-scroll-to-bottom" onClick={onClick}>
        滚动到底部
      </button>
    ) : null,
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
      sessionStatusReady: false,
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
    const { container } = render(<SubtaskMessageList sessionID="s-child" />)

    expect(screen.getAllByTestId("message-row")).toHaveLength(2)
    expect(mocks.useMessageScroll).toHaveBeenCalled()

    const stack = container.querySelector(".min-h-full > div")
    expect(stack).toHaveClass("flex", "flex-col", "gap-3")
    expect(stack).not.toHaveClass("space-y-4")

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

  it("只在状态恢复完成且子会话 idle 时将未完成部分显示为中断", () => {
    mocks.useMessages.mockReturnValue({
      getMessagesBySession: () => [
        {
          info: { id: "m-interrupted", sessionID: "s-child", role: "assistant", time: { created: 1 } },
          parts: [
            { id: "r-interrupted", type: "reasoning", text: "partial" },
            { id: "t-interrupted", type: "tool", tool: "bash", state: { status: "running" } },
          ],
        },
      ],
      getQuestionsBySession: () => [],
    })
    mocks.useSession.mockReturnValue({
      isSessionIdle: () => true,
      isSessionReasoning: () => false,
      sessionStatusReady: true,
    })

    const view = render(<SubtaskMessageList sessionID="s-child" />)

    expect(screen.getByTestId("part-r-interrupted")).toHaveTextContent("思考已中断")
    expect(screen.getByTestId("part-t-interrupted")).toHaveTextContent("已中断")

    mocks.useSession.mockReturnValue({
      isSessionIdle: () => false,
      isSessionReasoning: () => true,
      sessionStatusReady: true,
    })
    view.rerender(<SubtaskMessageList sessionID="s-child" />)
    expect(screen.getByTestId("part-r-interrupted")).toHaveTextContent("思考中…")
    expect(screen.getByTestId("part-t-interrupted")).toHaveTextContent("open")

    mocks.useSession.mockReturnValue({
      isSessionIdle: () => true,
      isSessionReasoning: () => false,
      sessionStatusReady: false,
    })
    view.rerender(<SubtaskMessageList sessionID="s-child" />)
    expect(screen.getByTestId("part-r-interrupted")).toHaveTextContent("思考中…")
    expect(screen.getByTestId("part-t-interrupted")).toHaveTextContent("open")
  })

  it("showScrollToBottom=false 时不渲染 sticky layer 与按钮", () => {
    render(<SubtaskMessageList sessionID="s-child" />)

    expect(screen.queryByTestId("subtask-scroll-to-bottom-layer")).not.toBeInTheDocument()
    expect(screen.queryByTestId("mock-scroll-to-bottom")).not.toBeInTheDocument()
  })

  it("showScrollToBottom=true 时渲染 sticky layer 并触发滚动", () => {
    const scrollToBottom = vi.fn()
    mocks.useMessageScroll.mockReturnValue({
      messagesEndRef: { current: null },
      messagesContainerRef: { current: null },
      showScrollToBottom: true,
      scrollToBottom,
    })

    const { container } = render(<SubtaskMessageList sessionID="s-child" />)

    const shell = container.querySelector(".min-h-full")
    const layer = screen.getByTestId("subtask-scroll-to-bottom-layer")
    expect(layer.parentElement).toBe(shell)
    expect(layer).toHaveClass("sticky", "bottom-4", "z-30", "flex", "justify-end", "pr-2", "pointer-events-none")

    // 1 from mount-effect auto-scroll + 1 from click
    fireEvent.click(screen.getByTestId("mock-scroll-to-bottom"))
    expect(scrollToBottom).toHaveBeenCalledTimes(2)
  })

  it("挂载有消息的子任务时会自动滚到底部 (scrollToBottom 在 mount effect 中被调用)", () => {
    const scrollToBottom = vi.fn()
    mocks.useMessageScroll.mockReturnValue({
      messagesEndRef: { current: null },
      messagesContainerRef: { current: null },
      showScrollToBottom: false,
      scrollToBottom,
    })

    render(<SubtaskMessageList sessionID="s-child" />)

    // The useEffect(() => scrollToBottom(), [scrollToBottom]) fires synchronously
    // inside render in the test environment.
    expect(scrollToBottom).toHaveBeenCalledTimes(1)
  })

  it("子任务消息中的多个 task 卡片默认只展开最后一个", () => {
    mocks.useMessages.mockReturnValue({
      getMessagesBySession: () => [
        {
          info: { id: "m1", sessionID: "s-child", role: "assistant", time: { created: 1 } },
          parts: [{ id: "task-1", type: "tool", tool: "task", state: { status: "completed" } }],
        },
        {
          info: { id: "m2", sessionID: "s-child", role: "assistant", time: { created: 2 } },
          parts: [{ id: "task-2", type: "tool", tool: "task", state: { status: "running" } }],
        },
      ],
      getQuestionsBySession: () => [],
    })

    render(<SubtaskMessageList sessionID="s-child" />)

    expect(screen.getByTestId("part-task-1")).toHaveTextContent("closed")
    expect(screen.getByTestId("part-task-2")).toHaveTextContent("open")
  })
})
