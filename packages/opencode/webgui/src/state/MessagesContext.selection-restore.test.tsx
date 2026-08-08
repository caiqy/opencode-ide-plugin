import { act, render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  restoreSelections: vi.fn(),
  setReasoning: vi.fn(),
  setSessionIdle: vi.fn(),
}))

vi.mock("../lib/api/sdkClient", () => ({
  sdk: {
    session: {
      messages: vi.fn(),
    },
    permissions: {
      respond: vi.fn(),
    },
    question: {
      reply: vi.fn(),
      reject: vi.fn(),
    },
  },
}))

vi.mock("./SessionContext", () => ({
  useSession: () => ({
    restoreSelections: mocks.restoreSelections,
    setReasoning: mocks.setReasoning,
    setSessionIdle: mocks.setSessionIdle,
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

describe("MessagesContext session loading", () => {
  beforeEach(() => {
    mocks.restoreSelections.mockReset()
    mocks.setReasoning.mockReset()
    mocks.setSessionIdle.mockReset()
    ;(sdk.session.messages as any).mockReset()
    api = null
  })

  it("ensureSession 只返回最近页数据且不触发 restoreSelections", async () => {
    ;(sdk.session.messages as any).mockResolvedValue({
      error: null,
      data: [
        {
          info: {
            id: "u1",
            sessionID: "s1",
            role: "user",
            time: { created: 1 },
            agent: "build",
            model: { providerID: "openai", modelID: "gpt-4.1" },
            variant: "low",
          },
          parts: [],
        },
        {
          info: {
            id: "a1",
            sessionID: "s1",
            role: "assistant",
            time: { created: 2, completed: 2 },
            agent: "build",
          },
          parts: [],
        },
        {
          info: {
            id: "u2",
            sessionID: "s1",
            role: "user",
            time: { created: 3 },
            agent: "plan",
            model: { providerID: "anthropic", modelID: "claude-4-sonnet" },
            variant: "high",
          },
          parts: [],
        },
      ],
      response: {
        headers: new Headers(),
      },
    })

    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    let loaded: unknown
    await act(async () => {
      loaded = await (api as any).ensureSession("s1")
    })

    expect(mocks.restoreSelections).not.toHaveBeenCalled()
    expect(Array.isArray(loaded)).toBe(true)
    expect((loaded as Array<{ info: { id: string } }>).map((msg) => msg.info.id)).toEqual(["u1", "a1", "u2"])
    expect((loaded as Array<unknown>).length).toBe(3)
    expect(api!.isSessionLoading("s1")).toBe(false)
    expect(api!.isSessionLoaded("s1")).toBe(true)
    expect(api!.isSessionLoadError("s1")).toBe(false)
  })

  it("当最近页返回空数组时保留本地 session 消息且不触发 restoreSelections", async () => {
    const localMessage = {
      info: {
        id: "local-u1",
        sessionID: "s1",
        role: "user",
        time: { created: 1 },
      },
      parts: [],
    }
    ;(sdk.session.messages as any).mockResolvedValue({
      error: null,
      data: [],
      response: {
        headers: new Headers(),
      },
    })

    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    act(() => {
      api!.setMessages([localMessage as any])
    })

    let loaded: unknown
    await act(async () => {
      loaded = await (api as any).ensureSession("s1")
    })

    expect(loaded).toEqual([])
    expect(mocks.restoreSelections).not.toHaveBeenCalled()
    expect(api!.getMessagesBySession("s1").map((msg) => msg.info.id)).toEqual(["local-u1"])
    expect(api!.getMessagesBySession("s1")).toHaveLength(1)
    expect(api!.isSessionLoaded("s1")).toBe(true)
  })

  it("请求进行中为 loading，失败后为 error", async () => {
    let resolve: (value: unknown) => void = () => {}
    ;(sdk.session.messages as any).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )

    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    let run: Promise<unknown> = Promise.resolve()
    await act(async () => {
      run = (api as any).ensureSession("s2")
    })

    await waitFor(() => {
      expect(api!.isSessionLoading("s2")).toBe(true)
    })
    expect(api!.isSessionLoaded("s2")).toBe(false)

    await act(async () => {
      resolve({ error: { message: "boom" } })
      await run
    })

    expect(api!.isSessionLoading("s2")).toBe(false)
    expect(api!.isSessionLoaded("s2")).toBe(false)
    expect(api!.isSessionLoadError("s2")).toBe(true)
  })

  it("同会话并发加载最近页时应复用同一请求", async () => {
    let resolve: ((value: unknown) => void) | null = null
    ;(sdk.session.messages as any).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
        }),
    )

    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    let runA: Promise<unknown> = Promise.resolve()
    let runB: Promise<unknown> = Promise.resolve()
    await act(async () => {
      runA = (api as any).loadLatest("s3")
      runB = (api as any).loadLatest("s3")
    })

    expect(sdk.session.messages).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolve?.({
        error: null,
        data: [
          {
            info: {
              id: "new-u1",
              sessionID: "s3",
              role: "user",
              time: { created: 2 },
            },
            parts: [],
          },
        ],
        response: {
          headers: new Headers(),
        },
      })
      await Promise.all([runA, runB])
    })

    expect(api!.getMessagesBySession("s3").map((msg) => msg.info.id)).toEqual(["new-u1"])
    expect(mocks.setSessionIdle).not.toHaveBeenCalled()
  })

  it("加载期间收到 message.updated 时应保留实时更新并合并快照缺失消息", async () => {
    let resolve: ((value: unknown) => void) | null = null
    ;(sdk.session.messages as any).mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r
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
            id: "evt-u1",
            sessionID: "s4",
            role: "user",
            time: { created: 2 },
          },
        },
      })
    })

    await waitFor(() => {
      expect(api!.getMessagesBySession("s4").map((msg) => msg.info.id)).toEqual(["evt-u1"])
    })

    await act(async () => {
      resolve?.({
        error: null,
        data: [
          {
            info: {
              id: "old-u1",
              sessionID: "s4",
              role: "user",
              time: { created: 1 },
            },
            parts: [],
          },
        ],
        response: {
          headers: new Headers(),
        },
      })
      await run
    })

    expect(
      api!
        .getMessagesBySession("s4")
        .map((msg) => msg.info.id)
        .sort(),
    ).toEqual(["evt-u1", "old-u1"])
  })
})
