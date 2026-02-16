import { act, render } from "@testing-library/react"
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
import { MessagesProvider, useMessages } from "./MessagesContext"

let api: ReturnType<typeof useMessages> | null = null

function Capture() {
  api = useMessages()
  return null
}

describe("MessagesContext loadSessionMessages", () => {
  beforeEach(() => {
    mocks.restoreSelections.mockReset()
    mocks.setReasoning.mockReset()
    mocks.setSessionIdle.mockReset()
    ;(sdk.session.messages as any).mockReset()
    api = null
  })

  it("loadSessionMessages 只返回数据且不触发 restoreSelections", async () => {
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
    })

    render(
      <MessagesProvider>
        <Capture />
      </MessagesProvider>,
    )

    let loaded: unknown
    await act(async () => {
      loaded = await api!.loadSessionMessages("s1")
    })

    expect(mocks.restoreSelections).not.toHaveBeenCalled()
    expect(Array.isArray(loaded)).toBe(true)
    expect((loaded as Array<{ info: { id: string } }>).map((msg) => msg.info.id)).toEqual(["u1", "a1", "u2"])
    expect((loaded as Array<unknown>).length).toBe(3)
  })

  it("当接口返回空数组时保留本地 session 消息且不触发 restoreSelections", async () => {
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
      loaded = await api!.loadSessionMessages("s1")
    })

    expect(loaded).toEqual([])
    expect(mocks.restoreSelections).not.toHaveBeenCalled()
    expect(api!.getMessagesBySession("s1").map((msg) => msg.info.id)).toEqual(["local-u1"])
    expect(api!.getMessagesBySession("s1")).toHaveLength(1)
  })
})
