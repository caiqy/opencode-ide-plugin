import { act, render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

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

vi.mock("./SessionContext", () => ({
  useSession: () => ({
    setReasoning: mocks.setReasoning,
    setSessionIdle: mocks.setSessionIdle,
  }),
}))

import { EventEmitter } from "../lib/api/events"
import { MessagesProvider, useMessages } from "./MessagesContext"

let api: ReturnType<typeof useMessages> | null = null

function Capture() {
  api = useMessages()
  return null
}

describe("MessagesContext session errors", () => {
  beforeEach(() => {
    mocks.setReasoning.mockReset()
    mocks.setSessionIdle.mockReset()
    api = null
  })

  it("session.compacted 会清理之前的合成会话错误", () => {
    const emitter = new EventEmitter()

    render(
      <MessagesProvider emitter={emitter}>
        <Capture />
      </MessagesProvider>,
    )

    act(() => {
      emitter.emit({
        type: "session.error",
        properties: {
          sessionID: "s1",
          error: {
            name: "ContextOverflowError",
            message: "context_length_exceeded",
          },
        },
      })
    })

    expect(api?.getMessagesBySession("s1").map((row) => row.parts[0]?.type)).toEqual(["session-error"])

    act(() => {
      emitter.emit({
        type: "session.compacted",
        properties: { sessionID: "s1" },
      })
    })

    expect(api?.getMessagesBySession("s1")).toEqual([])
  })
})
