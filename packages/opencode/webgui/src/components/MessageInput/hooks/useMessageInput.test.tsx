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
    commandList: vi.fn(async () => ({ data: [{ name: "status" }, { name: "review" }], error: null })),
    command: vi.fn(async (_input: unknown) => ({ data: {}, error: null })),
    prompt: vi.fn(async (_input: unknown) => ({ data: {}, error: null })),
    summarize: vi.fn(async (_input: unknown): Promise<any> => ({ data: true, error: null })),
    abort: vi.fn(async (_input: unknown) => ({ data: true, error: null })),
    getQuestionsBySession: vi.fn(() => []),
    rejectQuestion: vi.fn(async (_requestID: string) => true),
    loadDraftSession: vi.fn(async (): Promise<string | null> => null),
    saveDraftSession: vi.fn(async (_value: string | null) => ({ ok: true })),
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
      command: {
        list: () => mocks.commandList(),
      },
      session: {
        command: (input: unknown) => mocks.command(input),
        prompt: (input: unknown) => mocks.prompt(input),
        abort: (input: unknown) => mocks.abort(input),
        summarize: (input: unknown) => mocks.summarize(input),
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
    removeMessage: vi.fn((value: unknown) => value),
  }
})

vi.mock("../../../state/repo/draftRepo", () => {
  return {
    loadDraftSession: () => mocks.loadDraftSession(),
    saveDraftSession: (value: string | null) => mocks.saveDraftSession(value),
  }
})

import { resetSlashInputCache } from "./resolveSlashInput"
import { useMessageInput } from "./useMessageInput"

describe("useMessageInput", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSlashInputCache()
    mocks.root.getTextContent.mockReturnValue("/status")
    mocks.commandList.mockResolvedValue({
      data: [{ name: "status" }, { name: "review" }],
      error: null,
    })
    mocks.command.mockResolvedValue({ data: {}, error: null })
    mocks.prompt.mockResolvedValue({ data: {}, error: null })
    mocks.summarize.mockResolvedValue({ data: true, error: null })
    mocks.abort.mockResolvedValue({ data: true, error: null })
    mocks.getQuestionsBySession.mockReturnValue([])
    mocks.rejectQuestion.mockResolvedValue(true)
    mocks.loadDraftSession.mockResolvedValue(null)
  })

  it("prompt overflow 时展示后端返回文案并恢复 idle", async () => {
    mocks.root.getTextContent.mockReturnValue("hello")
    mocks.prompt.mockRejectedValueOnce({
      data: { message: "上下文超出限制，请先压缩会话" },
    })

    const editor = {
      getEditorState: () => ({
        read: (fn: () => void) => fn(),
      }),
      update: (fn: () => void) => fn(),
      focus: vi.fn(),
    } as any

    const { result } = renderHook(() =>
      useMessageInput({
        sessionID: "s-overflow",
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

    expect(mocks.showToast).toHaveBeenCalledWith("上下文超出限制，请先压缩会话", {
      title: "发送失败",
      variant: "error",
      duration: 8000,
    })
    expect(mocks.setSessionIdle).toHaveBeenNthCalledWith(1, "s-overflow", false)
    expect(mocks.setSessionIdle).toHaveBeenLastCalledWith("s-overflow", true)
  })

  it("发送失败时保留原始 Error 对象给 onError", async () => {
    mocks.root.getTextContent.mockReturnValue("hello")
    const err = new Error("network down")
    mocks.prompt.mockRejectedValueOnce(err)

    const editor = {
      getEditorState: () => ({
        read: (fn: () => void) => fn(),
      }),
      update: (fn: () => void) => fn(),
      focus: vi.fn(),
    } as any
    const onError = vi.fn()

    const { result } = renderHook(() =>
      useMessageInput({
        sessionID: "s-error",
        editor,
        isEmpty: false,
        selectedProviderId: "openai",
        selectedModelId: "gpt-4.1",
        selectedAgent: "build",
        selectedVariant: undefined,
        extractMessageParts: vi.fn(() => [{ type: "text", text: "hello" }]),
        onError,
      }),
    )

    await act(async () => {
      await result.current.handleSubmit()
    })

    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError.mock.calls[0]?.[0]).toBe(err)
    expect(mocks.showToast).toHaveBeenCalledWith("network down", {
      title: "发送失败",
      variant: "error",
      duration: 8000,
    })
  })

  it("summarize 返回错误时显示压缩失败 toast", async () => {
    mocks.summarize.mockResolvedValueOnce({
      data: null,
      error: { data: { message: "压缩服务暂时不可用" } },
    })

    const editor = {
      getEditorState: () => ({
        read: (fn: () => void) => fn(),
      }),
      update: (fn: () => void) => fn(),
      focus: vi.fn(),
    } as any

    const { result } = renderHook(() =>
      useMessageInput({
        sessionID: "s-compact",
        editor,
        isEmpty: false,
        selectedProviderId: "openai",
        selectedModelId: "gpt-4.1",
        selectedAgent: "build",
        selectedVariant: undefined,
        extractMessageParts: vi.fn(() => [{ type: "text", text: "hello" }]),
      }),
    )

    const closeModal = vi.fn()

    await act(async () => {
      await result.current.handleCompact(closeModal)
    })

    expect(closeModal).toHaveBeenCalledTimes(1)
    expect(mocks.showToast).toHaveBeenCalledWith("压缩服务暂时不可用", {
      title: "压缩失败",
      variant: "error",
      duration: 8000,
    })
  })

  it("命令发送成功后，若当前会话是草稿则清空 draftSessionId", async () => {
    const editor = {
      getEditorState: () => ({
        read: (fn: () => void) => fn(),
      }),
      update: (fn: () => void) => fn(),
      focus: vi.fn(),
    } as any

    mocks.loadDraftSession.mockResolvedValue("s-draft")

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

    expect(mocks.saveDraftSession).toHaveBeenCalledWith(null)
    expect(mocks.command).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: "s-draft" },
      }),
    )
  })

  it("已知 slash quick phrase 仍走 command", async () => {
    const editor = {
      getEditorState: () => ({
        read: (fn: () => void) => fn(),
      }),
      update: (fn: () => void) => fn(),
      focus: vi.fn(),
    } as any

    const { result } = renderHook(() =>
      useMessageInput({
        sessionID: "s-known",
        editor,
        isEmpty: true,
        selectedProviderId: "openai",
        selectedModelId: "gpt-4.1",
        selectedAgent: "build",
        selectedVariant: undefined,
        extractMessageParts: vi.fn(() => []),
      }),
    )

    await act(async () => {
      await result.current.submitQuickPhrase("/review repo status")
    })

    expect(mocks.command).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: "s-known" },
        body: expect.objectContaining({
          command: "review",
          arguments: "repo status",
        }),
      }),
    )
    expect(mocks.prompt).not.toHaveBeenCalled()
  })

  it("未知 slash quick phrase 会按普通消息原样发送", async () => {
    mocks.commandList.mockResolvedValueOnce({
      data: [{ name: "status" }],
      error: null,
    })

    const editor = {
      getEditorState: () => ({
        read: (fn: () => void) => fn(),
      }),
      update: (fn: () => void) => fn(),
      focus: vi.fn(),
    } as any

    const { result } = renderHook(() =>
      useMessageInput({
        sessionID: "s-unknown",
        editor,
        isEmpty: true,
        selectedProviderId: "openai",
        selectedModelId: "gpt-4.1",
        selectedAgent: "build",
        selectedVariant: undefined,
        extractMessageParts: vi.fn(() => []),
      }),
    )

    await act(async () => {
      await result.current.submitQuickPhrase("/123 abc")
    })

    expect(mocks.command).not.toHaveBeenCalled()
    expect(mocks.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: "s-unknown" },
        body: expect.objectContaining({
          parts: [{ type: "text", text: "/123 abc" }],
        }),
      }),
    )
  })

  it("未知 slash editor submit 会按普通消息发送而不是命令", async () => {
    mocks.root.getTextContent.mockReturnValue("/123 abc")
    mocks.commandList.mockResolvedValueOnce({
      data: [{ name: "status" }],
      error: null,
    })

    const editor = {
      getEditorState: () => ({
        read: (fn: () => void) => fn(),
      }),
      update: (fn: () => void) => fn(),
      focus: vi.fn(),
    } as any

    const extractMessageParts = vi.fn(() => [{ type: "text", text: "/123 abc" }])

    const { result } = renderHook(() =>
      useMessageInput({
        sessionID: "s-editor-unknown",
        editor,
        isEmpty: false,
        selectedProviderId: "openai",
        selectedModelId: "gpt-4.1",
        selectedAgent: "build",
        selectedVariant: undefined,
        extractMessageParts,
      }),
    )

    await act(async () => {
      await result.current.handleSubmit()
    })

    expect(mocks.command).not.toHaveBeenCalled()
    expect(mocks.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: "s-editor-unknown" },
        body: expect.objectContaining({
          parts: [{ type: "text", text: "/123 abc" }],
        }),
      }),
    )
    expect(mocks.addMessage).toHaveBeenCalledTimes(1)
    expect(extractMessageParts).toHaveBeenCalledTimes(1)
  })

  it("slash 列表加载失败时会降级为普通消息", async () => {
    mocks.commandList.mockRejectedValueOnce(new Error("offline"))

    const editor = {
      getEditorState: () => ({
        read: (fn: () => void) => fn(),
      }),
      update: (fn: () => void) => fn(),
      focus: vi.fn(),
    } as any

    const { result } = renderHook(() =>
      useMessageInput({
        sessionID: "s-offline",
        editor,
        isEmpty: true,
        selectedProviderId: "openai",
        selectedModelId: "gpt-4.1",
        selectedAgent: "build",
        selectedVariant: undefined,
        extractMessageParts: vi.fn(() => []),
      }),
    )

    await act(async () => {
      await result.current.submitQuickPhrase("/review repo status")
    })

    expect(mocks.command).not.toHaveBeenCalled()
    expect(mocks.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: "s-offline" },
        body: expect.objectContaining({
          parts: [{ type: "text", text: "/review repo status" }],
        }),
      }),
    )
  })

  it("quick phrase send 不受 isEmpty 闭包影响", async () => {
    mocks.root.getTextContent.mockReturnValue("")

    const editor = {
      getEditorState: () => ({
        read: (fn: () => void) => fn(),
      }),
      update: (fn: () => void) => fn(),
      focus: vi.fn(),
    } as any

    const { result } = renderHook(() =>
      useMessageInput({
        sessionID: "s-quick",
        editor,
        isEmpty: true,
        selectedProviderId: "openai",
        selectedModelId: "gpt-4.1",
        selectedAgent: "build",
        selectedVariant: undefined,
        extractMessageParts: vi.fn(() => []),
      }),
    )

    await act(async () => {
      await result.current.submitQuickPhrase("请总结改动")
    })

    expect(mocks.prompt).toHaveBeenCalledTimes(1)
    expect(mocks.command).not.toHaveBeenCalled()
    expect(mocks.addMessage).not.toHaveBeenCalled()
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

    mocks.loadDraftSession.mockResolvedValue("s-draft")

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

    expect(mocks.saveDraftSession).not.toHaveBeenCalled()
    expect(mocks.command).toHaveBeenCalledTimes(1)
    expect(mocks.showToast).toHaveBeenCalledTimes(1)
  })

  it("quick phrase 发送失败不进入重试链路", async () => {
    mocks.prompt.mockRejectedValue(new Error("network"))

    const editor = {
      getEditorState: () => ({
        read: (fn: () => void) => fn(),
      }),
      update: (fn: () => void) => fn(),
      focus: vi.fn(),
    } as any

    const { result } = renderHook(() =>
      useMessageInput({
        sessionID: "s-phrase",
        editor,
        isEmpty: true,
        selectedProviderId: "openai",
        selectedModelId: "gpt-4.1",
        selectedAgent: "build",
        selectedVariant: undefined,
        extractMessageParts: vi.fn(() => []),
      }),
    )

    await act(async () => {
      await result.current.submitQuickPhrase("请总结改动")
    })

    expect(result.current.lastFailedMessage).toBe(null)
    expect(mocks.showToast).toHaveBeenCalledTimes(1)
    expect(mocks.saveDraftSession).not.toHaveBeenCalled()
    expect(mocks.setMessages).not.toHaveBeenCalled()
  })

  it("并发 quick phrase 仅处理最后一次失败/成功副作用", async () => {
    let firstResolve: ((value: any) => void) | null = null
    let secondResolve: ((value: any) => void) | null = null
    mocks.prompt
      .mockImplementationOnce(
        async () =>
          new Promise((resolve) => {
            firstResolve = resolve
          }),
      )
      .mockImplementationOnce(
        async () =>
          new Promise((resolve) => {
            secondResolve = resolve
          }),
      )

    const editor = {
      getEditorState: () => ({
        read: (fn: () => void) => fn(),
      }),
      update: (fn: () => void) => fn(),
      focus: vi.fn(),
    } as any

    const { result } = renderHook(() =>
      useMessageInput({
        sessionID: "s-race",
        editor,
        isEmpty: true,
        selectedProviderId: "openai",
        selectedModelId: "gpt-4.1",
        selectedAgent: "build",
        selectedVariant: undefined,
        extractMessageParts: vi.fn(() => []),
      }),
    )

    await act(async () => {
      void result.current.submitQuickPhrase("old")
      void result.current.submitQuickPhrase("new")
    })

    await act(async () => {
      secondResolve?.({ data: {}, error: null })
      firstResolve?.({ data: null, error: { data: { message: "late fail" } } })
    })

    expect(mocks.showToast).not.toHaveBeenCalled()
  })

  it("并发 editor 发送时旧请求失败也会清理自身 optimistic", async () => {
    mocks.root.getTextContent.mockReturnValue("hello")
    let firstReject: ((reason?: unknown) => void) | null = null
    let secondResolve: ((value: any) => void) | null = null
    mocks.prompt
      .mockImplementationOnce(
        async () =>
          new Promise((_resolve, reject) => {
            firstReject = reject
          }),
      )
      .mockImplementationOnce(
        async () =>
          new Promise((resolve) => {
            secondResolve = resolve
          }),
      )

    const editor = {
      getEditorState: () => ({
        read: (fn: () => void) => fn(),
      }),
      update: (fn: () => void) => fn(),
      focus: vi.fn(),
    } as any

    const { result } = renderHook(() =>
      useMessageInput({
        sessionID: "s-editor-race",
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
      void result.current.handleSubmit()
      void result.current.handleSubmit()
    })

    await act(async () => {
      secondResolve?.({ data: {}, error: null })
      firstReject?.(new Error("late fail"))
    })

    expect(mocks.setMessages).toHaveBeenCalled()
    expect(mocks.showToast).not.toHaveBeenCalled()
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

    mocks.loadDraftSession.mockResolvedValue("s-1")

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
    expect(mocks.saveDraftSession).toHaveBeenCalledWith(null)
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
    expect(mocks.abort.mock.invocationCallOrder[0]).toBeLessThan(mocks.rejectQuestion.mock.invocationCallOrder[0])
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

  it("abort error tuple keeps session busy", async () => {
    mocks.abort.mockResolvedValueOnce({ data: null, error: { message: "busy" } })
    mocks.getQuestionsBySession.mockReturnValue([{ id: "q1" }, { id: "q2" }])

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

    expect(mocks.rejectQuestion).not.toHaveBeenCalled()
    expect(mocks.setSessionIdle).not.toHaveBeenCalledWith("s-3", true)
    expect(mocks.showToast).toHaveBeenCalledWith("busy", expect.objectContaining({ variant: "error" }))
  })

  it("abort throw keeps session busy and shows the error", async () => {
    mocks.abort.mockRejectedValueOnce(new Error("network down"))

    const editor = {
      getEditorState: () => ({
        read: (fn: () => void) => fn(),
      }),
      update: (fn: () => void) => fn(),
      focus: vi.fn(),
    } as any

    const { result } = renderHook(() =>
      useMessageInput({
        sessionID: "s-4",
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

    expect(mocks.setSessionIdle).not.toHaveBeenCalledWith("s-4", true)
    expect(mocks.showToast).toHaveBeenCalledWith("network down", expect.objectContaining({ variant: "error" }))
  })
})
