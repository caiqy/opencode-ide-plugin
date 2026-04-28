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

  it("兼容 SDK v2，把 variant 从 user.model.variant 恢复出来", () => {
    const messages: Message[] = [
      {
        info: {
          id: "message-100",
          sessionID: "session-1",
          role: "user",
          time: { created: 100 },
          agent: "build",
          model: {
            providerID: "anthropic",
            modelID: "claude-4-sonnet",
            variant: "high",
          },
        } as Message["info"],
        parts: [],
      },
    ]

    expect(selectionFromMessages(messages)).toEqual({
      providerId: "anthropic",
      modelId: "claude-4-sonnet",
      agent: "build",
      variant: "high",
    })
  })

  it("有 revert 边界时，只从边界之前的 user message 恢复选择", () => {
    const messages: Message[] = [
      createMessage({
        role: "user",
        id: "u1",
        created: 100,
        agent: "plan",
        model: { providerID: "openai", modelID: "gpt-4.1" },
        variant: "low",
      }),
      createMessage({ role: "assistant", id: "a1", created: 150 }),
      createMessage({
        role: "user",
        id: "u2",
        created: 200,
        agent: "build",
        model: { providerID: "anthropic", modelID: "claude-4-sonnet" },
        variant: "high",
      }),
    ]

    expect(selectionFromMessages(messages, { messageID: "u2" })).toEqual({
      providerId: "openai",
      modelId: "gpt-4.1",
      agent: "plan",
      variant: "low",
    })
  })

  it("revert 边界还未扫描到当前页时，不提前用隐藏 user message 恢复选择", () => {
    const messages: Message[] = [
      createMessage({
        role: "user",
        id: "u2",
        created: 200,
        agent: "build",
        model: { providerID: "anthropic", modelID: "claude-4-sonnet" },
        variant: "high",
      }),
    ]

    expect(selectionFromMessages(messages, { messageID: "u1" })).toBeNull()
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
