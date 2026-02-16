import { describe, expect, it } from "vitest"
import type { Message } from "../../types/messages"
import { selectionFromMessages } from "./selectionFromMessages"

type MessageFixture =
  | {
      role: "user"
      created: number
      id?: string
      sessionID?: string
      agent: string
      model: {
        providerID: string
        modelID: string
      }
      variant?: string
    }
  | {
      role: "assistant"
      created: number
      id?: string
      sessionID?: string
      variant?: string
    }

function createMessage(info: MessageFixture): Message {
  const userFields = info.role === "user" ? { agent: info.agent, model: info.model } : {}

  return {
    info: {
      id: info.id ?? `message-${info.created}`,
      sessionID: info.sessionID ?? "session-1",
      role: info.role,
      time: { created: info.created },
      ...userFields,
      variant: info.variant,
    } as Message["info"],
    parts: [],
  }
}

describe("selectionFromMessages", () => {
  it("返回最后一条 user message 的 agent/model/variant", () => {
    const messages: Message[] = [
      createMessage({
        role: "user",
        created: 300,
        agent: "build",
        model: { providerID: "anthropic", modelID: "claude-4-sonnet" },
        variant: "high",
      }),
      createMessage({
        role: "assistant",
        created: 500,
      }),
      createMessage({
        role: "user",
        created: 100,
        agent: "plan",
        model: { providerID: "openai", modelID: "gpt-4.1" },
        variant: "low",
      }),
    ]

    expect(selectionFromMessages(messages)).toEqual({
      providerId: "anthropic",
      modelId: "claude-4-sonnet",
      agent: "build",
      variant: "high",
    })
  })

  it("无 user message 时返回 null", () => {
    const messages: Message[] = [
      createMessage({ role: "assistant", created: 100 }),
      createMessage({ role: "assistant", created: 200 }),
    ]

    expect(selectionFromMessages(messages)).toBeNull()
  })

  it("variant 缺失时返回 variant: null", () => {
    const messages: Message[] = [
      createMessage({
        role: "user",
        created: 100,
        agent: "build",
        model: { providerID: "anthropic", modelID: "claude-4-sonnet" },
      }),
    ]

    expect(selectionFromMessages(messages)).toEqual({
      providerId: "anthropic",
      modelId: "claude-4-sonnet",
      agent: "build",
      variant: null,
    })
  })

  it("当 user created 相同时，选择输入顺序更靠后的 user", () => {
    const messages: Message[] = [
      createMessage({
        role: "user",
        created: 100,
        agent: "plan",
        model: { providerID: "openai", modelID: "gpt-4.1" },
        variant: "low",
      }),
      createMessage({ role: "assistant", created: 150 }),
      createMessage({
        role: "user",
        created: 100,
        agent: "build",
        model: { providerID: "anthropic", modelID: "claude-4-sonnet" },
        variant: "high",
      }),
    ]

    expect(selectionFromMessages(messages)).toEqual({
      providerId: "anthropic",
      modelId: "claude-4-sonnet",
      agent: "build",
      variant: "high",
    })
  })
})
