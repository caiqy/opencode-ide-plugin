import { describe, it, expect } from "vitest"
import type { WebguiPart } from "../../state/MessagesContext"
import { sortParts } from "./utils"

function part(type: WebguiPart["type"], id: string): WebguiPart {
  return { type, id } as unknown as WebguiPart
}

describe("sortParts", () => {
  it("按 reasoning → tool → text 排序", () => {
    const input = [
      { part: part("text", "t1") },
      { part: part("reasoning", "r1") },
      { part: part("tool", "x1") },
      { part: part("text", "t2") },
      { part: part("tool", "x2") },
      { part: part("reasoning", "r2") },
    ]

    const result = sortParts(input)

    expect(result.map((item) => item.part.id)).toEqual(["r1", "r2", "x1", "x2", "t1", "t2"])
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

    expect(result.map((item) => item.part.id)).toEqual(["r1", "r2", "x1", "x2", "t1", "t2"])
  })
})
