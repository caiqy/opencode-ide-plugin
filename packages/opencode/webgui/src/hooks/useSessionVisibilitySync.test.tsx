import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  syncVisible: vi.fn(),
  state: {
    currentSession: { id: "s2" } as { id: string } | null,
    openTabs: ["s3", "s1", "s2", "s1"] as string[],
    foregroundSessions: new Set<string>(),
  },
}))

const events = vi.hoisted(() => {
  const handlers = new Set<() => void>()
  return {
    emit: () => handlers.forEach((handler) => handler()),
    on: (_type: string, handler: () => void) => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    },
    reset: () => handlers.clear(),
  }
})

vi.mock("../lib/api/sdkClient", () => ({
  sdk: {
    session: {
      syncVisible: (input: unknown) => mocks.syncVisible(input),
    },
  },
}))

vi.mock("../state/SessionContext", () => ({
  useSession: () => ({
    currentSession: mocks.state.currentSession,
    foregroundSessions: mocks.state.foregroundSessions,
  }),
}))

vi.mock("../state/tabStore", () => ({
  useTabStore: () => ({
    openTabs: mocks.state.openTabs,
  }),
}))

vi.mock("../lib/api/events", () => ({
  eventEmitter: {
    on: events.on,
  },
}))

import { useSessionVisibilitySync } from "./useSessionVisibilitySync"

function ok(sessionIDs: string[]) {
  return { data: { sessionIDs }, error: null }
}

function fail(message: string) {
  return { data: null, error: { message } }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe("useSessionVisibilitySync", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.state.currentSession = { id: "s2" }
    mocks.state.openTabs = ["s3", "s1", "s2", "s1"]
    mocks.state.foregroundSessions = new Set()
    mocks.syncVisible.mockResolvedValue(ok(["s1", "s2", "s3"]))
    events.reset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("合并当前会话和标签页后去重排序并避免重复同步", async () => {
    const view = renderHook(() => useSessionVisibilitySync())

    await waitFor(() => {
      expect(mocks.syncVisible).toHaveBeenCalledTimes(1)
    })
    expect(mocks.syncVisible).toHaveBeenCalledWith({
      body: {
        sessionIDs: ["s1", "s2", "s3"],
      },
    })

    mocks.state.openTabs = ["s2", "s3", "s1"]
    await act(async () => {
      view.rerender()
      await Promise.resolve()
    })
    expect(mocks.syncVisible).toHaveBeenCalledTimes(1)

    mocks.state.currentSession = { id: "s4" }
    mocks.syncVisible.mockResolvedValueOnce({ data: { sessionIDs: ["s1", "s2", "s3", "s4"] }, error: null })

    await act(async () => {
      view.rerender()
    })

    await waitFor(() => {
      expect(mocks.syncVisible).toHaveBeenCalledTimes(2)
    })
    expect(mocks.syncVisible).toHaveBeenLastCalledWith({
      body: {
        sessionIDs: ["s1", "s2", "s3", "s4"],
      },
    })
  })

  it("没有可见会话时同步空列表", async () => {
    mocks.state.currentSession = null
    mocks.state.openTabs = []
    mocks.syncVisible.mockResolvedValueOnce(ok([]))

    renderHook(() => useSessionVisibilitySync())

    await waitFor(() => {
      expect(mocks.syncVisible).toHaveBeenCalledWith({
        body: {
          sessionIDs: [],
        },
      })
    })
  })

  it("当前会话处于 foreground protection 时暂不纳入 syncVisible 集合", async () => {
    mocks.state.currentSession = { id: "s2" }
    mocks.state.openTabs = ["s1", "s2"]
    mocks.state.foregroundSessions = new Set(["s2"])
    mocks.syncVisible.mockResolvedValueOnce(ok(["s1"]))
    mocks.syncVisible.mockResolvedValueOnce(ok(["s1", "s2"]))

    const view = renderHook(() => useSessionVisibilitySync())

    await waitFor(() => {
      expect(mocks.syncVisible).toHaveBeenCalledTimes(1)
    })
    expect(mocks.syncVisible).toHaveBeenCalledWith({
      body: {
        sessionIDs: ["s1"],
      },
    })

    mocks.state.foregroundSessions = new Set()

    await act(async () => {
      view.rerender()
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(mocks.syncVisible).toHaveBeenCalledTimes(2)
    })
    expect(mocks.syncVisible).toHaveBeenLastCalledWith({
      body: {
        sessionIDs: ["s1", "s2"],
      },
    })
  })

  it("请求进行中时再次变化，最终以最新状态收敛", async () => {
    const first = deferred<ReturnType<typeof ok>>()
    mocks.syncVisible.mockImplementationOnce(() => first.promise)
    mocks.syncVisible.mockResolvedValueOnce(ok(["s1", "s3", "s4"]))

    const view = renderHook(() => useSessionVisibilitySync())

    await waitFor(() => {
      expect(mocks.syncVisible).toHaveBeenCalledTimes(1)
    })

    mocks.state.currentSession = { id: "s4" }
    mocks.state.openTabs = ["s3", "s1"]

    await act(async () => {
      view.rerender()
      await Promise.resolve()
    })

    expect(mocks.syncVisible).toHaveBeenCalledTimes(1)

    await act(async () => {
      first.resolve(ok(["s1", "s2", "s3"]))
      await Promise.resolve()
    })

    await waitFor(() => {
      expect(mocks.syncVisible).toHaveBeenCalledTimes(2)
    })
    expect(mocks.syncVisible).toHaveBeenLastCalledWith({
      body: {
        sessionIDs: ["s1", "s3", "s4"],
      },
    })
  })

  it("response.error 后仍会再次同步最新状态", async () => {
    vi.useFakeTimers()
    mocks.syncVisible.mockResolvedValueOnce(fail("temporary failure"))
    mocks.syncVisible.mockResolvedValueOnce(ok(["s1", "s2", "s3"]))

    renderHook(() => useSessionVisibilitySync())

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.syncVisible).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.syncVisible).toHaveBeenCalledTimes(2)
    expect(mocks.syncVisible).toHaveBeenLastCalledWith({
      body: {
        sessionIDs: ["s1", "s2", "s3"],
      },
    })
  })

  it("4xx visibility error does not retry forever", async () => {
    vi.useFakeTimers()
    mocks.syncVisible.mockResolvedValueOnce({ data: null, error: { message: "bad request", status: 400 } })

    renderHook(() => useSessionVisibilitySync())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(mocks.syncVisible).toHaveBeenCalledTimes(1)
  })

  it("unknown visibility errors stop after three attempts", async () => {
    vi.useFakeTimers()
    mocks.syncVisible.mockResolvedValue(fail("temporary failure"))

    renderHook(() => useSessionVisibilitySync())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(mocks.syncVisible).toHaveBeenCalledTimes(3)
  })

  it("5xx visibility errors stop after three attempts", async () => {
    vi.useFakeTimers()
    mocks.syncVisible.mockResolvedValue({ data: null, error: { message: "server error", status: 500 } })

    renderHook(() => useSessionVisibilitySync())

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(mocks.syncVisible).toHaveBeenCalledTimes(3)
  })

  it("does not reset B's retry budget when A settles during B's render", async () => {
    vi.useFakeTimers()
    const first = deferred<ReturnType<typeof fail>>()
    mocks.syncVisible.mockImplementationOnce(() => first.promise)
    mocks.syncVisible.mockResolvedValue(fail("temporary failure"))

    const view = renderHook(() => useSessionVisibilitySync())
    await act(async () => {
      await Promise.resolve()
    })
    expect(mocks.syncVisible).toHaveBeenCalledTimes(1)

    await act(async () => {
      mocks.state.currentSession = { id: "s4" }
      view.rerender()
      first.resolve(fail("temporary failure"))
      await Promise.resolve()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(mocks.syncVisible.mock.calls.filter(([input]) => (input as { body: { sessionIDs: string[] } }).body.sessionIDs.includes("s4"))).toHaveLength(3)
  })

  it("retries after a 4xx when the visibility key changes", async () => {
    mocks.syncVisible.mockResolvedValueOnce({ data: null, error: { message: "bad request", status: 400 } })
    mocks.syncVisible.mockResolvedValueOnce(ok(["s1", "s2", "s3", "s4"]))

    const view = renderHook(() => useSessionVisibilitySync())
    await waitFor(() => expect(mocks.syncVisible).toHaveBeenCalledTimes(1))

    mocks.state.currentSession = { id: "s4" }
    view.rerender()

    await waitFor(() => expect(mocks.syncVisible).toHaveBeenCalledTimes(2))
  })

  it("第一次 server.connected 会给未变 key 新的重试预算", async () => {
    vi.useFakeTimers()
    mocks.syncVisible.mockResolvedValue(fail("temporary failure"))

    renderHook(() => useSessionVisibilitySync())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(mocks.syncVisible).toHaveBeenCalledTimes(3)

    await act(async () => {
      events.emit()
      await Promise.resolve()
    })

    expect(mocks.syncVisible).toHaveBeenCalledTimes(4)
  })

  it("starts a new epoch request while an old epoch request is still pending", async () => {
    const old = deferred<ReturnType<typeof ok>>()
    mocks.syncVisible.mockImplementationOnce(() => old.promise)
    mocks.syncVisible.mockResolvedValueOnce(ok(["s1", "s2", "s3"]))

    renderHook(() => useSessionVisibilitySync())
    await waitFor(() => expect(mocks.syncVisible).toHaveBeenCalledTimes(1))
    await act(async () => {
      events.emit()
    })

    await waitFor(() => expect(mocks.syncVisible).toHaveBeenCalledTimes(2))
    await act(async () => {
      old.resolve(fail("old failure"))
      await Promise.resolve()
    })

    expect(mocks.syncVisible).toHaveBeenCalledTimes(2)
  })

  it("does not retry after unmount", async () => {
    vi.useFakeTimers()
    mocks.syncVisible.mockResolvedValue(fail("temporary failure"))

    const view = renderHook(() => useSessionVisibilitySync())
    await act(async () => {
      await Promise.resolve()
    })
    view.unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(mocks.syncVisible).toHaveBeenCalledTimes(1)
  })

  it("does not schedule work when an in-flight request settles after unmount", async () => {
    const first = deferred<ReturnType<typeof fail>>()
    mocks.syncVisible.mockImplementationOnce(() => first.promise)

    const view = renderHook(() => useSessionVisibilitySync())
    await waitFor(() => expect(mocks.syncVisible).toHaveBeenCalledTimes(1))
    view.unmount()
    await act(async () => {
      first.resolve(fail("temporary failure"))
      await Promise.resolve()
    })

    expect(mocks.syncVisible).toHaveBeenCalledTimes(1)
  })
})
