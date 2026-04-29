import { describe, expect, test } from "bun:test"
import { SessionPrompt } from "../../src/session/prompt"

type ToolMetadataInput =
  | {
      status: "pending"
      input: Record<string, unknown>
      raw: string
    }
  | {
      status: "running"
      input: Record<string, unknown>
      time: { start: number; end?: number }
    }

function mergeToolMetadataState() {
  const fn = (SessionPrompt as unknown as {
    mergeToolMetadataState?: (
      input: ToolMetadataInput,
      update: { title?: string; metadata?: Record<string, unknown> },
      args: Record<string, unknown>,
      now: number,
    ) => {
      status: "running"
      input: Record<string, unknown>
      time: { start: number; end?: number }
    }
  }).mergeToolMetadataState

  expect(typeof fn).toBe("function")
  return fn
}

describe("session prompt tool metadata", () => {
  test("metadata updates preserve the original tool start time", () => {
    const merge = mergeToolMetadataState()
    if (!merge) return

    const first = merge(
      { status: "running", input: { command: "bun test" }, time: { start: 1000 } },
      { metadata: { output: "halfway" } },
      { command: "bun test" },
      5000,
    )
    const second = merge(first, { metadata: { output: "done" } }, { command: "bun test" }, 9000)

    expect(second.time.start).toBe(1000)
  })

  test("first metadata update initializes pending tool start time once", () => {
    const merge = mergeToolMetadataState()
    if (!merge) return

    const first = merge(
      { status: "pending", input: {}, raw: "" },
      { metadata: { output: "starting" } },
      { command: "bun test" },
      5000,
    )
    const second = merge(first, { metadata: { output: "done" } }, { command: "bun test" }, 9000)

    expect(first.time.start).toBe(5000)
    expect(second.time.start).toBe(5000)
  })
})
