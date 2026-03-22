import { describe, expect, it } from "vitest"
import { renderHook } from "@testing-library/react"
import type { Message } from "../../../state/MessagesContext"
import { useHistoryBlocks } from "./useHistoryBlocks"

function msg(id: string, created: number, opts?: { summary?: boolean; tool?: string }): Message {
  return {
    info: {
      id,
      sessionID: "s1",
      role: "assistant",
      time: { created },
      summary: opts?.summary ?? false,
    } as Message["info"],
    parts: opts?.tool
      ? [
          {
            id: `${id}-tool`,
            type: "tool",
            tool: "glob",
            callID: opts.tool,
            state: { status: "pending" },
          } as Message["parts"][number],
        ]
      : [],
  }
}

describe("useHistoryBlocks", () => {
  it("把 summary 留在 history，把带 permission 的最新消息与尾部交互留在 tail", () => {
    const { result } = renderHook(() =>
      useHistoryBlocks({
        sessionID: "s1",
        messages: [msg("m1", 1, { summary: true }), msg("m2", 2, { tool: "c1" })],
        questions: [{ id: "q1" }] as never[],
        permissions: [
          {
            sessionID: "s1",
            tool: { messageID: "m2", callID: "c1" },
          },
        ],
        isTyping: true,
      }),
    )

    expect(result.current.history.map((item) => item.id)).toEqual(["m1"])
    expect(result.current.tail.map((item) => item.id)).toEqual(["m2", "question:q1", "typing:s1"])
    const item = result.current.tail.find((item) => item.id === "m2")
    expect(item?.kind).toBe("tail-message")
    expect(item && "reason" in item ? item.reason : undefined).toBe("permission")
  })

  it("当较早消息被 pin 时，tail 保留该消息之后的原始顺序", () => {
    const { result } = renderHook(() =>
      useHistoryBlocks({
        sessionID: "s1",
        messages: [msg("m1", 1), msg("m2", 2, { tool: "c1" }), msg("m3", 3)],
        questions: [] as never[],
        permissions: [
          {
            sessionID: "s1",
            tool: { messageID: "m2", callID: "c1" },
          },
        ],
        isTyping: false,
      }),
    )

    expect(result.current.history.map((item) => item.id)).toEqual(["m1"])
    expect(result.current.tail.map((item) => item.id)).toEqual(["m2", "m3"])
  })

  it("即使没有 question/typing/permission，最后一条消息也保留在 tail", () => {
    const { result } = renderHook(() =>
      useHistoryBlocks({
        sessionID: "s1",
        messages: [msg("m1", 1), msg("m2", 2), msg("m3", 3)],
        questions: [] as never[],
        permissions: [],
        isTyping: false,
      }),
    )

    expect(result.current.history.map((item) => item.id)).toEqual(["m1", "m2"])
    expect(result.current.tail.map((item) => item.id)).toEqual(["m3"])
  })

  it("summary 消息以稳定的 history-summary kind 暴露", () => {
    const { result } = renderHook(() =>
      useHistoryBlocks({
        sessionID: "s1",
        messages: [msg("m1", 1, { summary: true }), msg("m2", 2)],
        questions: [] as never[],
        permissions: [],
        isTyping: false,
      }),
    )

    expect(result.current.history[0]?.kind).toBe("history-summary")
    expect(result.current.tail[0]?.id).toBe("m2")
  })
})
