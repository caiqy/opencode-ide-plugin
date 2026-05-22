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
}))

vi.mock("../../../state/SessionContext", () => ({
  useSession: () => ({
    currentSession: { id: "s1" },
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

import { useMessageActions } from "./useMessageActions"

describe("useMessageActions", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.forkSession.mockResolvedValue({ id: "forked" })
  })

  it("分叉成功后打开并激活新会话标签", async () => {
    const { result } = renderHook(() => useMessageActions("s1"))

    act(() => {
      result.current.handleForkStart("m1")
    })
    await act(async () => {
      await result.current.handleForkConfirm()
    })

    expect(mocks.forkSession).toHaveBeenCalledWith("s1", "m1")
    expect(mocks.openTab).toHaveBeenCalledWith("forked")
  })
})
