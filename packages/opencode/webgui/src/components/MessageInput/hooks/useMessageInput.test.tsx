import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const root = {
    getTextContent: vi.fn(() => "/status"),
    clear: vi.fn(),
    append: vi.fn(),
  }
  return {
    root,
    setSessionIdle: vi.fn(),
    showToast: vi.fn(),
    addMessage: vi.fn(),
    setMessages: vi.fn(),
    command: vi.fn(async (_input: unknown) => ({ data: {}, error: null })),
    prompt: vi.fn(async (_input: unknown) => ({ data: {}, error: null })),
    abort: vi.fn(async (_input: unknown) => ({ data: true, error: null })),
    getQuestionsBySession: vi.fn(() => []),
    rejectQuestion: vi.fn(async (_requestID: string) => true),
    uiBridgeDraftSessionId: vi.fn((): string | null => null),
    uiBridgeUpdateDraftSessionId: vi.fn(),
  }
})

vi.mock("lexical", () => {
  return {
    $getRoot: () => mocks.root,
    $createParagraphNode: () => ({ append: vi.fn() }),
    $createTextNode: (value: string) => ({ value }),
  }
})

vi.mock("../../../lib/api/sdkClient", () => {
  return {
    sdk: {
      session: {
        command: (input: unknown) => mocks.command(input),
        prompt: (input: unknown) => mocks.prompt(input),
        abort: (input: unknown) => mocks.abort(input),
        summarize: vi.fn(async () => ({ data: true, error: null })),
      },
    },
  }
})

vi.mock("../../../state/SessionContext", () => {
  return {
    useSession: () => ({
      setSessionIdle: mocks.setSessionIdle,
    }),
  }
})

vi.mock("../../../state/ToastContext", () => {
  return {
    useToast: () => ({ showToast: mocks.showToast }),
  }
})

vi.mock("../../../state/MessagesContext", () => {
  return {
    useMessages: () => ({
      addMessage: mocks.addMessage,
      setMessages: mocks.setMessages,
      getQuestionsBySession: mocks.getQuestionsBySession,
      rejectQuestion: mocks.rejectQuestion,
    }),
  }
})

vi.mock("../../../lib/messagesStore", () => {
  return {
    createOptimisticUserMessage: vi.fn(() => ({ info: { id: "m1" }, parts: [] })),
    removeOptimisticMessages: vi.fn((value: unknown) => value),
  }
})

vi.mock("../../../state/uiBridgeState", () => {
  return {
    uiBridgeDraftSessionId: () => mocks.uiBridgeDraftSessionId(),
    uiBridgeUpdateDraftSessionId: (id: string | null) => mocks.uiBridgeUpdateDraftSessionId(id),
  }
})

import { useMessageInput } from "./useMessageInput"

describe("useMessageInput", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.root.getTextContent.mockReturnValue("/status")
    mocks.command.mockResolvedValue({ data: {}, error: null })
    mocks.prompt.mockResolvedValue({ data: {}, error: null })
    mocks.abort.mockResolvedValue({ data: true, error: null })
    mocks.getQuestionsBySession.mockReturnValue([])
    mocks.rejectQuestion.mockResolvedValue(true)
    mocks.uiBridgeDraftSessionId.mockReturnValue(null)
  })

  it("命令发送成功后，若当前会话是草稿则清空 draftSessionId", async () => {
    const editor = {
      getEditorState: () => ({
        read: (fn: () => void) => fn(),
      }),
      update: (fn: () => void) => fn(),
      focus: vi.fn(),
    } as any

    mocks.uiBridgeDraftSessionId.mockReturnValue("s-draft")

    const { result } = renderHook(() =>
      useMessageInput({
        sessionID: "s-draft",
        editor,
        isEmpty: false,
        selectedProviderId: "openai",
        selectedModelId: "gpt-4.1",
        selectedAgent: "build",
        selectedVariant: undefined,
        extractMessageParts: vi.fn(() => []),
      }),
    )

    await act(async () => {
      await result.current.handleSubmit()
    })

    expect(mocks.uiBridgeUpdateDraftSessionId).toHaveBeenCalledWith(null)
    expect(mocks.command).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: "s-draft" },
      }),
    )
  })

  it("发送失败时不应清空 draftSessionId", async () => {
    mocks.command.mockRejectedValue(new Error("Failed to execute command"))

    const editor = {
      getEditorState: () => ({
        read: (fn: () => void) => fn(),
      }),
      update: (fn: () => void) => fn(),
      focus: vi.fn(),
    } as any

    mocks.uiBridgeDraftSessionId.mockReturnValue("s-draft")

    const { result } = renderHook(() =>
      useMessageInput({
        sessionID: "s-draft",
        editor,
        isEmpty: false,
        selectedProviderId: "openai",
        selectedModelId: "gpt-4.1",
        selectedAgent: "build",
        selectedVariant: undefined,
        extractMessageParts: vi.fn(() => []),
      }),
    )

    await act(async () => {
      await result.current.handleSubmit()
    })

    expect(mocks.uiBridgeUpdateDraftSessionId).not.toHaveBeenCalled()
    expect(mocks.command).toHaveBeenCalledTimes(1)
    expect(mocks.showToast).toHaveBeenCalledTimes(1)
  })

  it("普通消息发送成功后会清空匹配的 draftSessionId", async () => {
    mocks.root.getTextContent.mockReturnValue("hello")

    const editor = {
      getEditorState: () => ({
        read: (fn: () => void) => fn(),
      }),
      update: (fn: () => void) => fn(),
      focus: vi.fn(),
    } as any

    mocks.uiBridgeDraftSessionId.mockReturnValue("s-1")

    const { result } = renderHook(() =>
      useMessageInput({
        sessionID: "s-1",
        editor,
        isEmpty: false,
        selectedProviderId: "openai",
        selectedModelId: "gpt-4.1",
        selectedAgent: "build",
        selectedVariant: undefined,
        extractMessageParts: vi.fn(() => [{ type: "text", text: "hello" }]),
      }),
    )

    await act(async () => {
      await result.current.handleSubmit()
    })

    expect(mocks.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: "s-1" },
      }),
    )
    expect(mocks.command).not.toHaveBeenCalled()
    expect(mocks.uiBridgeUpdateDraftSessionId).toHaveBeenCalledWith(null)
  })

  it("Stop 时 reject 部分失败也会继续 abort", async () => {
    mocks.getQuestionsBySession.mockReturnValue([{ id: "q1" }, { id: "q2" }, { id: "q3" }] as any)
    mocks.rejectQuestion
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      // 防御性测试：rejectQuestion 内部有 try/catch 不会实际抛出，
      // 但 Promise.allSettled 仍应安全处理 rejected 状态
      .mockRejectedValueOnce(new Error("reject fail"))

    const editor = {
      getEditorState: () => ({
        read: (fn: () => void) => fn(),
      }),
      update: (fn: () => void) => fn(),
      focus: vi.fn(),
    } as any

    const { result } = renderHook(() =>
      useMessageInput({
        sessionID: "s-1",
        editor,
        isEmpty: false,
        selectedProviderId: "openai",
        selectedModelId: "gpt-4.1",
        selectedAgent: "build",
        selectedVariant: undefined,
        extractMessageParts: vi.fn(() => [{ type: "text", text: "x" }]),
      }),
    )

    await act(async () => {
      await result.current.handleAbort()
    })

    expect(mocks.rejectQuestion).toHaveBeenCalledTimes(3)
    expect(mocks.rejectQuestion).toHaveBeenNthCalledWith(1, "q1")
    expect(mocks.rejectQuestion).toHaveBeenNthCalledWith(2, "q2")
    expect(mocks.rejectQuestion).toHaveBeenNthCalledWith(3, "q3")
    expect(mocks.abort).toHaveBeenCalledWith({ path: { id: "s-1" } })
    expect(mocks.abort).toHaveBeenCalledTimes(1)
  })

  it("0 条 pending question 时直接 abort", async () => {
    mocks.getQuestionsBySession.mockReturnValue([])

    const editor = {
      getEditorState: () => ({
        read: (fn: () => void) => fn(),
      }),
      update: (fn: () => void) => fn(),
      focus: vi.fn(),
    } as any

    const { result } = renderHook(() =>
      useMessageInput({
        sessionID: "s-2",
        editor,
        isEmpty: false,
        selectedProviderId: "openai",
        selectedModelId: "gpt-4.1",
        selectedAgent: "build",
        selectedVariant: undefined,
        extractMessageParts: vi.fn(() => [{ type: "text", text: "x" }]),
      }),
    )

    await act(async () => {
      await result.current.handleAbort()
    })

    expect(mocks.rejectQuestion).not.toHaveBeenCalled()
    expect(mocks.abort).toHaveBeenCalledWith({ path: { id: "s-2" } })
    expect(mocks.abort).toHaveBeenCalledTimes(1)
    expect(mocks.setSessionIdle).toHaveBeenCalledWith("s-2", true)
  })

  it("abort 失败时仍恢复 sessionIdle 状态", async () => {
    mocks.abort.mockRejectedValueOnce(new Error("network error"))

    const editor = {
      getEditorState: () => ({
        read: (fn: () => void) => fn(),
      }),
      update: (fn: () => void) => fn(),
      focus: vi.fn(),
    } as any

    const { result } = renderHook(() =>
      useMessageInput({
        sessionID: "s-3",
        editor,
        isEmpty: false,
        selectedProviderId: "openai",
        selectedModelId: "gpt-4.1",
        selectedAgent: "build",
        selectedVariant: undefined,
        extractMessageParts: vi.fn(() => [{ type: "text", text: "x" }]),
      }),
    )

    await act(async () => {
      await result.current.handleAbort()
    })

    expect(mocks.setSessionIdle).toHaveBeenCalledWith("s-3", true)
    expect(mocks.showToast).toHaveBeenCalledTimes(1)
  })
})
