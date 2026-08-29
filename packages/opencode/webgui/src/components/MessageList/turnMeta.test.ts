import { describe, it, expect } from "vitest"
import { computeAllTurnMetas, formatDuration } from "./turnMeta"
import type { Message } from "../../types/messages"

function msg(role: "user" | "assistant", id: string, created: number, completed?: number): Message {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const base = { id, sessionID: "s1", role, time: { created } } as any
  if (role === "assistant") {
    base.time.completed = completed
  }
  return { info: base, parts: [] }
}

describe("computeAllTurnMetas", () => {
  it("空消息列表，任何 ID 查询返回 undefined", () => {
    const map = computeAllTurnMetas([])
    expect(map.get("anything")).toBeUndefined()
  })

  it("只有 user 消息，无 turn meta", () => {
    const map = computeAllTurnMetas([msg("user", "u1", 1000)])
    expect(map.get("u1")).toBeUndefined()
  })

  it("单轮 user → assistant", () => {
    const map = computeAllTurnMetas([msg("user", "u1", 1000), msg("assistant", "a1", 1100, 4000)])
    const meta = map.get("a1")
    expect(meta?.turnDurationMs).toBe(3000) // 4000 - 1000
    expect(meta?.lastAssistantID).toBe("a1")
  })

  it("单轮多条 assistant 取最晚 completed，仅最后一条 assistant 有 meta", () => {
    const map = computeAllTurnMetas([
      msg("user", "u1", 1000),
      msg("assistant", "a1", 1100, 3000),
      msg("assistant", "a2", 2000, 5000),
    ])
    // a1 不是该 turn 的最后一条 assistant，不应有 meta
    expect(map.get("a1")).toBeUndefined()
    // a2 是最后一条
    const meta = map.get("a2")
    expect(meta?.turnDurationMs).toBe(4000) // 5000 - 1000
    expect(meta?.lastAssistantID).toBe("a2")
  })

  it("assistant 未完成时 turnDurationMs 为 undefined", () => {
    const map = computeAllTurnMetas([msg("user", "u1", 1000), msg("assistant", "a1", 1100, undefined)])
    const meta = map.get("a1")
    expect(meta?.turnDurationMs).toBeUndefined()
    expect(meta?.lastAssistantID).toBe("a1")
  })

  it("中断恢复时用最后可见 part 时间补齐 turn duration", () => {
    const messages = [msg("user", "u1", 1000), msg("assistant", "a1", 1100, undefined)]
    messages[1].parts = [
      {
        id: "p1",
        type: "tool",
        tool: "bash",
        time: { start: 8000, end: 9000 },
        state: { status: "running", input: {}, time: { start: 7000 } },
      } as never,
    ]

    expect(computeAllTurnMetas(messages, true).get("a1")?.turnDurationMs).toBe(8000)
  })

  it("多轮对话每个 turn 都有独立 meta", () => {
    const map = computeAllTurnMetas([
      msg("user", "u1", 1000),
      msg("assistant", "a1", 1100, 2000),
      msg("user", "u2", 3000),
      msg("assistant", "a2", 3100, 6000),
    ])
    // 第一轮
    const meta1 = map.get("a1")
    expect(meta1?.turnDurationMs).toBe(1000) // 2000 - 1000
    expect(meta1?.lastAssistantID).toBe("a1")
    // 第二轮
    const meta2 = map.get("a2")
    expect(meta2?.turnDurationMs).toBe(3000) // 6000 - 3000
    expect(meta2?.lastAssistantID).toBe("a2")
  })

  it("三轮对话，中间一轮 assistant 未完成", () => {
    const map = computeAllTurnMetas([
      msg("user", "u1", 1000),
      msg("assistant", "a1", 1100, 2000),
      msg("user", "u2", 3000),
      msg("assistant", "a2", 3100, undefined),
      msg("user", "u3", 5000),
      msg("assistant", "a3", 5100, 8000),
    ])
    expect(map.get("a1")?.turnDurationMs).toBe(1000)
    expect(map.get("a2")?.turnDurationMs).toBeUndefined()
    expect(map.get("a3")?.turnDurationMs).toBe(3000) // 8000 - 5000
  })

  it("消息乱序时仍正确排序计算", () => {
    const map = computeAllTurnMetas([msg("assistant", "a1", 1100, 4000), msg("user", "u1", 1000)])
    const meta = map.get("a1")
    expect(meta?.turnDurationMs).toBe(3000)
  })

  it("user 前的孤立 assistant 消息被忽略", () => {
    const map = computeAllTurnMetas([
      msg("assistant", "a0", 500, 800),
      msg("user", "u1", 1000),
      msg("assistant", "a1", 1100, 2000),
    ])
    expect(map.get("a0")).toBeUndefined()
    expect(map.get("a1")?.turnDurationMs).toBe(1000)
  })
})

describe("formatDuration", () => {
  it("0 毫秒显示中文秒数", () => {
    expect(formatDuration(0)).toBe("0 秒")
  })

  it("短于 60 秒显示秒数", () => {
    expect(formatDuration(23000)).toBe("23 秒")
  })

  it("60 秒整显示 1 分 00 秒", () => {
    expect(formatDuration(60000)).toBe("1 分 00 秒")
  })

  it("超过 60 秒显示分秒", () => {
    expect(formatDuration(133000)).toBe("2 分 13 秒")
  })

  it("四舍五入到最近秒", () => {
    expect(formatDuration(23400)).toBe("23 秒")
    expect(formatDuration(23600)).toBe("24 秒")
  })

  it("负数返回空字符串", () => {
    expect(formatDuration(-1000)).toBe("")
  })
})
