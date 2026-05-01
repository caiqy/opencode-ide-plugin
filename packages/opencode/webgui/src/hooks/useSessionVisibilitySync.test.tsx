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
})
