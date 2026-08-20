import { describe, it, expect } from "vitest"
import type { WebguiPart } from "../../state/MessagesContext"
import { mergeReasoningParts, sortParts } from "./utils"

function part(type: WebguiPart["type"], id: string): WebguiPart {
  return { type, id } as unknown as WebguiPart
}

describe("sortParts", () => {
  it("按 reasoning → text → tool 排序", () => {
    const input = [
      { part: part("text", "t1") },
      { part: part("reasoning", "r1") },
      { part: part("tool", "x1") },
      { part: part("text", "t2") },
      { part: part("tool", "x2") },
      { part: part("reasoning", "r2") },
    ]

    const result = sortParts(input)

    expect(result.map((item) => item.part.id)).toEqual(["r1", "r2", "t1", "t2", "x1", "x2"])
  })

  it("同类型保持原始相对顺序", () => {
    const input = [
      { part: part("text", "t1") },
      { part: part("reasoning", "r1") },
      { part: part("tool", "x1") },
      { part: part("reasoning", "r2") },
      { part: part("tool", "x2") },
      { part: part("text", "t2") },
    ]

    const result = sortParts(input)

    expect(result.map((item) => item.part.id)).toEqual(["r1", "r2", "t1", "t2", "x1", "x2"])
  })
})

describe("mergeReasoningParts", () => {
  it("合并同一条消息中的思考片段并覆盖完整时间范围", () => {
    const parts = [
      { id: "r1", type: "reasoning" as const, text: "先分析", time: { start: 100, end: 200 } },
      { id: "r2", type: "reasoning" as const, text: "再验证", time: { start: 220, end: 500 } },
    ] as WebguiPart[]

    expect(mergeReasoningParts(parts)).toEqual([
      { ...parts[0], text: "先分析\n\n再验证", time: { start: 100, end: 500 } },
    ])
  })

  it("只要有片段仍在流式输出就不标记合并结果为完成", () => {
    const parts = [
      { id: "r1", type: "reasoning" as const, text: "已完成", time: { start: 100, end: 200 } },
      { id: "r2", type: "reasoning" as const, text: "进行中", time: { start: 220 } },
    ] as WebguiPart[]

    expect(mergeReasoningParts(parts)[0]).toMatchObject({ text: "已完成\n\n进行中", time: { start: 100 } })
    expect(mergeReasoningParts(parts)[0]).not.toHaveProperty("time.end")
  })
})
