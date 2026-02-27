import { describe, expect, it, vi } from "vitest"
import { switchSessionWithTabRollback } from "./switchSession"

describe("switchSessionWithTabRollback", () => {
  it("switch 成功返回 true", async () => {
    const open = vi.fn()
    const activate = vi.fn()
    const remove = vi.fn()
    const switchTo = vi.fn().mockResolvedValue(undefined)

    const ok = await switchSessionWithTabRollback({
      sessionId: "s2",
      previousSessionId: "s1",
      previousActiveTab: "s1",
      existed: true,
      open,
      activate,
      remove,
      switchTo,
    })

    expect(ok).toBe(true)
    expect(activate).toHaveBeenCalledWith("s2")
    expect(open).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it("当前会话不可回滚时会回退到 previousActiveTab", async () => {
    const open = vi.fn()
    const activate = vi.fn()
    const remove = vi.fn()
    const switchTo = vi.fn().mockRejectedValue(new Error("boom"))

    const ok = await switchSessionWithTabRollback({
      sessionId: "s2",
      previousSessionId: "s-missing",
      previousActiveTab: "s1",
      existed: true,
      open,
      activate,
      remove,
      switchTo,
      canActivate: (id) => id === "s1",
    })

    expect(ok).toBe(false)
    expect(activate).toHaveBeenCalledWith("s1")
    expect(activate).not.toHaveBeenCalledWith("s-missing")
  })

  it("无可回滚目标时触发 onUnrecoverable", async () => {
    const open = vi.fn()
    const activate = vi.fn()
    const remove = vi.fn()
    const switchTo = vi.fn().mockRejectedValue(new Error("boom"))
    const onUnrecoverable = vi.fn()

    const ok = await switchSessionWithTabRollback({
      sessionId: "s2",
      previousSessionId: "s-missing",
      previousActiveTab: "s-missing2",
      existed: true,
      open,
      activate,
      remove,
      switchTo,
      canActivate: () => false,
      onUnrecoverable,
    })

    expect(ok).toBe(false)
    expect(activate).toHaveBeenCalledWith("s2")
    expect(onUnrecoverable).toHaveBeenCalledOnce()
  })
})
