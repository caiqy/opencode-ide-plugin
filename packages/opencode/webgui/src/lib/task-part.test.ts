import { describe, expect, it } from "vitest"
import type { WebguiToolPart } from "../types/messages"
import { adaptPart } from "./task-part"

describe("adaptPart", () => {
  it("仅对 tool=task 注入 parsed.task_result", () => {
    const part = {
      id: "p1",
      type: "tool",
      tool: "task",
      callID: "c1",
      sessionID: "s1",
      messageID: "m1",
      state: { status: "completed", output: "<task_result>**ok**</task_result>" },
    } as unknown as WebguiToolPart

    const next = adaptPart(part)
    expect(next.parsed?.task_result?.text).toBe("**ok**")
  })

  it("非 task 工具不注入 parsed.task_result", () => {
    const part = {
      id: "p2",
      type: "tool",
      tool: "bash",
      callID: "c2",
      sessionID: "s1",
      messageID: "m1",
      state: { status: "completed", output: "ok" },
    } as unknown as WebguiToolPart

    const next = adaptPart(part)
    expect(next).toEqual(part)
  })

  it("异常 state 时不抛错并返回空解析", () => {
    const part = {
      id: "p3",
      type: "tool",
      tool: "task",
      callID: "c3",
      sessionID: "s1",
      messageID: "m1",
      state: null,
    } as unknown as WebguiToolPart

    expect(() => adaptPart(part)).not.toThrow()
    expect(adaptPart(part).parsed?.task_result?.text).toBe("")
  })
})
