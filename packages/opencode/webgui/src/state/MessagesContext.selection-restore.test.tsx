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
  })

  it("打开历史会话时应自动恢复该会话最后一次 user 的 agent/model/variant", async () => {
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
            providerID: "openai",
            modelID: "gpt-4.1",
            agent: "build",
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            parentID: "u1",
            mode: "",
            path: { cwd: "", root: "" },
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

    await act(async () => {
      await api!.loadSessionMessages("s1")
    })

    expect(mocks.restoreSelections).toHaveBeenCalledWith({
      providerId: "anthropic",
      modelId: "claude-4-sonnet",
      agent: "plan",
      variant: "high",
    })
  })
})
