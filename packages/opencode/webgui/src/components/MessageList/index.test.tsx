import { beforeEach, describe, expect, it, vi } from "vitest"
import { useState } from "react"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  useMessages: vi.fn(),
  useSession: vi.fn(),
  setReasoning: vi.fn(),
  setSessionIdle: vi.fn(),
  useMessageScroll: vi.fn(),
  useMessageActions: vi.fn(),
  useTopTrim: vi.fn(),
  preparePrepend: vi.fn(),
  cancelPrepend: vi.fn(),
}))

let passthrough = false

vi.mock("../../lib/api/sdkClient", () => ({
  sdk: {
    session: {
      messages: vi.fn(),
    },
    permissions: {
      respond: vi.fn(),
    },
    question: {
      reply: vi.fn(),
      reject: vi.fn(),
    },
  },
}))

vi.mock("../../state/MessagesContext", async () => {
  const mod = await vi.importActual<typeof import("../../state/MessagesContext")>("../../state/MessagesContext")
  return {
    ...mod,
    useMessages: (...args: Parameters<typeof mod.useMessages>) =>
      passthrough ? mod.useMessages(...args) : (mocks.useMessages(...args) as ReturnType<typeof mod.useMessages>),
  }
})

vi.mock("../../state/SessionContext", () => ({
  useSession: (...args: unknown[]) => mocks.useSession(...args),
}))

vi.mock("./hooks/useMessageScroll", () => ({
  useMessageScroll: (...args: unknown[]) => mocks.useMessageScroll(...args),
}))

vi.mock("./hooks/useMessageActions", () => ({
  useMessageActions: (...args: unknown[]) => mocks.useMessageActions(...args),
}))

vi.mock("./hooks/useTopTrim", () => ({
  useTopTrim: (...args: unknown[]) => mocks.useTopTrim(...args),
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
  RevertSummary: () => <div data-testid="revert-summary" />,
}))

vi.mock("./Parts/QuestionPart", () => ({
  QuestionPart: ({ request }: { request?: { id?: string; questions?: Array<{ header?: string }> } }) => (
    <div data-testid="question-part">
      <span data-testid="question-request-id">{request?.id ?? "unknown"}</span>
      <span data-testid="question-request-header">{request?.questions?.[0]?.header ?? "no-header"}</span>
    </div>
  ),
}))

vi.mock("../TypingIndicator", () => ({
  TypingIndicator: ({ visible }: { visible: boolean }) => (visible ? <div data-testid="typing-indicator" /> : null),
}))

import { MessageList } from "./index"
import { sdk } from "../../lib/api/sdkClient"
import { MessagesProvider, useMessages } from "../../state/MessagesContext"

function msg(id: string, created: number, summary?: boolean) {
  return {
    info: { id, role: "assistant", time: { created }, ...(summary ? { summary: true } : {}) },
    parts: [],
  }
}

function page(
  input?: Partial<{
    ready: boolean
    latestLoading: boolean
    olderLoading: boolean
    olderError: boolean
    complete: boolean
  }>,
) {
  return {
    ready: true,
    latestLoading: false,
    olderLoading: false,
    olderError: false,
    complete: false,
    ...input,
  }
}

function defer<T>() {
  let resolve: ((value: T) => void) | null = null
  let reject: ((reason?: unknown) => void) | null = null
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return {
    promise,
    resolve: (value: T) => resolve?.(value),
    reject: (reason?: unknown) => reject?.(reason),
  }
}

function msg2(id: string, sessionID: string, created: number) {
  return {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created },
    },
    parts: [],
  }
}

function page2(data: unknown[], cursor?: string | null) {
  return {
    error: null,
    data,
    response: {
      headers: new Headers(cursor ? { "X-Next-Cursor": cursor } : {}),
    },
  }
}

let api: ReturnType<typeof useMessages> | null = null

function Capture() {
  api = useMessages()
  return null
}

describe("MessageList", () => {
  beforeEach(() => {
    passthrough = false
    mocks.preparePrepend.mockReset()
    mocks.cancelPrepend.mockReset()
    mocks.useMessages.mockReturnValue({
      getMessagesBySession: () => [msg("m1", 1, true)],
      getQuestionsBySession: () => [],
      getSessionPagination: () => page(),
      loadOlder: vi.fn(async () => []),
      permissions: [],
    })
    mocks.useSession.mockReturnValue({
      isIdle: true,
      isReasoning: false,
      currentSession: null,
      setReasoning: mocks.setReasoning,
      setSessionIdle: mocks.setSessionIdle,
    })
    mocks.useMessageScroll.mockReturnValue({
      messagesEndRef: { current: null },
      messagesContainerRef: { current: null },
      showScrollToBottom: false,
      scrollToBottom: vi.fn(),
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
    mocks.useTopTrim.mockReturnValue({
      topRef: { current: null },
      top: 0,
      visible: [
        {
          id: "m1",
          kind: "history-summary",
          msg: msg("m1", 1, true),
        },
      ],
      row: () => vi.fn(),
      preparePrepend: mocks.preparePrepend,
      cancelPrepend: mocks.cancelPrepend,
    })
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mockReset()
    mocks.setReasoning.mockReset()
    mocks.setSessionIdle.mockReset()
    api = null
  })

  it("分叉与撤销确认文案为中文", () => {
    render(<MessageList sessionID="s1" onUndoToInput={vi.fn()} />)

    expect(screen.getAllByText("会话已在此精简").length).toBeGreaterThan(0)
    expect(screen.getByText("从此处新建会话")).toBeInTheDocument()
    expect(screen.getByText("要基于截至此处的消息新建会话吗？这会复制当前对话历史。")).toBeInTheDocument()
    expect(screen.getByText("新建")).toBeInTheDocument()
    expect(screen.getByText("撤销会话变更")).toBeInTheDocument()
    expect(screen.getByText("要撤销此消息之后的消息和文件变更吗？")).toBeInTheDocument()
    expect(screen.getByText("撤销")).toBeInTheDocument()
    expect(screen.getAllByText("取消").length).toBeGreaterThan(0)
  })

  it("拆分 history 与 tail 区并保留尾部元素", () => {
    mocks.useMessages.mockReturnValue({
      getMessagesBySession: () => [msg("m1", 1)],
      getQuestionsBySession: () => [{ id: "q1" }],
      getSessionPagination: () => page(),
      loadOlder: vi.fn(async () => []),
      permissions: [],
    })
    mocks.useSession.mockReturnValue({ isIdle: false, isReasoning: false, currentSession: null })

    const view = render(<MessageList sessionID="s1" onUndoToInput={vi.fn()} />)

    expect(view.container.querySelector("[data-testid='history-zone']")).toBeTruthy()
    expect(view.container.querySelector("[data-testid='tail-zone']")).toBeTruthy()
    expect(view.container.querySelector("[data-testid='tail-anchor']")).toBeTruthy()
    expect(screen.getByTestId("question-part")).toBeInTheDocument()
    expect(screen.getByTestId("typing-indicator")).toBeInTheDocument()

    const parent = screen.getByTestId("message-scroll-shell").parentElement as HTMLElement
    expect(parent.style.overflowAnchor).toBe("none")
  })

  it("消息列表根容器使用 flex gap 统一消息间距", () => {
    render(<MessageList sessionID="s1" onUndoToInput={vi.fn()} />)

    const root = screen.getByTestId("message-scroll-root")
    expect(root).toHaveClass("flex", "flex-col", "gap-4")
    expect(root).not.toHaveClass("space-y-4")
  })

  it("showScrollToBottom=false 时不渲染 sticky layer 与按钮", () => {
    render(<MessageList sessionID="s1" onUndoToInput={vi.fn()} />)

    expect(screen.queryByTestId("scroll-to-bottom-layer")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "滚动到底部" })).not.toBeInTheDocument()
  })

  it("scroll-to-bottom-layer 作为 overlay 渲染，不参与 message-scroll-shell 文档流", () => {
    const scrollToBottom = vi.fn()
    mocks.useMessageScroll.mockReturnValue({
      messagesEndRef: { current: null },
      messagesContainerRef: { current: null },
      mode: "detached",
      showScrollToBottom: true,
      scrollToBottom,
      runProgrammaticScroll: vi.fn(),
    })

    render(<MessageList sessionID="s1" onUndoToInput={vi.fn()} />)

    const shell = screen.getByTestId("message-scroll-shell")
    const layer = screen.getByTestId("scroll-to-bottom-layer")
    expect(shell).not.toContainElement(layer)
    expect(layer).toHaveClass("sticky", "bottom-0", "z-30", "flex", "h-0", "justify-end", "pr-2", "pointer-events-none")
    expect(screen.getByTestId("scroll-to-bottom-offset")).toHaveClass("-translate-y-[calc(100%+2rem)]")

    fireEvent.click(screen.getByRole("button", { name: "滚动到底部" }))
    expect(scrollToBottom).toHaveBeenCalledTimes(1)
  })

  it("message-scroll-shell 保持直接挂在外部滚动宿主下，避免 Hook 绑定到 overlay 包裹层", () => {
    mocks.useMessageScroll.mockReturnValue({
      messagesEndRef: { current: null },
      messagesContainerRef: { current: null },
      mode: "detached",
      showScrollToBottom: true,
      scrollToBottom: vi.fn(),
      runProgrammaticScroll: vi.fn(),
    })

    render(
      <main data-testid="scroll-host">
        <MessageList sessionID="s1" onUndoToInput={vi.fn()} />
      </main>,
    )

    const host = screen.getByTestId("scroll-host")
    const shell = screen.getByTestId("message-scroll-shell")
    const layer = screen.getByTestId("scroll-to-bottom-layer")

    expect(shell.parentElement).toBe(host)
    expect(layer.parentElement).toBe(host)
  })

  it("发送意图 key 会传给滚动 Hook", () => {
    const { rerender } = render(<MessageList sessionID="s1" onUndoToInput={vi.fn()} sendRequestKey={0} />)

    rerender(<MessageList sessionID="s1" onUndoToInput={vi.fn()} sendRequestKey={1} />)

    expect(mocks.useMessageScroll).toHaveBeenLastCalledWith(
      "s1",
      expect.any(Array),
      true,
      false,
      expect.any(Boolean),
      expect.any(Object),
      expect.any(Object),
      expect.any(String),
      1,
    )
  })

  it("history 与 tail 各自的消息行容器使用与单条消息内部一致的 12px 间距", () => {
    mocks.useMessages.mockReturnValue({
      getMessagesBySession: () => [msg("m1", 1), msg("m2", 2)],
      getQuestionsBySession: () => [{ id: "q1" }],
      getSessionPagination: () => page(),
      loadOlder: vi.fn(async () => []),
      permissions: [],
    })
    mocks.useSession.mockReturnValue({ isIdle: false, isReasoning: false, currentSession: null })
    mocks.useTopTrim.mockReturnValue({
      topRef: { current: null },
      top: 0,
      visible: [
        {
          id: "m1",
          kind: "history-message",
          msg: msg("m1", 1),
        },
        {
          id: "m2",
          kind: "history-message",
          msg: msg("m2", 2),
        },
      ],
      row: () => vi.fn(),
      preparePrepend: mocks.preparePrepend,
      cancelPrepend: mocks.cancelPrepend,
    })

    render(<MessageList sessionID="s1" onUndoToInput={vi.fn()} />)

    const historyRows = screen.getByTestId("history-rows")
    const tailRows = screen.getByTestId("tail-rows")

    expect(historyRows).toHaveClass("flex", "flex-col", "gap-3")
    expect(tailRows).toHaveClass("flex", "flex-col", "gap-3")
  })

  it("没有消息但有尾部问题时不显示 EmptyState", () => {
    mocks.useMessages.mockReturnValue({
      getMessagesBySession: () => [],
      getQuestionsBySession: () => [{ id: "q1" }],
      getSessionPagination: () => page(),
      loadOlder: vi.fn(async () => []),
      permissions: [],
    })

    render(<MessageList sessionID="s1" onUndoToInput={vi.fn()} />)

    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument()
    expect(screen.getByTestId("question-part")).toBeInTheDocument()
  })

  it("未完成问题仍走现有 QuestionPart 交互路径", () => {
    mocks.useMessages.mockReturnValue({
      getMessagesBySession: () => [],
      getQuestionsBySession: () => [
        {
          id: "q-pending",
          sessionID: "s1",
          questions: [
            {
              header: "来源",
              question: "应该从哪个 GitHub Release 页面查询更新？",
              options: [{ label: "当前项目自身的 Release", description: "当前项目 repo 的 Release" }],
            },
          ],
        },
      ],
      getSessionPagination: () => page(),
      loadOlder: vi.fn(async () => []),
      permissions: [],
    })

    render(<MessageList sessionID="s1" onUndoToInput={vi.fn()} />)

    expect(screen.getByTestId("question-part")).toBeInTheDocument()
    expect(screen.getByTestId("question-request-id")).toHaveTextContent("q-pending")
    expect(screen.getByTestId("question-request-header")).toHaveTextContent("来源")
  })

  it("session 存在且消息与问题都为空时显示 EmptyState", () => {
    mocks.useMessages.mockReturnValue({
      getMessagesBySession: () => [],
      getQuestionsBySession: () => [],
      getSessionPagination: () => page(),
      loadOlder: vi.fn(async () => []),
      permissions: [],
    })

    render(<MessageList sessionID="s1" onUndoToInput={vi.fn()} />)

    expect(screen.getByTestId("empty-state")).toBeInTheDocument()
  })

  it("latest page 未 ready 时隐藏顶部加载条", () => {
    mocks.useMessages.mockReturnValue({
      getMessagesBySession: () => [msg("m1", 1)],
      getQuestionsBySession: () => [],
      getSessionPagination: () => page({ ready: false, latestLoading: true }),
      loadOlder: vi.fn(async () => []),
      permissions: [],
    })

    render(<MessageList sessionID="s1" onUndoToInput={vi.fn()} />)

    expect(screen.queryByRole("button", { name: "加载更早消息" })).not.toBeInTheDocument()
    expect(screen.queryByText("正在加载…")).not.toBeInTheDocument()
  })

  it.each([
    ["可加载", page(), "加载更早消息", false],
    ["正在加载", page({ olderLoading: true }), "正在加载…", true],
    ["失败", page({ olderError: true }), "加载失败，点击重试", false],
  ])("ready 后顶部条展示%s状态", (_name, state, text, disabled) => {
    mocks.useMessages.mockReturnValue({
      getMessagesBySession: () => [msg("m1", 1)],
      getQuestionsBySession: () => [],
      getSessionPagination: () => state,
      loadOlder: vi.fn(async () => []),
      permissions: [],
    })

    render(<MessageList sessionID="s1" onUndoToInput={vi.fn()} />)

    const bar = screen.getByRole("button", { name: text })
    expect(bar).toBeInTheDocument()
    expect(bar).toHaveProperty("disabled", disabled)
  })

  it("complete 时隐藏顶部条", () => {
    mocks.useMessages.mockReturnValue({
      getMessagesBySession: () => [msg("m1", 1)],
      getQuestionsBySession: () => [],
      getSessionPagination: () => page({ complete: true }),
      loadOlder: vi.fn(async () => []),
      permissions: [],
    })

    render(<MessageList sessionID="s1" onUndoToInput={vi.fn()} />)

    expect(screen.queryByTestId("history-load-bar")).not.toBeInTheDocument()
    expect(screen.queryByText("已加载全部消息")).not.toBeInTheDocument()
  })

  it("点击顶部条时按 preparePrepend -> loadOlder(sessionID) 调用", () => {
    const calls: string[] = []
    mocks.preparePrepend.mockImplementation(() => {
      calls.push("prepare")
    })
    const loadOlder = vi.fn(async () => {
      calls.push("load")
      return []
    })
    mocks.useMessages.mockReturnValue({
      getMessagesBySession: () => [msg("m1", 1), msg("m2", 2)],
      getQuestionsBySession: () => [],
      getSessionPagination: () => page(),
      loadOlder,
      permissions: [],
    })

    render(<MessageList sessionID="s1" onUndoToInput={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "加载更早消息" }))

    expect(mocks.preparePrepend).toHaveBeenCalledTimes(1)
    expect(loadOlder).toHaveBeenCalledWith("s1")
    expect(calls).toEqual(["prepare", "load"])
  })

  it.each([
    ["空结果", vi.fn(async () => [])],
    [
      "失败",
      vi.fn(async () => {
        throw new Error("boom")
      }),
    ],
    ["重复结果", vi.fn(async () => [msg("m1", 1)])],
  ])("loadOlder %s 时不会由 MessageList 主动 cancelPrepend", async (_name, loadOlder) => {
    mocks.useMessages.mockReturnValue({
      getMessagesBySession: () => [msg("m1", 1), msg("m2", 2)],
      getQuestionsBySession: () => [],
      getSessionPagination: () => page(),
      loadOlder,
      permissions: [],
    })

    render(<MessageList sessionID="s1" onUndoToInput={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "加载更早消息" }))

    await waitFor(() => {
      expect(loadOlder).toHaveBeenCalledWith("s1")
    })
    expect(mocks.cancelPrepend).not.toHaveBeenCalled()
  })

  it("loading 时顶部条不可重复点击", () => {
    const loadOlder = vi.fn(async () => [])
    mocks.useMessages.mockReturnValue({
      getMessagesBySession: () => [msg("m1", 1), msg("m2", 2)],
      getQuestionsBySession: () => [],
      getSessionPagination: () => page({ olderLoading: true }),
      loadOlder,
      permissions: [],
    })

    render(<MessageList sessionID="s1" onUndoToInput={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "正在加载…" }))

    expect(loadOlder).not.toHaveBeenCalled()
  })

  it("失败态点击重试后先清掉局部 error 并进入 loading，完成后再回落", async () => {
    let pageState = page({ olderError: true })
    let done: (() => void) | undefined
    let bump: React.Dispatch<React.SetStateAction<number>> | undefined
    const loadOlder = vi.fn(
      () =>
        new Promise<unknown[]>((resolve) => {
          pageState = page({ olderLoading: true })
          bump?.((x) => x + 1)
          done = () => {
            pageState = page()
            bump?.((x) => x + 1)
            resolve([])
          }
        }),
    )
    mocks.useMessages.mockImplementation(() => ({
      getMessagesBySession: () => [msg("m1", 1), msg("m2", 2)],
      getQuestionsBySession: () => [],
      getSessionPagination: () => pageState,
      loadOlder,
      permissions: [],
    }))

    function Host() {
      const [, set] = useState(0)
      bump = set
      return <MessageList sessionID="s1" onUndoToInput={vi.fn()} />
    }

    render(<Host />)
    fireEvent.click(screen.getByTestId("history-load-bar"))

    expect(loadOlder).toHaveBeenCalledWith("s1")
    expect(screen.queryByRole("button", { name: "加载失败，点击重试" })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "正在加载…" })).toBeDisabled()

    await act(async () => {
      done?.()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "加载更早消息" })).toBeInTheDocument()
    })
  })

  it("顶部条位于 spacer 之后、history rows 之前，且自身不参与 trim", () => {
    mocks.useMessages.mockReturnValue({
      getMessagesBySession: () => [msg("m1", 1), msg("m2", 2)],
      getQuestionsBySession: () => [],
      getSessionPagination: () => page(),
      loadOlder: vi.fn(async () => []),
      permissions: [],
    })

    render(<MessageList sessionID="s1" onUndoToInput={vi.fn()} />)
    const zone = screen.getByTestId("history-zone")
    const spacer = screen.getByTestId("history-trim-spacer")
    const bar = screen.getByTestId("history-load-bar")
    const row = screen.getAllByTestId("trim-row")[0]

    expect(zone.compareDocumentPosition(spacer) & Node.DOCUMENT_POSITION_CONTAINED_BY).toBeTruthy()
    expect(spacer.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(bar.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(bar.getAttribute("data-testid")).toBe("history-load-bar")
  })

  it("顶部条只消费 getSessionPagination：分页状态变化时会跟随 context 更新", async () => {
    passthrough = true
    mocks.useSession.mockReturnValue({
      isIdle: true,
      isReasoning: false,
      currentSession: null,
      setReasoning: mocks.setReasoning,
      setSessionIdle: mocks.setSessionIdle,
    })

    const older1 = defer<unknown>()
    const older2 = defer<unknown>()

    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(page2([msg2("m3", "s1", 3), msg2("m4", "s1", 4)], "c1"))
      .mockImplementationOnce(() => older1.promise)
      .mockImplementationOnce(() => older2.promise)

    render(
      <MessagesProvider>
        <Capture />
        <MessageList sessionID="s1" onUndoToInput={vi.fn()} />
      </MessagesProvider>,
    )

    await act(async () => {
      await api?.loadLatest("s1")
    })

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "加载更早消息" })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole("button", { name: "加载更早消息" }))
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "正在加载…" })).toBeDisabled()
    })

    await act(async () => {
      older1.resolve({ error: new Error("boom"), data: null, response: { headers: new Headers() } })
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "加载失败，点击重试" })).toBeInTheDocument()
    })

    fireEvent.click(screen.getByRole("button", { name: "加载失败，点击重试" }))
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "正在加载…" })).toBeDisabled()
    })

    await act(async () => {
      older2.resolve(page2([msg2("m1", "s1", 1), msg2("m2", "s1", 2)], null))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(screen.queryByTestId("history-load-bar")).not.toBeInTheDocument()
    })
    expect((sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3)
  })

  it("历史被回退为空时仍显示 RevertSummary，而不是 EmptyState", () => {
    mocks.useMessages.mockReturnValue({
      getMessagesBySession: () => [msg("m1", 1)],
      getQuestionsBySession: () => [],
      getSessionPagination: () => page(),
      loadOlder: vi.fn(async () => []),
      permissions: [],
    })
    mocks.useSession.mockReturnValue({
      isIdle: true,
      isReasoning: false,
      currentSession: { revert: { messageID: "m1" } },
    })

    render(<MessageList sessionID="s1" onUndoToInput={vi.fn()} />)

    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument()
    expect(screen.getByTestId("revert-summary")).toBeInTheDocument()
  })

  it("revert boundary 在旧页时隐藏最新页并继续加载", async () => {
    const loadOlder = vi.fn(async () => [])
    mocks.useMessages.mockReturnValue({
      getMessagesBySession: () => [msg("after-boundary", 10)],
      getQuestionsBySession: () => [],
      getSessionPagination: () => page({ complete: false, olderLoading: false }),
      loadOlder,
      permissions: [],
    })
    mocks.useSession.mockReturnValue({
      isIdle: true,
      isReasoning: false,
      currentSession: { id: "s1", revert: { messageID: "boundary" } },
    })
    mocks.useTopTrim.mockReturnValue({
      topRef: { current: null },
      top: 0,
      visible: [],
      row: () => vi.fn(),
    })

    render(<MessageList sessionID="s1" />)

    expect(screen.queryByTestId("message-row")).not.toBeInTheDocument()
    await waitFor(() => expect(loadOlder).toHaveBeenCalledWith("s1"))
  })

  it("自动追溯遇到 olderError 时停止，保留现有 retry UI", () => {
    const loadOlder = vi.fn(async () => [])
    mocks.useMessages.mockReturnValue({
      getMessagesBySession: () => [msg("after-boundary", 10)],
      getQuestionsBySession: () => [],
      getSessionPagination: () => page({ olderError: true }),
      getSessionCursor: () => "c1",
      loadOlder,
      permissions: [],
    })
    mocks.useSession.mockReturnValue({
      isIdle: true,
      isReasoning: false,
      currentSession: { id: "s1", revert: { messageID: "boundary" } },
    })

    render(<MessageList sessionID="s1" />)

    expect(screen.getByRole("button", { name: "加载失败，点击重试" })).toBeInTheDocument()
    expect(loadOlder).not.toHaveBeenCalled()
  })

  it("自动追溯不会对同一 cursor 重复请求", async () => {
    let calls = 0

    function Host() {
      const [olderLoading, setOlderLoading] = useState(false)
      const [settled, setSettled] = useState(false)
      const loadOlder = vi.fn(async () => {
        calls += 1
        if (calls !== 1) return []
        setOlderLoading(true)
        queueMicrotask(() => {
          setOlderLoading(false)
          setSettled(true)
        })
        return []
      })
      mocks.useMessages.mockReturnValue({
        getMessagesBySession: () => [msg("after-boundary", 10)],
        getQuestionsBySession: () => [],
        getSessionPagination: () => page({ olderLoading }),
        getSessionCursor: () => "c1",
        loadOlder,
        permissions: [],
      })
      mocks.useSession.mockReturnValue({
        isIdle: true,
        isReasoning: false,
        currentSession: { id: "s1", revert: { messageID: "boundary" } },
      })
      return (
        <>
          <MessageList sessionID="s1" />
          {settled && <div data-testid="settled" />}
        </>
      )
    }

    render(<Host />)

    await screen.findByTestId("settled")
    expect(calls).toBe(1)
  })

  it("自动追溯随 cursor 前进直到 complete", async () => {
    const seen: string[] = []

    function Host() {
      const [index, setIndex] = useState(0)
      const cursors = ["c1", "c2"]
      mocks.useMessages.mockReturnValue({
        getMessagesBySession: () => [msg("after-boundary", 10)],
        getQuestionsBySession: () => [],
        getSessionPagination: () => page({ complete: index === cursors.length }),
        getSessionCursor: () => cursors[index],
        loadOlder: async () => {
          seen.push(cursors[index])
          setIndex((value) => value + 1)
          return []
        },
        permissions: [],
      })
      mocks.useSession.mockReturnValue({
        isIdle: true,
        isReasoning: false,
        currentSession: { id: "s1", revert: { messageID: "boundary" } },
      })
      return (
        <>
          <MessageList sessionID="s1" />
          <div data-testid={`cursor-${index}`} />
        </>
      )
    }

    render(<Host />)

    await screen.findByTestId("cursor-2")
    expect(seen).toEqual(["c1", "c2"])
  })
})
