import { act, render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  setReasoning: vi.fn(),
  setSessionIdle: vi.fn(),
  currentSession: null as { id: string } | null,
}))

vi.mock("../lib/api/sdkClient", () => ({
  sdk: {
    session: {
      messages: vi.fn(),
    },
    permissions: {
      list: vi.fn(),
      respond: vi.fn(),
    },
    question: {
      list: vi.fn(),
      reply: vi.fn(),
      reject: vi.fn(),
    },
  },
}))

vi.mock("./SessionContext", () => ({
  useSession: () => ({
    setReasoning: mocks.setReasoning,
    setSessionIdle: mocks.setSessionIdle,
    currentSession: mocks.currentSession,
  }),
}))

import { sdk } from "../lib/api/sdkClient"
import { EventEmitter } from "../lib/api/events"
import { MessagesProvider, useMessages } from "./MessagesContext"

let api: ReturnType<typeof useMessages> | null = null

function Capture() {
  api = useMessages()
  return null
}

function msg(id: string, sessionID: string, created: number) {
  return {
    info: {
      id,
      sessionID,
      role: "user",
      time: { created },
    },
    parts: [],
  }
}

function text(id: string, sessionID: string, created: number, value: string) {
  return {
    info: {
      id,
      sessionID,
      role: "assistant",
      time: { created },
    },
    parts: [
      {
        id: `p-${id}`,
        type: "text",
        sessionID,
        messageID: id,
        text: value,
      },
    ],
  }
}

function think(id: string, sessionID: string, messageID: string, value: string) {
  return {
    id,
    type: "reasoning",
    sessionID,
    messageID,
    text: value,
  }
}

function page(data: unknown[], cursor?: string | null) {
  return {
    error: null,
    data,
    response: {
      headers: new Headers(cursor ? { "X-Next-Cursor": cursor } : {}),
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe("MessagesContext pagination", () => {
  beforeEach(() => {
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mockReset()
    vi.mocked(sdk.permissions.list).mockReset()
    vi.mocked(sdk.question.list).mockReset()
    mocks.setReasoning.mockReset()
    mocks.setSessionIdle.mockReset()
    mocks.currentSession = null
    api = null
  })

  it("loadLatest 只加载最近一页，loadOlder 再向前 prepend", async () => {
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(page([msg("m3", "s1", 3), msg("m4", "s1", 4)], "c2"))
      .mockResolvedValueOnce(page([msg("m1", "s1", 1), msg("m2", "s1", 2)], null))

    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    await act(async () => {
      await (api as any).loadLatest("s1")
    })

    expect(api?.getMessagesBySession("s1").map((row) => row.info.id)).toEqual(["m3", "m4"])
    expect(api?.isSessionLoaded("s1")).toBe(true)
    expect(api?.isSessionLoadError("s1")).toBe(false)
    expect((sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toEqual({
      path: { id: "s1" },
      query: { limit: 50 },
    })

    await act(async () => {
      await (api as any).loadOlder("s1")
    })

    expect(api?.getMessagesBySession("s1").map((row) => row.info.id)).toEqual(["m1", "m2", "m3", "m4"])
    expect((sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mock.calls[1]?.[0]).toEqual({
      path: { id: "s1" },
      query: { before: "c2", limit: 50 },
    })
  })

  it("loadLatest does not infer live status from an incomplete assistant message", async () => {
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      page(
        [
          {
            info: {
              id: "m-stale",
              sessionID: "s-stale",
              role: "assistant",
              time: { created: 1, completed: 0 },
            },
            parts: [],
          } as any,
        ],
        null,
      ),
    )

    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    await act(async () => {
      await api!.loadLatest("s-stale")
    })

    expect(mocks.setSessionIdle).not.toHaveBeenCalled()
  })

  it("ensureSession 遇到已中止的 pending latest 时会重新发起加载", async () => {
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => {
      if ((sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mock.calls.length === 1) {
        return Promise.resolve({ error: { message: "aborted" }, data: null })
      }
      return Promise.resolve(page([msg("m1", "s1", 1)], null))
    })

    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    const first = new AbortController()
    const retry = new AbortController()
    let restored: Promise<unknown> | undefined

    act(() => {
      void api!.loadLatest("s1", first.signal)
      first.abort()
      restored = api!.ensureSession("s1", retry.signal)
    })

    expect(sdk.session.messages).toHaveBeenCalledTimes(2)
    expect((sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mock.calls[1]?.[0].signal).toBe(retry.signal)

    await act(async () => {
      await restored
    })

    expect(api?.isSessionLoaded("s1")).toBe(true)
    expect(api?.isSessionLoadError("s1")).toBe(false)
  })

  it("loadOlder 遇到重叠页时保留当前较新的本地消息版本", async () => {
    const emitter = new EventEmitter()
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(page([text("m2", "s1", 2, "old"), text("m3", "s1", 3, "tail")], "c1"))
      .mockResolvedValueOnce(page([text("m1", "s1", 1, "head"), text("m2", "s1", 2, "old")], null))

    render(
      <MessagesProvider emitter={emitter}>
        <Capture />
      </MessagesProvider>,
    )

    await act(async () => {
      await (api as any).loadLatest("s1")
    })

    act(() => {
      emitter.emit({
        type: "message.part.updated",
        properties: {
          part: {
            id: "p-m2",
            type: "text",
            sessionID: "s1",
            messageID: "m2",
            text: "live",
          },
        },
      })
    })

    expect(
      (api?.getMessagesBySession("s1").find((row) => row.info.id === "m2")?.parts[0] as { text?: string })?.text,
    ).toBe("live")

    await act(async () => {
      await (api as any).loadOlder("s1")
    })

    expect(api?.getMessagesBySession("s1").map((row) => row.info.id)).toEqual(["m1", "m2", "m3"])
    expect(
      (api?.getMessagesBySession("s1").find((row) => row.info.id === "m2")?.parts[0] as { text?: string })?.text,
    ).toBe("live")
  })

  it("loadLatest 无并发本地更新时会用服务端同 ID 快照刷新旧缓存", async () => {
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      page([text("m1", "s1", 1, "new")], null),
    )

    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    act(() => {
      api?.setMessages([text("m1", "s1", 1, "old") as any])
    })

    await act(async () => {
      await (api as any).loadLatest("s1")
    })

    expect(
      (api?.getMessagesBySession("s1").find((row) => row.info.id === "m1")?.parts[0] as { text?: string })?.text,
    ).toBe("new")
  })

  it("ensureSession 已有最近页缓存时不重复请求", async () => {
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(page([msg("m1", "s2", 1)], null))

    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    await act(async () => {
      await (api as any).ensureSession("s2")
      await (api as any).ensureSession("s2")
    })

    expect((sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
    expect(api?.getMessagesBySession("s2").map((row) => row.info.id)).toEqual(["m1"])
  })

  it("latest 首屏加载期间仍是主 ready 门禁，不误暴露 older 可加载态", async () => {
    let done: ((value: unknown) => void) | null = null
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((resolve) => {
          done = resolve
        }),
    )

    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    let run: Promise<unknown> = Promise.resolve()
    await act(async () => {
      run = (api as any).loadOlder("s2x")
    })

    expect((api as any).getSessionPagination("s2x")).toMatchObject({
      ready: false,
      latestLoading: true,
      olderLoading: false,
      olderError: false,
      complete: false,
    })
    expect(api?.isSessionLoaded("s2x")).toBe(false)
    expect(api?.isSessionLoading("s2x")).toBe(true)
    expect((sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
    expect((sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toEqual({
      path: { id: "s2x" },
      query: { limit: 50 },
    })

    await act(async () => {
      done?.(page([msg("m1", "s2x", 1)], null))
      await run
    })

    expect((api as any).getSessionPagination("s2x")).toMatchObject({
      ready: true,
      latestLoading: false,
      olderLoading: false,
      olderError: false,
      complete: true,
    })
  })

  it("同会话并发 loadOlder 应去重", async () => {
    let older: ((value: unknown) => void) | null = null
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(page([msg("m3", "s3", 3), msg("m4", "s3", 4)], "c3"))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            older = resolve
          }),
      )

    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    await act(async () => {
      await (api as any).loadLatest("s3")
    })

    let a: Promise<unknown> = Promise.resolve()
    let b: Promise<unknown> = Promise.resolve()
    await act(async () => {
      a = (api as any).loadOlder("s3")
      b = (api as any).loadOlder("s3")
    })

    await waitFor(() => {
      expect((sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2)
    })

    await act(async () => {
      older?.(page([msg("m1", "s3", 1), msg("m2", "s3", 2)], null))
      await Promise.all([a, b])
    })

    expect(api?.getMessagesBySession("s3").map((row) => row.info.id)).toEqual(["m1", "m2", "m3", "m4"])
  })

  it("older load 失败后保留已有消息并暴露重试态", async () => {
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(page([msg("m3", "s3x", 3), msg("m4", "s3x", 4)], "c3x"))
      .mockResolvedValueOnce({ error: new Error("boom"), data: null, response: { headers: new Headers() } })

    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    await act(async () => {
      await (api as any).loadLatest("s3x")
    })

    await act(async () => {
      await (api as any).loadOlder("s3x")
    })

    expect(api?.getMessagesBySession("s3x").map((row) => row.info.id)).toEqual(["m3", "m4"])
    expect((api as any).getSessionPagination("s3x")).toMatchObject({
      ready: true,
      latestLoading: false,
      olderLoading: false,
      olderError: true,
      complete: false,
    })
  })

  it("older load 重试前会清旧错并复用 pending，请求成功后清掉 error", async () => {
    let older: ((value: unknown) => void) | null = null
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(page([msg("m3", "s3y", 3), msg("m4", "s3y", 4)], "c3y"))
      .mockResolvedValueOnce({ error: new Error("boom"), data: null, response: { headers: new Headers() } })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            older = resolve
          }),
      )

    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    await act(async () => {
      await (api as any).loadLatest("s3y")
      await (api as any).loadOlder("s3y")
    })

    expect((api as any).getSessionPagination("s3y")).toMatchObject({
      ready: true,
      olderLoading: false,
      olderError: true,
      complete: false,
    })

    let a: Promise<unknown> = Promise.resolve()
    let b: Promise<unknown> = Promise.resolve()
    await act(async () => {
      a = (api as any).loadOlder("s3y")
      b = (api as any).loadOlder("s3y")
    })

    expect((api as any).getSessionPagination("s3y")).toMatchObject({
      ready: true,
      olderLoading: true,
      olderError: false,
      complete: false,
    })
    expect(a).toBe(b)

    await act(async () => {
      older?.(page([msg("m1", "s3y", 1), msg("m2", "s3y", 2)], null))
      await Promise.all([a, b])
    })

    expect(api?.getMessagesBySession("s3y").map((row) => row.info.id)).toEqual(["m1", "m2", "m3", "m4"])
    expect((api as any).getSessionPagination("s3y")).toMatchObject({
      ready: true,
      olderLoading: false,
      olderError: false,
      complete: true,
    })
  })

  it("loadLatest 命中 changed 分支时派生状态以最终保留的本地 SSE 版本为准", async () => {
    let done: ((value: unknown) => void) | null = null
    const emitter = new EventEmitter()
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((resolve) => {
          done = resolve
        }),
    )

    render(
      <MessagesProvider emitter={emitter}>
        <Capture />
      </MessagesProvider>,
    )

    let run: Promise<unknown> = Promise.resolve()
    await act(async () => {
      run = (api as any).loadLatest("s3z")
    })

    await act(async () => {
      emitter.emit({
        type: "message.updated",
        properties: {
          info: {
            id: "m-live",
            sessionID: "s3z",
            role: "assistant",
            time: { created: 2, updated: 3, completed: 0 },
          },
        },
      })
      emitter.emit({
        type: "message.part.updated",
        properties: {
          part: {
            id: "p-live",
            type: "reasoning",
            sessionID: "s3z",
            messageID: "m-live",
            text: "live",
          },
        },
      })
      done?.({
        error: null,
        data: [
          {
            info: {
              id: "m-live",
              sessionID: "s3z",
              role: "assistant",
              time: { created: 2, updated: 1, completed: 9 },
            },
            parts: [],
          },
        ],
        response: { headers: new Headers() },
      } as unknown)
      await run
    })

    const rows = api?.getMessagesBySession("s3z") ?? []
    expect(rows[0]?.info.id).toBe("m-live")
    expect(rows[0]?.parts[0]).toMatchObject({ id: "p-live", type: "reasoning", text: "live" })
    expect(mocks.setReasoning).toHaveBeenCalledWith("s3z", true)
    expect(mocks.setSessionIdle).not.toHaveBeenCalled()
  })

  it("loadLatest abort 后不会误标为已加载或错误状态", async () => {
    const req = deferred<ReturnType<typeof page>>()
    let signal: AbortSignal | undefined
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      ({ signal: next }: { signal?: AbortSignal }) => {
        signal = next
        return req.promise
      },
    )

    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    const controller = new AbortController()
    let run: Promise<unknown> = Promise.resolve()
    await act(async () => {
      run = (api as any).loadLatest("s-abort-latest", controller.signal)
    })

    expect(signal).toBe(controller.signal)
    expect((api as any).getSessionPagination("s-abort-latest")).toMatchObject({
      ready: false,
      latestLoading: true,
      olderLoading: false,
      olderError: false,
      complete: false,
    })

    await act(async () => {
      controller.abort()
      req.reject(new Error("aborted"))
      await run
    })

    expect(controller.signal.aborted).toBe(true)
    expect(api?.getMessagesBySession("s-abort-latest")).toEqual([])
    expect((api as any).getSessionPagination("s-abort-latest")).toMatchObject({
      ready: false,
      latestLoading: false,
      olderLoading: false,
      olderError: false,
      complete: false,
    })
    expect(api?.isSessionLoaded("s-abort-latest")).toBe(false)
    expect(api?.isSessionLoadError("s-abort-latest")).toBe(false)
  })

  it("loadLatest abort 后即使 SDK resolve 为 error 也不会误标真实错误", async () => {
    const req = deferred<{ error: Error; data: null; response: { headers: Headers } }>()
    let signal: AbortSignal | undefined
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      ({ signal: next }: { signal?: AbortSignal }) => {
        signal = next
        return req.promise
      },
    )

    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    const controller = new AbortController()
    let run: Promise<unknown> = Promise.resolve()
    await act(async () => {
      run = (api as any).loadLatest("s-abort-latest-error", controller.signal)
    })

    expect(signal).toBe(controller.signal)

    await act(async () => {
      controller.abort()
      req.resolve({ error: new Error("aborted"), data: null, response: { headers: new Headers() } })
      await run
    })

    expect(controller.signal.aborted).toBe(true)
    expect(api?.getMessagesBySession("s-abort-latest-error")).toEqual([])
    expect((api as any).getSessionPagination("s-abort-latest-error")).toMatchObject({
      ready: false,
      latestLoading: false,
      olderLoading: false,
      olderError: false,
      complete: false,
    })
    expect(api?.isSessionLoaded("s-abort-latest-error")).toBe(false)
    expect(api?.isSessionLoadError("s-abort-latest-error")).toBe(false)
  })

  it("loadOlder abort 后保留现有消息且不误标错误", async () => {
    const req = deferred<ReturnType<typeof page>>()
    let signal: AbortSignal | undefined
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(page([msg("m3", "s-abort-older", 3), msg("m4", "s-abort-older", 4)], "c-old"))
      .mockImplementationOnce(({ signal: next }: { signal?: AbortSignal }) => {
        signal = next
        return req.promise
      })

    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    await act(async () => {
      await (api as any).loadLatest("s-abort-older")
    })

    const controller = new AbortController()
    let run: Promise<unknown> = Promise.resolve()
    await act(async () => {
      run = (api as any).loadOlder("s-abort-older", controller.signal)
    })

    expect(signal).toBe(controller.signal)
    expect((api as any).getSessionPagination("s-abort-older")).toMatchObject({
      ready: true,
      olderLoading: true,
      olderError: false,
      complete: false,
    })

    await act(async () => {
      controller.abort()
      req.reject(new Error("aborted"))
      await run
    })

    expect(controller.signal.aborted).toBe(true)
    expect(api?.getMessagesBySession("s-abort-older").map((row) => row.info.id)).toEqual(["m3", "m4"])
    expect((api as any).getSessionPagination("s-abort-older")).toMatchObject({
      ready: true,
      olderLoading: false,
      olderError: false,
      complete: false,
    })
  })

  it("scanOlder abort 时直接返回 null", async () => {
    const req = deferred<ReturnType<typeof page>>()
    let signal: AbortSignal | undefined
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(
      ({ signal: next }: { signal?: AbortSignal }) => {
        signal = next
        return req.promise
      },
    )

    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    const controller = new AbortController()
    let result: unknown
    const run = (async () => {
      result = await (api as any).scanOlder("s-scan", "c1", controller.signal)
    })()

    await act(async () => {
      controller.abort()
      req.reject(new Error("aborted"))
      await run
    })

    expect(signal).toBe(controller.signal)
    expect(controller.signal.aborted).toBe(true)
    expect(result).toBeNull()
  })

  it("公开分页 getter 在状态切换时保持同一口径", async () => {
    let done: ((value: unknown) => void) | null = null
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((resolve) => {
          done = resolve
        }),
    )

    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    await act(async () => {
      ;(api as any).loadLatest("s7")
      const page = (api as any).getSessionPagination("s7")
      expect(page.latestLoading).toBe(api?.isSessionLoading("s7"))
      expect(page.ready).toBe(api?.isSessionLoaded("s7"))
      expect(false).toBe(api?.isSessionLoadError("s7"))
      expect(page.complete).toBe(api?.isSessionComplete("s7"))
    })

    await act(async () => {
      done?.(page([msg("m1", "s7", 1)], null))
    })

    const page2 = (api as any).getSessionPagination("s7")
    expect(page2.latestLoading).toBe(api?.isSessionLoading("s7"))
    expect(page2.ready).toBe(api?.isSessionLoaded("s7"))
    expect(false).toBe(api?.isSessionLoadError("s7"))
    expect(page2.complete).toBe(api?.isSessionComplete("s7"))
  })

  it("loadLatest 期间同 ID 消息收到 SSE 更新后，晚到旧快照不应回滚实时版本", async () => {
    let done: ((value: unknown) => void) | null = null
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((resolve) => {
          done = resolve
        }),
    )
    const emitter = new EventEmitter()

    render(
      <MessagesProvider emitter={emitter}>
        <Capture />
      </MessagesProvider>,
    )

    let run: Promise<unknown> = Promise.resolve()
    await act(async () => {
      run = (api as any).loadLatest("s4")
    })

    act(() => {
      emitter.emit({
        type: "message.updated",
        properties: {
          info: {
            id: "m-live",
            sessionID: "s4",
            role: "assistant",
            time: { created: 2, updated: 3 },
          },
        },
      })
      emitter.emit({
        type: "message.part.updated",
        properties: {
          part: {
            id: "p-live",
            type: "text",
            sessionID: "s4",
            messageID: "m-live",
            text: "live",
          },
        },
      })
    })

    await waitFor(() => {
      expect(api?.getMessagesBySession("s4")[0]?.parts[0]).toMatchObject({ id: "p-live", text: "live" })
    })

    await act(async () => {
      done?.(
        page([
          {
            info: {
              id: "m-live",
              sessionID: "s4",
              role: "assistant",
              time: { created: 2, updated: 1 },
            },
            parts: [],
          },
          msg("m-old", "s4", 1),
        ]),
      )
      await run
    })

    const rows = api?.getMessagesBySession("s4") ?? []
    expect(rows.map((row) => row.info.id)).toEqual(["m-old", "m-live"])
    expect(rows[1]?.parts[0]).toMatchObject({ id: "p-live", text: "live" })
  })

  it("server.connected 会绕过断线前的 latest 请求并保留新快照", async () => {
    mocks.currentSession = { id: "s8" }
    const first = deferred<ReturnType<typeof page>>()
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(page([msg("fresh", "s8", 2)], null))
    vi.mocked(sdk.permissions.list).mockResolvedValue({ data: [], error: null })
    vi.mocked(sdk.question.list).mockResolvedValue({ data: [], error: null })
    const emitter = new EventEmitter()

    render(
      <MessagesProvider emitter={emitter}>
        <Capture />
      </MessagesProvider>,
    )

    let stale: Promise<unknown> = Promise.resolve()
    await act(async () => {
      stale = (api as NonNullable<typeof api>).loadLatest("s8")
    })
    await act(async () => {
      emitter.emit({ type: "server.connected", properties: {} })
    })

    await waitFor(() => expect(sdk.session.messages).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(api?.getMessagesBySession("s8").map((item) => item.info.id)).toEqual(["fresh"]))
    await act(async () => {
      first.resolve(page([msg("stale", "s8", 1)], null))
      await stale
    })

    expect(api?.getMessagesBySession("s8").map((item) => item.info.id)).toEqual(["fresh"])
  })

  it("同会话并发 loadLatest 应复用同一请求", async () => {
    let done: ((value: unknown) => void) | null = null
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      () =>
        new Promise((resolve) => {
          done = resolve
        }),
    )

    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    let a: Promise<unknown> = Promise.resolve()
    let b: Promise<unknown> = Promise.resolve()
    await act(async () => {
      a = (api as any).loadLatest("s5")
      b = (api as any).loadLatest("s5")
    })

    expect((sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1)
    expect(api?.isSessionLoading("s5")).toBe(true)

    await act(async () => {
      done?.(page([msg("m1", "s5", 1)], null))
      await Promise.all([a, b])
    })

    expect(api?.getMessagesBySession("s5").map((row) => row.info.id)).toEqual(["m1"])
    expect(api?.isSessionLoaded("s5")).toBe(true)
  })

  it("loadOlder 拉到最后一页后，isSessionComplete 会立即反映完成态", async () => {
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(page([msg("m3", "s6", 3), msg("m4", "s6", 4)], "c6"))
      .mockResolvedValueOnce(page([msg("m1", "s6", 1), msg("m2", "s6", 2)], null))

    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    await act(async () => {
      await (api as any).loadLatest("s6")
    })

    let complete = false
    await act(async () => {
      await (api as any).loadOlder("s6")
      complete = api?.isSessionComplete("s6") ?? false
    })

    expect(complete).toBe(true)
  })

  it("loadLatest 返回空页时保留该 session 的本地消息，并维持现有派生状态", async () => {
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(page([], null))
    const emitter = new EventEmitter()

    render(
      <MessagesProvider emitter={emitter}>
        <Capture />
      </MessagesProvider>,
    )

    act(() => {
      emitter.emit({
        type: "message.updated",
        properties: {
          info: {
            id: "m-live",
            sessionID: "sx",
            role: "assistant",
            time: { created: 2, updated: 3, completed: 0 },
          },
        },
      })
      emitter.emit({
        type: "message.part.updated",
        properties: {
          part: {
            id: "p-live",
            type: "reasoning",
            sessionID: "sx",
            messageID: "m-live",
            text: "thinking",
          },
        },
      })
    })

    await waitFor(() => {
      expect(api?.getMessagesBySession("sx").map((row) => row.info.id)).toEqual(["m-live"])
    })

    expect(mocks.setReasoning).toHaveBeenCalledWith("sx", true)

    await act(async () => {
      await (api as any).loadLatest("sx")
    })

    expect(api?.getMessagesBySession("sx").map((row) => row.info.id)).toEqual(["m-live"])
    expect((api as any).getSessionPagination("sx")).toMatchObject({
      ready: true,
      latestLoading: false,
      olderLoading: false,
      olderError: false,
      complete: true,
    })
    expect(mocks.setReasoning.mock.calls.at(-1)).toEqual(["sx", true])
    expect(mocks.setSessionIdle).not.toHaveBeenCalledWith("sx", true)
  })

  it("message.removed 不会在同 session 仍有其他 reasoning 时错误清空状态", async () => {
    const emitter = new EventEmitter()

    render(
      <MessagesProvider emitter={emitter}>
        <Capture />
      </MessagesProvider>,
    )

    act(() => {
      emitter.emit({
        type: "message.updated",
        properties: {
          info: {
            id: "m1",
            sessionID: "sr",
            role: "assistant",
            time: { created: 1 },
          },
        },
      })
      emitter.emit({
        type: "message.updated",
        properties: {
          info: {
            id: "m2",
            sessionID: "sr",
            role: "assistant",
            time: { created: 2 },
          },
        },
      })
      emitter.emit({
        type: "message.part.updated",
        properties: {
          part: think("p1", "sr", "m1", "a"),
        },
      })
      emitter.emit({
        type: "message.part.updated",
        properties: {
          part: think("p2", "sr", "m2", "b"),
        },
      })
    })

    expect(mocks.setReasoning.mock.calls.at(-1)).toEqual(["sr", true])

    act(() => {
      emitter.emit({
        type: "message.removed",
        properties: {
          sessionID: "sr",
          messageID: "m1",
        },
      })
    })

    expect(api?.getMessagesBySession("sr").map((row) => row.info.id)).toEqual(["m2"])
    expect(mocks.setReasoning.mock.calls.at(-1)).toEqual(["sr", true])
  })

  it("不同 session 的 older loading/error/complete 状态不会串写", async () => {
    let older: ((value: unknown) => void) | null = null
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(page([msg("a3", "sa", 3)], "ca"))
      .mockResolvedValueOnce(page([msg("b3", "sb", 3)], "cb"))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            older = resolve
          }),
      )

    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    await act(async () => {
      await (api as any).loadLatest("sa")
      await (api as any).loadLatest("sb")
    })

    expect((api as any).getSessionPagination("sa")).toMatchObject({ ready: true, complete: false })
    expect((api as any).getSessionPagination("sb")).toMatchObject({ ready: true, complete: false })

    let run: Promise<unknown> = Promise.resolve()
    await act(async () => {
      run = (api as any).loadOlder("sa")
    })

    expect((api as any).getSessionPagination("sa")).toMatchObject({ ready: true, olderLoading: true })
    expect((api as any).getSessionPagination("sb")).toMatchObject({
      ready: true,
      olderLoading: false,
      olderError: false,
    })

    await act(async () => {
      older?.({ error: new Error("boom"), data: null, response: { headers: new Headers() } })
      await run
    })

    expect((api as any).getSessionPagination("sa")).toMatchObject({
      ready: true,
      olderLoading: false,
      olderError: true,
      complete: false,
    })
    expect((api as any).getSessionPagination("sb")).toMatchObject({
      ready: true,
      olderLoading: false,
      olderError: false,
      complete: false,
    })
  })
})
