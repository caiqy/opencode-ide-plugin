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
    materializeSession: vi.fn(async () => ({ id: "s-real" })),
    showToast: vi.fn(),
    addMessage: vi.fn(),
    setMessages: vi.fn(),
    command: vi.fn(async (_input: unknown) => ({ data: {}, error: null })),
    prompt: vi.fn(async (_input: unknown) => ({ data: {}, error: null })),
    uiBridgeMoveDraft: vi.fn(),
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
        abort: vi.fn(async () => ({ data: true, error: null })),
        summarize: vi.fn(async () => ({ data: true, error: null })),
      },
    },
  }
})

vi.mock("../../../state/SessionContext", () => {
  return {
    useSession: () => ({
      setSessionIdle: mocks.setSessionIdle,
      isVirtualSession: true,
      materializeSession: mocks.materializeSession,
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
    uiBridgeMoveDraft: (from: string, to: string) => mocks.uiBridgeMoveDraft(from, to),
  }
})

import { useMessageInput } from "./useMessageInput"

describe("useMessageInput", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.root.getTextContent.mockReturnValue("/status")
    mocks.materializeSession.mockResolvedValue({ id: "s-real" })
    mocks.command.mockResolvedValue({ data: {}, error: null })
    mocks.prompt.mockResolvedValue({ data: {}, error: null })
  })

  it("virtual 会话 materialize 后应迁移草稿到真实会话", async () => {
    const editor = {
      getEditorState: () => ({
        read: (fn: () => void) => fn(),
      }),
      update: (fn: () => void) => fn(),
      focus: vi.fn(),
    } as any

    const { result } = renderHook(() =>
      useMessageInput({
        sessionID: "virtual-1",
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

    expect(mocks.uiBridgeMoveDraft).toHaveBeenCalledWith("virtual-1", "s-real")
    expect(mocks.command).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: "s-real" },
      }),
    )
  })

  it("materialize 失败时不应迁移草稿且不发请求", async () => {
    mocks.materializeSession.mockResolvedValue(null as any)

    const editor = {
      getEditorState: () => ({
        read: (fn: () => void) => fn(),
      }),
      update: (fn: () => void) => fn(),
      focus: vi.fn(),
    } as any

    const { result } = renderHook(() =>
      useMessageInput({
        sessionID: "virtual-1",
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

    expect(mocks.uiBridgeMoveDraft).not.toHaveBeenCalled()
    expect(mocks.command).not.toHaveBeenCalled()
    expect(mocks.showToast).toHaveBeenCalledTimes(1)
  })

  it("普通消息路径在 materialize 后应发送到真实会话", async () => {
    mocks.root.getTextContent.mockReturnValue("hello")

    const editor = {
      getEditorState: () => ({
        read: (fn: () => void) => fn(),
      }),
      update: (fn: () => void) => fn(),
      focus: vi.fn(),
    } as any

    const { result } = renderHook(() =>
      useMessageInput({
        sessionID: "virtual-1",
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
        path: { id: "s-real" },
      }),
    )
    expect(mocks.command).not.toHaveBeenCalled()
    expect(mocks.uiBridgeMoveDraft).toHaveBeenCalledWith("virtual-1", "s-real")
  })
})
