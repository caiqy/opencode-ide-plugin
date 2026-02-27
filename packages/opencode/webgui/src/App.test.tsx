import { describe, expect, it } from "vitest"
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
