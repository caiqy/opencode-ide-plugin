import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  useMessages: vi.fn(),
  useSession: vi.fn(),
  useUISettings: vi.fn(),
  useMessageScroll: vi.fn(),
  useMessageActions: vi.fn(),
}))

vi.mock("../../state/MessagesContext", () => ({
  useMessages: (...args: unknown[]) => mocks.useMessages(...args),
}))

vi.mock("../../state/SessionContext", () => ({
  useSession: (...args: unknown[]) => mocks.useSession(...args),
}))

vi.mock("../../state/UISettingsContext", () => ({
  useUISettings: (...args: unknown[]) => mocks.useUISettings(...args),
}))

vi.mock("./hooks/useMessageScroll", () => ({
  useMessageScroll: (...args: unknown[]) => mocks.useMessageScroll(...args),
}))

vi.mock("./hooks/useMessageActions", () => ({
  useMessageActions: (...args: unknown[]) => mocks.useMessageActions(...args),
}))

vi.mock("./PartOpenContext", () => ({
  PartOpenProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

vi.mock("./EmptyState", () => ({
  EmptyState: () => <div data-testid="empty-state" />,
}))

vi.mock("./MessageRow", () => ({
  MessageRow: () => <div data-testid="message-row" />,
}))

vi.mock("./RevertBanner", () => ({
  RevertBanner: () => null,
}))

vi.mock("./RevertSummary", () => ({
  RevertSummary: () => null,
}))

vi.mock("./Parts/QuestionPart", () => ({
  QuestionPart: () => null,
}))

vi.mock("../TypingIndicator", () => ({
  TypingIndicator: () => null,
}))

import { MessageList } from "./index"

describe("MessageList", () => {
  beforeEach(() => {
    const messages = [
      {
        info: {
          id: "m1",
          role: "assistant",
          summary: true,
          time: { created: 1 },
        },
        parts: [],
      },
    ]

    mocks.useMessages.mockReturnValue({
      getMessagesBySession: () => messages,
      getQuestionsBySession: () => [],
    })
    mocks.useSession.mockReturnValue({ isIdle: true, isReasoning: false, currentSession: null })
    mocks.useUISettings.mockReturnValue({ autoExpandMessageParts: false })
    mocks.useMessageScroll.mockReturnValue({
      messagesEndRef: { current: null },
      messagesContainerRef: { current: null },
    })
    mocks.useMessageActions.mockReturnValue({
      forkConfirm: { id: "m1" },
      isForking: false,
      revertAction: { type: "undo" },
      isRevertBusy: false,
      handleForkStart: vi.fn(),
      handleForkConfirm: vi.fn(),
      handleRevert: vi.fn(),
      handleRevertConfirm: vi.fn(),
      handleRevertCancel: vi.fn(),
      handleRedoClick: vi.fn(),
      handleRestoreClick: vi.fn(),
      setForkConfirm: vi.fn(),
    })
  })

  it("分叉与撤销确认文案为中文", () => {
    render(<MessageList sessionID="s1" onUndoToInput={vi.fn()} />)

    expect(screen.getByText("会话已在此精简")).toBeInTheDocument()

    expect(screen.getByText("从此处新建会话")).toBeInTheDocument()
    expect(screen.getByText("要基于截至此处的消息新建会话吗？这会复制当前对话历史。")).toBeInTheDocument()
    expect(screen.getByText("新建")).toBeInTheDocument()

    expect(screen.getByText("撤销会话变更")).toBeInTheDocument()
    expect(screen.getByText("要撤销此消息之后的消息和文件变更吗？")).toBeInTheDocument()
    expect(screen.getByText("撤销")).toBeInTheDocument()
    expect(screen.getAllByText("取消").length).toBeGreaterThan(0)
  })
})
