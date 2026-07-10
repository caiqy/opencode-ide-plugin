import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  forkSession: vi.fn(),
  revertToMessage: vi.fn(),
  unrevertSession: vi.fn(),
  redoNext: vi.fn(),
  getMessagesBySession: vi.fn(),
  removeSessionErrors: vi.fn(),
  openTab: vi.fn(),
  loadDrafts: vi.fn(),
  saveDrafts: vi.fn(),
  showToast: vi.fn(),
}))
let currentSessionID = "s1"

vi.mock("../../../state/SessionContext", () => ({
  useSession: () => ({
    currentSession: { id: currentSessionID },
    forkSession: mocks.forkSession,
    revertToMessage: mocks.revertToMessage,
    unrevertSession: mocks.unrevertSession,
    redoNext: mocks.redoNext,
  }),
}))

vi.mock("../../../state/MessagesContext", () => ({
  useMessages: () => ({
    getMessagesBySession: mocks.getMessagesBySession,
    removeSessionErrors: mocks.removeSessionErrors,
  }),
}))

vi.mock("../../../state/tabStore", () => ({
  useTabStore: () => ({
    openTab: mocks.openTab,
  }),
}))

vi.mock("../../../state/repo/draftRepo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../state/repo/draftRepo")>()),
  loadDrafts: mocks.loadDrafts,
  saveDrafts: mocks.saveDrafts,
}))

vi.mock("../../../state/ToastContext", () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))

import { useMessageActions } from "./useMessageActions"

describe("useMessageActions", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    currentSessionID = "s1"
    mocks.forkSession.mockResolvedValue({ id: "forked" })
    mocks.loadDrafts.mockResolvedValue({})
    mocks.saveDrafts.mockResolvedValue({ ok: true })
  })

  it("分叉成功后打开并激活新会话标签", async () => {
    mocks.getMessagesBySession.mockReturnValue([
      { info: { id: "m1", role: "user", agent: "build" }, parts: [{ type: "text", text: "branch prompt" }] },
    ])
    const { result } = renderHook(() => useMessageActions("s1"))

    act(() => {
      result.current.handleForkStart("m1")
    })
    await act(async () => {
      await result.current.handleForkConfirm()
    })

    expect(mocks.forkSession).toHaveBeenCalledWith("s1", "m1")
    expect(mocks.saveDrafts).toHaveBeenCalledWith({
      forked: { parts: [{ type: "text", text: "branch prompt" }], agent: "build", model: undefined },
    })
    expect(mocks.openTab).toHaveBeenCalledWith("forked")
  })

  it("分叉保留非 synthetic 文本、附件、agent 和 prompt selection", async () => {
    mocks.getMessagesBySession.mockReturnValue([
      {
        info: {
          id: "m1",
          role: "user",
          agent: "review",
          model: { providerID: "openai", modelID: "gpt-5", variant: "high" },
        },
        parts: [
          { type: "text", text: "draft" },
          { type: "text", text: "hidden", synthetic: true },
          {
            type: "file",
            mime: "image/png",
            filename: "image.png",
            url: "data:image/png;base64,AA==",
            source: { type: "file", path: "image.png", text: { value: "[Image #1]", start: 5, end: 14 } },
          },
          { type: "agent", name: "explore", source: { value: "@explore", start: 15, end: 23 } },
        ],
      },
    ])
    const { result } = renderHook(() => useMessageActions("s1"))

    act(() => result.current.handleForkStart("m1"))
    await act(async () => {
      await result.current.handleForkConfirm()
    })

    expect(mocks.saveDrafts).toHaveBeenCalledWith({
      forked: {
        parts: [
          { type: "text", text: "draft" },
          {
            type: "file",
            mime: "image/png",
            filename: "image.png",
            url: "data:image/png;base64,AA==",
            source: { type: "file", path: "image.png", text: { value: "[Image #1]", start: 5, end: 14 } },
          },
          { type: "agent", name: "explore", source: { value: "@explore", start: 15, end: 23 } },
        ],
        agent: "review",
        model: { providerID: "openai", modelID: "gpt-5", variant: "high" },
      },
    })
  })

  it("附件-only prompt 也会保存后再打开", async () => {
    mocks.getMessagesBySession.mockReturnValue([
      {
        info: { id: "m1", role: "user", agent: "build", model: { providerID: "openai", modelID: "gpt-5" } },
        parts: [{ type: "file", mime: "image/png", filename: "image.png", url: "data:image/png;base64,AA==" }],
      },
    ])
    const { result } = renderHook(() => useMessageActions("s1"))

    act(() => result.current.handleForkStart("m1"))
    await act(async () => {
      await result.current.handleForkConfirm()
    })

    expect(mocks.saveDrafts).toHaveBeenCalledBefore(mocks.openTab)
    expect(mocks.saveDrafts).toHaveBeenCalledWith({
      forked: {
        parts: [{ type: "file", mime: "image/png", filename: "image.png", url: "data:image/png;base64,AA==" }],
        agent: "build",
        model: { providerID: "openai", modelID: "gpt-5" },
      },
    })
  })

  it("草稿保存失败时不导航，保持确认以便重试", async () => {
    mocks.getMessagesBySession.mockReturnValue([
      { info: { id: "m1", role: "user", agent: "build" }, parts: [{ type: "text", text: "branch prompt" }] },
    ])
    mocks.saveDrafts.mockResolvedValueOnce({ ok: false })
    const { result } = renderHook(() => useMessageActions("s1"))

    act(() => result.current.handleForkStart("m1"))
    await act(async () => {
      await result.current.handleForkConfirm()
    })

    expect(mocks.openTab).not.toHaveBeenCalled()
    expect(result.current.forkConfirm).toBe("m1")
    expect(result.current.isForking).toBe(false)
    expect(mocks.showToast).toHaveBeenCalled()

    await act(async () => {
      await result.current.handleForkConfirm()
    })

    expect(mocks.forkSession).toHaveBeenCalledTimes(1)
    expect(mocks.openTab).toHaveBeenCalledWith("forked")
  })

  it("切换源会话后不会复用失败的 fork", async () => {
    mocks.getMessagesBySession.mockReturnValue([
      { info: { id: "m1", role: "user", agent: "build" }, parts: [{ type: "text", text: "branch prompt" }] },
    ])
    mocks.saveDrafts.mockResolvedValueOnce({ ok: false })
    const { result, rerender } = renderHook(({ sessionID }) => useMessageActions(sessionID), { initialProps: { sessionID: "s1" } })

    act(() => result.current.handleForkStart("m1"))
    await act(async () => {
      await result.current.handleForkConfirm()
    })

    currentSessionID = "s2"
    rerender({ sessionID: "s2" })
    await act(async () => {
      await result.current.handleForkConfirm()
    })

    expect(mocks.forkSession).toHaveBeenCalledTimes(1)
    expect(mocks.openTab).not.toHaveBeenCalled()
    expect(result.current.forkConfirm).toBeNull()
  })

  it("分叉只写入新会话草稿并保留源会话草稿", async () => {
    mocks.loadDrafts.mockResolvedValue({ s1: "source draft" })
    mocks.getMessagesBySession.mockReturnValue([
      { info: { id: "m1", role: "user", agent: "build" }, parts: [{ type: "text", text: "branch prompt" }] },
    ])
    const { result } = renderHook(() => useMessageActions("s1"))

    act(() => result.current.handleForkStart("m1"))
    await act(async () => {
      await result.current.handleForkConfirm()
    })

    expect(mocks.saveDrafts).toHaveBeenCalledWith({
      s1: "source draft",
      forked: { parts: [{ type: "text", text: "branch prompt" }], agent: "build", model: undefined },
    })
  })

  it("failed revert keeps confirmation open and does not edit the input", async () => {
    mocks.revertToMessage.mockResolvedValueOnce(null)
    mocks.getMessagesBySession.mockReturnValue([
      { info: { id: "m1", time: { created: 1 } }, parts: [{ type: "text", text: "restore me" }] },
    ])
    const onUndoToInput = vi.fn()
    const { result } = renderHook(() => useMessageActions("s1", onUndoToInput))

    act(() => result.current.handleRevert("m1"))
    await act(async () => {
      await result.current.handleRevertConfirm()
    })

    expect(onUndoToInput).not.toHaveBeenCalled()
    expect(mocks.removeSessionErrors).not.toHaveBeenCalled()
    expect(result.current.revertAction).toEqual({ type: "undo", messageId: "m1" })
    expect(result.current.isRevertBusy).toBe(false)
  })

  it("failed redo keeps confirmation open and resets busy", async () => {
    mocks.redoNext.mockResolvedValueOnce(null)
    const { result } = renderHook(() => useMessageActions("s1"))

    act(() => result.current.handleRedoClick())
    await act(async () => {
      await result.current.handleRevertConfirm()
    })

    expect(result.current.revertAction).toEqual({ type: "redo" })
    expect(result.current.isRevertBusy).toBe(false)
  })

  it("failed restore keeps confirmation open and resets busy", async () => {
    mocks.unrevertSession.mockResolvedValueOnce(null)
    const { result } = renderHook(() => useMessageActions("s1"))

    act(() => result.current.handleRestoreClick())
    await act(async () => {
      await result.current.handleRevertConfirm()
    })

    expect(result.current.revertAction).toEqual({ type: "restore" })
    expect(result.current.isRevertBusy).toBe(false)
  })
})
