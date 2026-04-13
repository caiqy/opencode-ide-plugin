import { describe, it, expect } from "vitest"
import { computeTurnMeta, formatDuration } from "./turnMeta"
import type { Message } from "../../types/messages"

function msg(role: "user" | "assistant", id: string, created: number, completed?: number): Message {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = { id, sessionID: "s1", role, time: { created } } as any
  if (role === "assistant") {
    base.time.completed = completed
  }
  return { info: base, parts: [] }
}

describe("computeTurnMeta", () => {
  it("空消息列表返回 undefined", () => {
    const result = computeTurnMeta([])
    expect(result.turnDurationMs).toBeUndefined()
    expect(result.lastAssistantID).toBeUndefined()
  })

  it("只有 user 消息返回 undefined", () => {
    const result = computeTurnMeta([msg("user", "u1", 1000)])
    expect(result.turnDurationMs).toBeUndefined()
    expect(result.lastAssistantID).toBeUndefined()
  })

  it("正常 user → assistant 计算 turn duration", () => {
    const result = computeTurnMeta([msg("user", "u1", 1000), msg("assistant", "a1", 1100, 4000)])
    expect(result.turnDurationMs).toBe(3000)
    expect(result.lastAssistantID).toBe("a1")
  })

  it("多条 assistant 取最晚 completed", () => {
    const result = computeTurnMeta([
      msg("user", "u1", 1000),
      msg("assistant", "a1", 1100, 3000),
      msg("assistant", "a2", 2000, 5000),
    ])
    expect(result.turnDurationMs).toBe(4000)
    expect(result.lastAssistantID).toBe("a2")
  })

  it("assistant 未完成时 turnDurationMs 为 undefined", () => {
    const result = computeTurnMeta([msg("user", "u1", 1000), msg("assistant", "a1", 1100, undefined)])
    expect(result.turnDurationMs).toBeUndefined()
    expect(result.lastAssistantID).toBe("a1")
  })

  it("多轮对话只取最后一轮", () => {
    const result = computeTurnMeta([
      msg("user", "u1", 1000),
      msg("assistant", "a1", 1100, 2000),
      msg("user", "u2", 3000),
      msg("assistant", "a2", 3100, 6000),
    ])
    expect(result.turnDurationMs).toBe(3000)
    expect(result.lastAssistantID).toBe("a2")
  })

  it("消息乱序时仍正确排序计算", () => {
    const result = computeTurnMeta([msg("assistant", "a1", 1100, 4000), msg("user", "u1", 1000)])
    expect(result.turnDurationMs).toBe(3000)
    expect(result.lastAssistantID).toBe("a1")
  })
})

describe("formatDuration", () => {
  it("0 毫秒显示 0s", () => {
    expect(formatDuration(0)).toBe("0s")
  })

  it("短于 60 秒显示秒数", () => {
    expect(formatDuration(23000)).toBe("23s")
  })

  it("60 秒整显示 1m 0s", () => {
    expect(formatDuration(60000)).toBe("1m 0s")
  })

  it("超过 60 秒显示分秒", () => {
    expect(formatDuration(133000)).toBe("2m 13s")
  })

  it("四舍五入到最近秒", () => {
    expect(formatDuration(23400)).toBe("23s")
    expect(formatDuration(23600)).toBe("24s")
  })

  it("负数返回空字符串", () => {
    expect(formatDuration(-1000)).toBe("")
  })
})
