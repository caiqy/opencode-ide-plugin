import { act, render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
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
      respond: vi.fn(),
    },
    question: {
      reply: vi.fn(),
      reject: vi.fn(),
    },
  },
}))

vi.mock("../lib/ideBridge", () => ({
  reloadPath: vi.fn(),
  ideBridge: { isInstalled: () => false, send: vi.fn() },
}))

vi.mock("./SessionContext", () => ({
  useSession: () => ({
    setReasoning: mocks.setReasoning,
    setSessionIdle: mocks.setSessionIdle,
  }),
}))

import { MessagesProvider, useMessages } from "./MessagesContext"
import { sdk } from "../lib/api/sdkClient"

let api: ReturnType<typeof useMessages> | null = null

function Capture() {
  api = useMessages()
  return null
}

function mountProvider(emitter: EventEmitter) {
  render(
    <MessagesProvider emitter={emitter}>
      <Capture />
      <div data-testid="messages-provider" />
    </MessagesProvider>,
  )
}

describe("MessagesContext reasoning tracking", () => {
  beforeEach(() => {
    mocks.setReasoning.mockReset()
    mocks.setSessionIdle.mockReset()
    vi.mocked(sdk.session.messages).mockReset()
    api = null
  })

  it("加载历史时忽略已完成 assistant 中缺少 end 的 reasoning", async () => {
    vi.mocked(sdk.session.messages).mockResolvedValue({
      data: [
        {
          info: {
            id: "m1",
            sessionID: "s1",
            role: "assistant",
            time: { created: 1, completed: 3 },
          },
          parts: [
            {
              id: "r1",
              type: "reasoning",
              sessionID: "s1",
              messageID: "m1",
              text: "stale",
              time: { start: 1 },
            },
          ],
        },
      ],
      error: null,
    } as never)
    mountProvider(new EventEmitter())

    await act(async () => {
      await api?.loadLatest("s1")
    })

    expect(mocks.setReasoning).toHaveBeenLastCalledWith("s1", false)
  })

  it("reasoning 进行中收到非 reasoning part 更新，不应误清空 reasoning 状态", async () => {
    const emitter = new EventEmitter()
    mountProvider(emitter)

    await act(async () => {
      emitter.emit({
        type: "message.part.updated",
        properties: {
          part: {
            id: "r1",
            type: "reasoning",
            sessionID: "s1",
            messageID: "m1",
            text: "thinking",
            time: { start: 1 },
          },
          delta: "thinking",
        },
      } as ServerEvent)
    })

    await act(async () => {
      emitter.emit({
        type: "message.part.updated",
        properties: {
          part: {
            id: "t1",
            type: "text",
            sessionID: "s1",
            messageID: "m1",
            text: "hello",
            time: { start: 2 },
          },
          delta: "hello",
        },
      } as ServerEvent)
    })

    expect(mocks.setReasoning).toHaveBeenCalledWith("s1", true)
    expect(mocks.setReasoning).not.toHaveBeenCalledWith("s1", false)
  })

  it("reasoning part 结束后应正确清空 reasoning 状态", async () => {
    const emitter = new EventEmitter()
    mountProvider(emitter)

    await act(async () => {
      emitter.emit({
        type: "message.part.updated",
        properties: {
          part: {
            id: "r1",
            type: "reasoning",
            sessionID: "s1",
            messageID: "m1",
            text: "thinking",
            time: { start: 1 },
          },
          delta: "thinking",
        },
      } as ServerEvent)
    })

    await act(async () => {
      emitter.emit({
        type: "message.part.updated",
        properties: {
          part: {
            id: "r1",
            type: "reasoning",
            sessionID: "s1",
            messageID: "m1",
            text: "thinking",
            time: { start: 1, end: 3 },
          },
        },
      } as ServerEvent)
    })

    expect(mocks.setReasoning).toHaveBeenLastCalledWith("s1", false)
  })

  it("assistant 完成事件晚于 reasoning part 时应清空 reasoning 状态", async () => {
    const emitter = new EventEmitter()
    mountProvider(emitter)

    await act(async () => {
      emitter.emit({
        type: "message.updated",
        properties: {
          info: { id: "m1", sessionID: "s1", role: "assistant", time: { created: 1 } },
        },
      } as ServerEvent)
      emitter.emit({
        type: "message.part.updated",
        properties: {
          part: {
            id: "r1",
            type: "reasoning",
            sessionID: "s1",
            messageID: "m1",
            text: "thinking",
            time: { start: 1 },
          },
        },
      } as ServerEvent)
    })

    await act(async () => {
      emitter.emit({
        type: "message.updated",
        properties: {
          info: { id: "m1", sessionID: "s1", role: "assistant", time: { created: 1, completed: 3 } },
        },
      } as ServerEvent)
    })

    expect(mocks.setReasoning).toHaveBeenLastCalledWith("s1", false)
  })

  it("并发 reasoning 时，单条结束不应清空整体 reasoning 状态", async () => {
    const emitter = new EventEmitter()
    mountProvider(emitter)

    await act(async () => {
      emitter.emit({
        type: "message.part.updated",
        properties: {
          part: {
            id: "r1",
            type: "reasoning",
            sessionID: "s1",
            messageID: "m1",
            text: "one",
            time: { start: 1 },
          },
          delta: "one",
        },
      } as ServerEvent)
      emitter.emit({
        type: "message.part.updated",
        properties: {
          part: {
            id: "r2",
            type: "reasoning",
            sessionID: "s1",
            messageID: "m1",
            text: "two",
            time: { start: 2 },
          },
          delta: "two",
        },
      } as ServerEvent)
    })

    await act(async () => {
      emitter.emit({
        type: "message.part.updated",
        properties: {
          part: {
            id: "r1",
            type: "reasoning",
            sessionID: "s1",
            messageID: "m1",
            text: "one",
            time: { start: 1, end: 3 },
          },
        },
      } as ServerEvent)
    })

    expect(mocks.setReasoning).toHaveBeenLastCalledWith("s1", true)
  })
})
