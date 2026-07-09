import { describe, expect, test } from "bun:test"
import { mergeToolMetadataState } from "../../src/session/tools"

describe("session prompt tool metadata", () => {
  test("metadata updates preserve the original tool start time", () => {
    const first = mergeToolMetadataState(
      { status: "running", input: { command: "bun test" }, time: { start: 1000 } },
      { metadata: { output: "halfway" } },
      { command: "bun test" },
      5000,
    )
    const second = mergeToolMetadataState(first, { metadata: { output: "done" } }, { command: "bun test" }, 9000)

    expect(second.time.start).toBe(1000)
  })

  test("first metadata update initializes pending tool start time once", () => {
    const first = mergeToolMetadataState(
      { status: "pending", input: {}, raw: "" },
      { metadata: { output: "starting" } },
      { command: "bun test" },
      5000,
    )
    const second = mergeToolMetadataState(first, { metadata: { output: "done" } }, { command: "bun test" }, 9000)

    expect(first.time.start).toBe(5000)
    expect(second.time.start).toBe(5000)
  })
})
