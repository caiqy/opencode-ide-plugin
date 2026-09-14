import { act, render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { useEffect } from "react"
import type { EventEmitter } from "../lib/api/events"

const mocks = vi.hoisted(() => ({
  setReasoning: vi.fn(),
  setSessionIdle: vi.fn(),
}))

vi.mock("../lib/api/sdkClient", () => ({
  sdk: {
    session: {
      messages: vi.fn(),
      get: vi.fn(),
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
  ideBridge: { isInstalled: () => false, send: vi.fn() },
}))

vi.mock("./SessionContext", () => ({
  useSession: () => ({
    currentSession: null,
    setReasoning: mocks.setReasoning,
    setSessionIdle: mocks.setSessionIdle,
  }),
}))

import { useEventStream } from "../lib/api/events"
import { MessagesProvider, useMessages } from "./MessagesContext"
import { sdk } from "../lib/api/sdkClient"

class MockSource {
  static all: MockSource[] = []
  url: string
  close = vi.fn()
  onopen: ((this: EventSource, ev: Event) => unknown) | null = null
  onmessage: ((this: EventSource, ev: MessageEvent) => unknown) | null = null
  onerror: ((this: EventSource, ev: Event) => unknown) | null = null

  constructor(url: string) {
    this.url = url
    MockSource.all.push(this)
  }
}

let api: ReturnType<typeof useMessages> | null = null
let emitter: EventEmitter | null = null

function Capture() {
  api = useMessages()
  return null
}

function StreamBridge() {
  const stream = useEventStream()
  useEffect(() => {
    emitter = stream.emitter
  }, [stream.emitter])
  return (
    <MessagesProvider emitter={stream.emitter}>
      <Capture />
    </MessagesProvider>
  )
}

function envelope(type: string, properties: unknown) {
  return {
    data: JSON.stringify({
      directory: "D:\\Caiqy\\Projects\\Github\\opencode-ide-plugin\\hosts\\vscode-plugin\\test-fixtures",
      project: "proj_test",
      payload: { id: `evt_${type}`, type, properties },
    }),
  } as MessageEvent
}

function push(source: MockSource, event: MessageEvent) {
  act(() => {
    source.onmessage?.call(source as unknown as EventSource, event)
  })
}

describe("MessagesContext global event stream", () => {
  beforeEach(() => {
    MockSource.all = []
    api = null
    emitter = null
    mocks.setReasoning.mockReset()
    mocks.setSessionIdle.mockReset()
    vi.unstubAllGlobals()
    vi.stubGlobal("EventSource", MockSource as unknown as typeof EventSource)
    vi.mocked(sdk.session.get).mockResolvedValue({ data: null, error: null } as never)
  })

  it("跨目录会话的全局信封事件进入消息 store 与 idle 订阅", async () => {
    render(<StreamBridge />)

    await waitFor(() => expect(MockSource.all[0]).toBeTruthy())
    const source = MockSource.all[0]
    expect(source.url).toBe("/global/event")

    const idle: Array<{ sessionID: string }> = []
    act(() => {
      emitter!.subscribe("session.idle", (event) => idle.push(event.properties))
    })

    push(
      source,
      envelope("message.updated", {
        info: { id: "m1", sessionID: "ses_other", role: "assistant", time: { created: 1 } },
      }),
    )
    push(
      source,
      envelope("message.part.updated", {
        part: { id: "p1", type: "text", sessionID: "ses_other", messageID: "m1", text: "" },
      }),
    )
    push(
      source,
      envelope("message.part.delta", {
        sessionID: "ses_other",
        messageID: "m1",
        partID: "p1",
        field: "text",
        delta: "hello",
      }),
    )

    await waitFor(() => {
      const message = api!.getMessagesBySession("ses_other")[0]
      expect(message?.parts[0]).toMatchObject({ type: "text", text: "hello" })
    })

    push(source, envelope("session.idle", { sessionID: "ses_other" }))

    await waitFor(() => expect(idle).toEqual([{ sessionID: "ses_other" }]))
  })
})
