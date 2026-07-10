import { act, render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PermissionRequest, QuestionRequest } from "@opencode-ai/sdk/v2/client"
import { EventEmitter, type ServerEvent } from "../lib/api/events"

const mocks = vi.hoisted(() => ({
  setReasoning: vi.fn(),
  setSessionIdle: vi.fn(),
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

vi.mock("../lib/ideBridge", () => ({
  reloadPath: vi.fn(),
}))

vi.mock("./SessionContext", () => ({
  useSession: () => ({
    setReasoning: mocks.setReasoning,
    setSessionIdle: mocks.setSessionIdle,
  }),
}))

import { sdk } from "../lib/api/sdkClient"
import { MessagesProvider, useMessages } from "./MessagesContext"

let api: ReturnType<typeof useMessages> | null = null

function Capture() {
  api = useMessages()
  return null
}

function mount(emitter: EventEmitter) {
  render(
    <MessagesProvider emitter={emitter}>
      <Capture />
    </MessagesProvider>,
  )
}

function ask(requestID: string, sessionID = "s1") {
  return {
    type: "question.asked",
    properties: {
      id: requestID,
      sessionID,
      question: "q",
      options: [],
      tool: {
        messageID: "m1",
        callID: "c1",
      },
    },
  } as ServerEvent
}

function permission(requestID: string, sessionID = "s1"): PermissionRequest {
  return {
    id: requestID,
    sessionID,
    permission: "edit",
    patterns: ["src/a.ts"],
    metadata: {},
    always: [],
  }
}

function permissionAsked(requestID: string, sessionID = "s1") {
  return {
    type: "permission.asked",
    properties: permission(requestID, sessionID),
  } as ServerEvent
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

describe("MessagesContext questions", () => {
  beforeEach(() => {
    vi.mocked(sdk.permissions.list).mockReset()
    vi.mocked(sdk.question.list).mockReset()
    ;(sdk.permissions.respond as unknown as ReturnType<typeof vi.fn>).mockReset()
    ;(sdk.question.reply as unknown as ReturnType<typeof vi.fn>).mockReset()
    ;(sdk.question.reject as unknown as ReturnType<typeof vi.fn>).mockReset()
    mocks.setReasoning.mockReset()
    mocks.setSessionIdle.mockReset()
    api = null
  })

  it("replyQuestion 遇到结构化 error 时不应移除本地问题", async () => {
    const emitter = new EventEmitter()
    ;(sdk.question.reply as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: null,
      error: new Error("boom"),
    })
    mount(emitter)

    await act(async () => {
      emitter.emit(ask("q1"))
    })

    expect(api?.getQuestionsBySession("s1").map((q) => q.id)).toEqual(["q1"])

    let ok = false
    await act(async () => {
      ok = await (api as NonNullable<typeof api>).replyQuestion("q1", [])
    })

    expect(ok).toBe(false)
    expect(api?.getQuestionsBySession("s1").map((q) => q.id)).toEqual(["q1"])
  })

  it("rejectQuestion 遇到结构化 error 时不应移除本地问题", async () => {
    const emitter = new EventEmitter()
    ;(sdk.question.reject as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: null,
      error: new Error("boom"),
    })
    mount(emitter)

    await act(async () => {
      emitter.emit(ask("q1"))
    })

    expect(api?.getQuestionsBySession("s1").map((q) => q.id)).toEqual(["q1"])

    let ok = true
    await act(async () => {
      ok = await (api as NonNullable<typeof api>).rejectQuestion("q1")
    })

    expect(ok).toBe(false)
    expect(api?.getQuestionsBySession("s1").map((q) => q.id)).toEqual(["q1"])
  })

  it("server.connected 时恢复 pending question 和 permission", async () => {
    vi.mocked(sdk.question.list).mockResolvedValueOnce({
      data: [ask("q1").properties as QuestionRequest],
      error: null,
    })
    vi.mocked(sdk.permissions.list).mockResolvedValueOnce({ data: [permission("p1")], error: null })
    const emitter = new EventEmitter()
    mount(emitter)

    await act(async () => {
      emitter.emit({ type: "server.connected", properties: {} })
    })

    await waitFor(() => {
      expect(api?.getQuestionsBySession("s1").map((item) => item.id)).toEqual(["q1"])
      expect(api?.permissions.map((item) => item.id)).toEqual(["p1"])
    })
  })

  it("水合期间收到 SSE 时丢弃旧快照并重拉", async () => {
    const first = deferred<{ data: QuestionRequest[]; error: null }>()
    vi.mocked(sdk.question.list).mockImplementationOnce(() => first.promise)
    vi.mocked(sdk.question.list).mockResolvedValueOnce({
      data: [ask("q2").properties as QuestionRequest],
      error: null,
    })
    vi.mocked(sdk.permissions.list).mockResolvedValue({ data: [], error: null })
    const emitter = new EventEmitter()
    mount(emitter)

    await act(async () => {
      emitter.emit({ type: "server.connected", properties: {} })
    })
    await act(async () => {
      emitter.emit(ask("q2"))
    })
    await act(async () => {
      first.resolve({ data: [ask("q1").properties as QuestionRequest], error: null })
    })

    await waitFor(() => expect(sdk.question.list).toHaveBeenCalledTimes(2))
    expect(api?.getQuestionsBySession("s1").map((item) => item.id)).toEqual(["q2"])
  })

  it("连续 server.connected 时旧 epoch 快照晚到不会覆盖新快照", async () => {
    const first = deferred<{ data: QuestionRequest[]; error: null }>()
    vi.mocked(sdk.question.list)
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ data: [ask("q2").properties as QuestionRequest], error: null })
    vi.mocked(sdk.permissions.list).mockResolvedValue({ data: [], error: null })
    const emitter = new EventEmitter()
    mount(emitter)

    await act(async () => {
      emitter.emit({ type: "server.connected", properties: {} })
    })
    await act(async () => {
      emitter.emit({ type: "server.connected", properties: {} })
    })

    await waitFor(() => expect(api?.getQuestionsBySession("s1").map((item) => item.id)).toEqual(["q2"]))
    await act(async () => {
      first.resolve({ data: [ask("q1").properties as QuestionRequest], error: null })
    })

    expect(api?.getQuestionsBySession("s1").map((item) => item.id)).toEqual(["q2"])
  })

  it("连续 hydration 都遇到 SSE 时清除旧 pending 并保留新请求", async () => {
    const first = deferred<{ data: QuestionRequest[]; error: null }>()
    const second = deferred<{ data: QuestionRequest[]; error: null }>()
    vi.mocked(sdk.question.list).mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise)
    vi.mocked(sdk.permissions.list).mockResolvedValue({ data: [], error: null })
    const emitter = new EventEmitter()
    mount(emitter)

    await act(async () => {
      emitter.emit(ask("old"))
      emitter.emit({ type: "server.connected", properties: {} })
    })
    await act(async () => {
      emitter.emit(ask("new-1"))
      first.resolve({ data: [], error: null })
    })
    await waitFor(() => expect(sdk.question.list).toHaveBeenCalledTimes(2))
    await act(async () => {
      emitter.emit(ask("new-2"))
      second.resolve({ data: [], error: null })
    })

    await waitFor(() => {
      expect(api?.getQuestionsBySession("s1").map((item) => item.id)).toEqual(["new-1", "new-2"])
    })
  })

  it("failed hydration does not preserve an old SSE touch into the next epoch", async () => {
    const first = deferred<{ data: QuestionRequest[]; error: { message: string } }>()
    vi.mocked(sdk.question.list)
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ data: null, error: { message: "offline" } })
      .mockResolvedValueOnce({ data: [], error: null })
    vi.mocked(sdk.permissions.list).mockResolvedValue({ data: [], error: null })
    const emitter = new EventEmitter()
    mount(emitter)

    await act(async () => {
      emitter.emit({ type: "server.connected", properties: {} })
      emitter.emit(ask("old"))
      first.resolve({ data: null, error: { message: "offline" } })
    })
    await act(async () => {
      emitter.emit({ type: "server.connected", properties: {} })
    })

    await waitFor(() => expect(api?.getQuestionsBySession("s1")).toEqual([]))
  })

  it("成功 respondPermission 后旧 pending permission 快照不会复活请求", async () => {
    const first = deferred<{ data: PermissionRequest[]; error: null }>()
    vi.mocked(sdk.permissions.list)
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ data: [], error: null })
    vi.mocked(sdk.question.list).mockResolvedValue({ data: [], error: null })
    ;(sdk.permissions.respond as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: true, error: null })
    const emitter = new EventEmitter()
    mount(emitter)

    await act(async () => {
      emitter.emit(permissionAsked("p1"))
      emitter.emit({ type: "server.connected", properties: {} })
    })
    await act(async () => {
      await (api as NonNullable<typeof api>).respondPermission("p1", "once")
      first.resolve({ data: [permission("p1")], error: null })
    })

    await waitFor(() => expect(sdk.permissions.list).toHaveBeenCalledTimes(2))
    expect(api?.permissions).toEqual([])
  })

  it("成功 replyQuestion 后旧 pending question 快照不会复活请求", async () => {
    const first = deferred<{ data: QuestionRequest[]; error: null }>()
    vi.mocked(sdk.question.list)
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ data: [], error: null })
    vi.mocked(sdk.permissions.list).mockResolvedValue({ data: [], error: null })
    ;(sdk.question.reply as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: true, error: null })
    const emitter = new EventEmitter()
    mount(emitter)

    await act(async () => {
      emitter.emit(ask("q1"))
      emitter.emit({ type: "server.connected", properties: {} })
    })
    await act(async () => {
      await (api as NonNullable<typeof api>).replyQuestion("q1", [])
      first.resolve({ data: [ask("q1").properties as QuestionRequest], error: null })
    })

    await waitFor(() => expect(sdk.question.list).toHaveBeenCalledTimes(2))
    expect(api?.getQuestionsBySession("s1")).toEqual([])
  })

  it("成功 rejectQuestion 后旧 pending question 快照不会复活请求", async () => {
    const first = deferred<{ data: QuestionRequest[]; error: null }>()
    vi.mocked(sdk.question.list)
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce({ data: [], error: null })
    vi.mocked(sdk.permissions.list).mockResolvedValue({ data: [], error: null })
    ;(sdk.question.reject as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ data: true, error: null })
    const emitter = new EventEmitter()
    mount(emitter)

    await act(async () => {
      emitter.emit(ask("q1"))
      emitter.emit({ type: "server.connected", properties: {} })
    })
    await act(async () => {
      await (api as NonNullable<typeof api>).rejectQuestion("q1")
      first.resolve({ data: [ask("q1").properties as QuestionRequest], error: null })
    })

    await waitFor(() => expect(sdk.question.list).toHaveBeenCalledTimes(2))
    expect(api?.getQuestionsBySession("s1")).toEqual([])
  })
})
