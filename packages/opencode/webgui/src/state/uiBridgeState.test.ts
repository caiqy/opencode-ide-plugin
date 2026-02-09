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
    const unsubscribe = uiBridgeSubscribeSelector((state: { sessionID: string | null }) => state.sessionID, onSessionIDChange)

    onSessionIDChange.mockClear()
    uiBridgeStateModule.uiBridgeUpdate({ input: "typing" })

    expect(onSessionIDChange).not.toHaveBeenCalled()
    unsubscribe()
  })

  it("invokes selector subscriber immediately with current value", () => {
    const uiBridgeSubscribeSelector = (uiBridgeStateModule as any).uiBridgeSubscribeSelector
    uiBridgeStateModule.uiBridgeHydrate({ sessionID: "s0" })

    const onSessionIDChange = vi.fn()
    const unsubscribe = uiBridgeSubscribeSelector((state: { sessionID: string | null }) => state.sessionID, onSessionIDChange)

    expect(onSessionIDChange).toHaveBeenCalledTimes(1)
    expect(onSessionIDChange).toHaveBeenCalledWith("s0")
    unsubscribe()
  })

  it("notifies selector subscriber when selected value changes", () => {
    const uiBridgeSubscribeSelector = (uiBridgeStateModule as any).uiBridgeSubscribeSelector

    const onSessionIDChange = vi.fn()
    const unsubscribe = uiBridgeSubscribeSelector((state: { sessionID: string | null }) => state.sessionID, onSessionIDChange)

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

    uiBridgeStateModule.uiBridgeUpdate({ input: "h" })
    uiBridgeStateModule.uiBridgeUpdate({ input: "he" })
    uiBridgeStateModule.uiBridgeUpdate({ input: "hel" })

    expect(setState).toHaveBeenCalledTimes(0)

    vi.advanceTimersByTime(300)

    expect(setState).toHaveBeenCalledTimes(1)
    expect(setState).toHaveBeenLastCalledWith(expect.objectContaining({ input: "hel" }))
  })

  it("flushes pending debounced input host persistence once", () => {
    vi.useFakeTimers()

    uiBridgeStateModule.uiBridgeEnable()
    const setState = ideBridge.setState as any
    setState.mockClear()

    uiBridgeStateModule.uiBridgeUpdate({ input: "hel" })
    uiBridgeStateModule.uiBridgeUpdate({ input: "hello" })

    expect(setState).toHaveBeenCalledTimes(0)

    expect(typeof (uiBridgeStateModule as any).uiBridgeFlush).toBe("function")
    ;(uiBridgeStateModule as any).uiBridgeFlush()

    expect(setState).toHaveBeenCalledTimes(1)
    expect(setState).toHaveBeenLastCalledWith(expect.objectContaining({ input: "hello" }))

    vi.advanceTimersByTime(300)

    expect(setState).toHaveBeenCalledTimes(1)
  })

  it("sends immediately and clears pending debounce on non-input change", () => {
    vi.useFakeTimers()

    uiBridgeStateModule.uiBridgeEnable()
    const setState = ideBridge.setState as any
    setState.mockClear()

    uiBridgeStateModule.uiBridgeUpdate({ input: "hello" })
    expect(setState).toHaveBeenCalledTimes(0)

    uiBridgeStateModule.uiBridgeUpdate({ sessionID: "s1" })

    expect(setState).toHaveBeenCalledTimes(1)
    expect(setState).toHaveBeenLastCalledWith(expect.objectContaining({ sessionID: "s1", input: "hello" }))

    vi.advanceTimersByTime(300)

    expect(setState).toHaveBeenCalledTimes(1)
  })
})
