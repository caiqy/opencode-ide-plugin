import { describe, expect, it, vi } from "vitest"
import { handleSessionUiEvent } from "./App"
import { switchSessionWithTabRollback } from "./state/switchSession"

describe("switchSessionWithTabRollback", () => {
  it("切换成功后 currentSession.id 与 active_tab 一致", async () => {
    const state = {
      currentSessionId: "s1",
      activeTab: "s1",
      openTabs: ["s1"],
    }

    const ok = await switchSessionWithTabRollback({
      sessionId: "s2",
      previousSessionId: state.currentSessionId,
      previousActiveTab: state.activeTab,
      existed: false,
      open: (id) => {
        if (!state.openTabs.includes(id)) state.openTabs.push(id)
        state.activeTab = id
      },
      activate: (id) => {
        state.activeTab = id
      },
      remove: (id) => {
        state.openTabs = state.openTabs.filter((tab) => tab !== id)
      },
      switchTo: async (id) => {
        state.currentSessionId = id
      },
    })

    expect(ok).toBe(true)
    expect(state.currentSessionId).toBe("s2")
    expect(state.activeTab).toBe("s2")
  })

  it("切换失败时回滚 active_tab，并与 currentSession 保持一致", async () => {
    const state = {
      currentSessionId: "s1",
      activeTab: "s2",
      openTabs: ["s1", "s2"],
    }

    const ok = await switchSessionWithTabRollback({
      sessionId: "s3",
      previousSessionId: state.currentSessionId,
      previousActiveTab: state.activeTab,
      existed: false,
      open: (id) => {
        if (!state.openTabs.includes(id)) state.openTabs.push(id)
        state.activeTab = id
      },
      activate: (id) => {
        state.activeTab = id
      },
      remove: (id) => {
        state.openTabs = state.openTabs.filter((tab) => tab !== id)
      },
      switchTo: async () => {
        throw new Error("boom")
      },
    })

    expect(ok).toBe(false)
    expect(state.currentSessionId).toBe("s1")
    expect(state.activeTab).toBe("s1")
    expect(state.openTabs).toEqual(["s1", "s2"])
  })
})

describe("handleSessionUiEvent", () => {
  it("session.idle 会恢复对应会话的 idle 状态且不弹 toast", () => {
    const showToast = vi.fn()
    const setSessionIdle = vi.fn()

    handleSessionUiEvent({
      event: { type: "session.idle", properties: { sessionID: "s-1" } },
      currentSessionId: "s-2",
      setSessionIdle,
      showToast,
    })

    expect(setSessionIdle).toHaveBeenCalledTimes(1)
    expect(setSessionIdle).toHaveBeenCalledWith("s-1", true)
    expect(showToast).not.toHaveBeenCalled()
  })

  it("session.compacted 仅对当前会话显示中文提示", () => {
    const showToast = vi.fn()
    const setSessionIdle = vi.fn()

    handleSessionUiEvent({
      event: { type: "session.compacted", properties: { sessionID: "s-1" } },
      currentSessionId: "s-1",
      setSessionIdle,
      showToast,
    })

    handleSessionUiEvent({
      event: { type: "session.compacted", properties: { sessionID: "s-2" } },
      currentSessionId: "s-1",
      setSessionIdle,
      showToast,
    })

    expect(showToast).toHaveBeenCalledTimes(1)
    expect(showToast).toHaveBeenCalledWith("会话历史已压缩以节省空间", {
      title: "会话已压缩",
      variant: "info",
      duration: 5000,
    })
  })
})
