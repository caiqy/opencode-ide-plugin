import { beforeEach, describe, expect, it, vi } from "vitest"

const { bridge } = vi.hoisted(() => ({
  bridge: {
    sendTransient: vi.fn(),
  },
}))

vi.mock("./ideBridge", () => ({ ideBridge: bridge }))

import { sendIdeNotification, shouldNotifySessionIdle } from "./ideNotifications"

describe("IDE notifications", () => {
  beforeEach(() => {
    bridge.sendTransient.mockReset().mockReturnValue(true)
    vi.spyOn(document, "hasFocus").mockReturnValue(false)
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" })
  })

  it("only treats a live non-idle to idle transition as completion", () => {
    expect(shouldNotifySessionIdle(undefined, "idle")).toBe(false)
    expect(shouldNotifySessionIdle("idle", "idle")).toBe(false)
    expect(shouldNotifySessionIdle("pending", "idle")).toBe(false)
    expect(shouldNotifySessionIdle("busy", "idle")).toBe(true)
    expect(shouldNotifySessionIdle("retry", "idle")).toBe(true)
  })

  it("sends the shared completion payload with a bounded preview", () => {
    sendIdeNotification("finished", "s1", null, `  ${"x".repeat(230)}  `)

    expect(bridge.sendTransient).toHaveBeenCalledWith({
      type: "showSystemNotification",
      payload: { sessionID: "s1", title: "Agent finished", body: `${"x".repeat(217)}...` },
    })
  })

  it("returns transient rejection for completion or permission notifications", () => {
    bridge.sendTransient.mockReturnValue(false)

    expect(sendIdeNotification("finished", "s1", null)).toBe(false)
    expect(sendIdeNotification("permission", "s1", null)).toBe(false)
    expect(sendIdeNotification("question", "s1", null)).toBe(false)
    expect(bridge.sendTransient).toHaveBeenCalledTimes(3)
  })

  it("uses the first question preview and question fallback", () => {
    sendIdeNotification("question", "s1", null, "  Which option?  ")
    expect(bridge.sendTransient).toHaveBeenLastCalledWith({
      type: "showSystemNotification",
      payload: { sessionID: "s1", title: "Agent has a question", body: "Which option?" },
    })

    sendIdeNotification("question", "s1", null, "   ")
    expect(bridge.sendTransient).toHaveBeenLastCalledWith({
      type: "showSystemNotification",
      payload: { sessionID: "s1", title: "Agent has a question", body: "Answer required." },
    })
  })

  it("uses the permission fallback and suppresses web or focused current sessions", () => {
    sendIdeNotification("permission", "s1", null)
    expect(bridge.sendTransient).toHaveBeenLastCalledWith({
      type: "showSystemNotification",
      payload: { sessionID: "s1", title: "Agent needs permission", body: "Permission requested." },
    })

    bridge.sendTransient.mockReturnValue(false)
    expect(sendIdeNotification("finished", "s1", null)).toBe(false)

    bridge.sendTransient.mockReturnValue(true)
    vi.mocked(document.hasFocus).mockReturnValue(true)
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" })
    expect(sendIdeNotification("finished", "s1", "s1")).toBe(false)
    expect(bridge.sendTransient).toHaveBeenCalledTimes(2)
  })
})
