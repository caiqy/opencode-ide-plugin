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

describe("MessagesContext questions", () => {
  beforeEach(() => {
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
})
