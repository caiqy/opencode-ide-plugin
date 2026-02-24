import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/ideBridge", () => {
  return {
    ideBridge: {
      isInstalled: vi.fn(() => true),
      setState: vi.fn(),
    },
  }
})

import { ideBridge } from "../lib/ideBridge"
import * as uiBridgeStateModule from "./uiBridgeState"

describe("uiBridgeSubscribeSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(ideBridge.isInstalled as any).mockReturnValue(true)
    uiBridgeStateModule.uiBridgeHydrate({})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("does not notify non-input selector on input updates", () => {
    const uiBridgeSubscribeSelector = (uiBridgeStateModule as any).uiBridgeSubscribeSelector

    expect(typeof uiBridgeSubscribeSelector).toBe("function")

    const onSessionIDChange = vi.fn()
    const unsubscribe = uiBridgeSubscribeSelector(
      (state: { sessionID: string | null }) => state.sessionID,
      onSessionIDChange,
    )

    onSessionIDChange.mockClear()
    uiBridgeStateModule.uiBridgeUpdateDraft("s1", "typing")

    expect(onSessionIDChange).not.toHaveBeenCalled()
    unsubscribe()
  })

  it("invokes selector subscriber immediately with current value", () => {
    const uiBridgeSubscribeSelector = (uiBridgeStateModule as any).uiBridgeSubscribeSelector
    uiBridgeStateModule.uiBridgeHydrate({ sessionID: "s0" })

    const onSessionIDChange = vi.fn()
    const unsubscribe = uiBridgeSubscribeSelector(
      (state: { sessionID: string | null }) => state.sessionID,
      onSessionIDChange,
    )

    expect(onSessionIDChange).toHaveBeenCalledTimes(1)
    expect(onSessionIDChange).toHaveBeenCalledWith("s0")
    unsubscribe()
  })

  it("notifies selector subscriber when selected value changes", () => {
    const uiBridgeSubscribeSelector = (uiBridgeStateModule as any).uiBridgeSubscribeSelector

    const onSessionIDChange = vi.fn()
    const unsubscribe = uiBridgeSubscribeSelector(
      (state: { sessionID: string | null }) => state.sessionID,
      onSessionIDChange,
    )

    onSessionIDChange.mockClear()
    uiBridgeStateModule.uiBridgeUpdate({ sessionID: "s1" })

    expect(onSessionIDChange).toHaveBeenCalledTimes(1)
    expect(onSessionIDChange).toHaveBeenCalledWith("s1")
    unsubscribe()
  })

  it("debounces input host persistence", () => {
    vi.useFakeTimers()

    uiBridgeStateModule.uiBridgeEnable()
    const setState = ideBridge.setState as any
    setState.mockClear()

    uiBridgeStateModule.uiBridgeUpdateDraft("s1", "h")
    uiBridgeStateModule.uiBridgeUpdateDraft("s1", "he")
    uiBridgeStateModule.uiBridgeUpdateDraft("s1", "hel")

    expect(setState).toHaveBeenCalledTimes(0)

    vi.advanceTimersByTime(300)

    expect(setState).toHaveBeenCalledTimes(1)
    expect(setState).toHaveBeenLastCalledWith(expect.objectContaining({ drafts: { s1: "hel" } }))
  })

  it("flushes pending debounced input host persistence once", () => {
    vi.useFakeTimers()

    uiBridgeStateModule.uiBridgeEnable()
    const setState = ideBridge.setState as any
    setState.mockClear()

    uiBridgeStateModule.uiBridgeUpdateDraft("s1", "hel")
    uiBridgeStateModule.uiBridgeUpdateDraft("s1", "hello")

    expect(setState).toHaveBeenCalledTimes(0)

    expect(typeof (uiBridgeStateModule as any).uiBridgeFlush).toBe("function")
    ;(uiBridgeStateModule as any).uiBridgeFlush()

    expect(setState).toHaveBeenCalledTimes(1)
    expect(setState).toHaveBeenLastCalledWith(expect.objectContaining({ drafts: { s1: "hello" } }))

    vi.advanceTimersByTime(300)

    expect(setState).toHaveBeenCalledTimes(1)
  })

  it("sends immediately and clears pending debounce on non-input change", () => {
    vi.useFakeTimers()

    uiBridgeStateModule.uiBridgeEnable()
    const setState = ideBridge.setState as any
    setState.mockClear()

    uiBridgeStateModule.uiBridgeUpdateDraft("s1", "hello")
    expect(setState).toHaveBeenCalledTimes(0)

    uiBridgeStateModule.uiBridgeUpdate({ sessionID: "s1" })

    expect(setState).toHaveBeenCalledTimes(1)
    expect(setState).toHaveBeenLastCalledWith(expect.objectContaining({ sessionID: "s1", drafts: { s1: "hello" } }))

    vi.advanceTimersByTime(300)

    expect(setState).toHaveBeenCalledTimes(1)
  })

  it("stores drafts by session id", () => {
    uiBridgeStateModule.uiBridgeHydrate({ sessionID: "s1" })
    uiBridgeStateModule.uiBridgeUpdateDraft("s1", "hello s1")
    uiBridgeStateModule.uiBridgeUpdateDraft("s2", "hello s2")

    expect(uiBridgeStateModule.uiBridgeDraft("s1")).toBe("hello s1")
    expect(uiBridgeStateModule.uiBridgeDraft("s2")).toBe("hello s2")
  })

  it("migrates v1 input into active session draft", () => {
    uiBridgeStateModule.uiBridgeHydrate({ sessionID: "s1", input: "legacy" })
    expect(uiBridgeStateModule.uiBridgeDraft("s1")).toBe("legacy")
  })

  it("does not lose v1 input when hydrate has no active session", () => {
    uiBridgeStateModule.uiBridgeHydrate({ input: "legacy" })
    uiBridgeStateModule.uiBridgeUpdate({ sessionID: "s1" })
    expect(uiBridgeStateModule.uiBridgeDraft("s1")).toBe("legacy")
  })

  it("moveDraft keeps target draft and removes source draft", () => {
    uiBridgeStateModule.uiBridgeHydrate({ sessionID: "s1" })
    uiBridgeStateModule.uiBridgeUpdateDraft("s1", "source")
    uiBridgeStateModule.uiBridgeUpdateDraft("s2", "target")

    uiBridgeStateModule.uiBridgeMoveDraft("s1", "s2")

    expect(uiBridgeStateModule.uiBridgeDraft("s1")).toBe("")
    expect(uiBridgeStateModule.uiBridgeDraft("s2")).toBe("target")
  })

  it("round-trips drafts through hydrate", () => {
    uiBridgeStateModule.uiBridgeHydrate({ sessionID: "s1" })
    uiBridgeStateModule.uiBridgeUpdateDraft("s1", "a")
    uiBridgeStateModule.uiBridgeUpdateDraft("s2", "b")

    const snapshot = uiBridgeStateModule.uiBridgeState()
    uiBridgeStateModule.uiBridgeHydrate(snapshot)

    expect(uiBridgeStateModule.uiBridgeDraft("s1")).toBe("a")
    expect(uiBridgeStateModule.uiBridgeDraft("s2")).toBe("b")
  })

  it("subscribeDraft 在会话草稿变更时通知", () => {
    const onDraft = vi.fn()
    const unsub = (uiBridgeStateModule as any).uiBridgeSubscribeDraft("s1", onDraft)

    onDraft.mockClear()
    uiBridgeStateModule.uiBridgeUpdateDraft("s1", "new-draft")

    expect(onDraft).toHaveBeenCalledWith("new-draft")
    unsub()
  })

  it("moveDraft 在 from===to 或 source 缺失时不应变更", () => {
    uiBridgeStateModule.uiBridgeHydrate({ sessionID: "s1", drafts: { s1: "a", s2: "b" } })

    uiBridgeStateModule.uiBridgeMoveDraft("s1", "s1")
    expect(uiBridgeStateModule.uiBridgeDraft("s1")).toBe("a")

    uiBridgeStateModule.uiBridgeMoveDraft("missing", "s2")
    expect(uiBridgeStateModule.uiBridgeDraft("s2")).toBe("b")
  })
})
