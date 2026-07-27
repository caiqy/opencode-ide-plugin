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

import { sdk } from "../lib/api/sdkClient"
import { MessagesProvider, useMessages } from "./MessagesContext"

let api: ReturnType<typeof useMessages> | null = null

function Capture() {
  api = useMessages()
  return null
}

const info = {
  id: "m1",
  sessionID: "s1",
  role: "assistant",
  time: { created: 1 },
}

describe("MessagesContext task_result adapter", () => {
  beforeEach(() => {
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mockReset()
    mocks.setReasoning.mockReset()
    mocks.setSessionIdle.mockReset()
    api = null
  })

  it("message.part.updated 的 task part 应写入 parsed.task_result", async () => {
    const emitter = new EventEmitter()
    render(
      <MessagesProvider emitter={emitter}>
        <Capture />
      </MessagesProvider>,
    )

    act(() => {
      api?.setMessages([{ info: info as any, parts: [] }])
    })

    await act(async () => {
      emitter.emit({
        type: "message.part.updated",
        properties: {
          part: {
            id: "p1",
            type: "tool",
            tool: "task",
            callID: "c1",
            sessionID: "s1",
            messageID: "m1",
            state: {
              status: "completed",
              output: "task_id: x\n<task_result>**ok**</task_result>",
            },
          },
        },
      } as ServerEvent)
    })

    const msg = api?.getMessagesBySession("s1")[0]
    const part = msg?.parts[0] as { parsed?: { task_result?: { text?: string } } } | undefined
    expect(part?.parsed?.task_result?.text).toBe("**ok**")
  })

  it("最近页加载和历史分页返回的 task part 都应写入 parsed.task_result", async () => {
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: null,
      data: [
        {
          info,
          parts: [
            {
              id: "p2",
              type: "tool",
              tool: "task",
              callID: "c2",
              sessionID: "s1",
              messageID: "m1",
              state: {
                status: "completed",
                output: "<task_result># title</task_result>",
              },
            },
          ],
        },
      ],
      response: {
        headers: new Headers({ "X-Next-Cursor": "c1" }),
      },
    })

    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    await act(async () => {
      await (api as any)?.loadLatest("s1")
    })

    const msg = api?.getMessagesBySession("s1")[0]
    const part = msg?.parts[0] as { parsed?: { task_result?: { text?: string } } } | undefined
    expect(part?.parsed?.task_result?.text).toBe("# title")
    ;(sdk.session.messages as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      error: null,
      data: [
        {
          info: {
            ...info,
            id: "m0",
            time: { created: 0 },
          },
          parts: [
            {
              id: "p2-old",
              type: "tool",
              tool: "task",
              callID: "c2-old",
              sessionID: "s1",
              messageID: "m0",
              state: {
                status: "completed",
                output: "<task_result>older</task_result>",
              },
            },
          ],
        },
      ],
      response: {
        headers: new Headers(),
      },
    })

    await act(async () => {
      await (api as any)?.loadOlder("s1")
    })

    const rows = api?.getMessagesBySession("s1") ?? []
    const older = rows[0]?.parts[0] as { parsed?: { task_result?: { text?: string } } } | undefined
    expect(older?.parsed?.task_result?.text).toBe("older")
  })

  it("addPart 直接入库 task part 也应经过同一适配", () => {
    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    act(() => {
      api?.setMessages([{ info: info as any, parts: [] }])
    })

    act(() => {
      api?.addPart("m1", {
        id: "p3",
        type: "tool",
        tool: "task",
        callID: "c3",
        sessionID: "s1",
        messageID: "m1",
        state: {
          status: "completed",
          output: "<task_result>hello</task_result>",
        },
      } as any)
    })

    const msg = api?.getMessagesBySession("s1")[0]
    const part = msg?.parts[0] as { parsed?: { task_result?: { text?: string } } } | undefined
    expect(part?.parsed?.task_result?.text).toBe("hello")
  })

  it("updatePart 更新 task 输出时应刷新 parsed.task_result", () => {
    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    act(() => {
      api?.setMessages([
        {
          info: info as any,
          parts: [
            {
              id: "p4",
              type: "tool",
              tool: "task",
              callID: "c4",
              sessionID: "s1",
              messageID: "m1",
              state: {
                status: "completed",
                output: "<task_result>old</task_result>",
              },
            } as any,
          ],
        },
      ])
    })

    act(() => {
      api?.updatePart("m1", "p4", {
        state: {
          status: "completed",
          output: "<task_result>new</task_result>",
        },
      } as any)
    })

    const msg = api?.getMessagesBySession("s1")[0]
    const part = msg?.parts[0] as { parsed?: { task_result?: { text?: string } } } | undefined
    expect(part?.parsed?.task_result?.text).toBe("new")
  })
})
