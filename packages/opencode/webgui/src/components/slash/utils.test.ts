import { describe, expect, test } from "vitest"
import { extractSlashQuery, filterSlashItems, makeSlashInsert } from "./utils"

describe("slash utils", () => {
  test("extractSlashQuery returns null when not starting with slash", () => {
    expect(extractSlashQuery("")).toBe(null)
    expect(extractSlashQuery("hello")).toBe(null)
    expect(extractSlashQuery(" /init")).toBe(null)
  })

  test("extractSlashQuery returns query when slash has no whitespace", () => {
    expect(extractSlashQuery("/")).toBe("")
    expect(extractSlashQuery("/in")).toBe("in")
    expect(extractSlashQuery("/init")).toBe("init")
  })

  test("extractSlashQuery returns null when whitespace exists in token", () => {
    expect(extractSlashQuery("/init ")).toBe(null)
    expect(extractSlashQuery("/init foo")).toBe(null)
  })

  test("makeSlashInsert builds correct insertion text", () => {
    expect(makeSlashInsert({ kind: "command", name: "init" })).toBe("/init ")
    expect(makeSlashInsert({ kind: "skill", name: "brainstorming" })).toBe(
      'Load the "brainstorming" skill and follow its instructions.',
    )
  })

  test("filterSlashItems filters and orders results", () => {
    const items = [
      { id: "c:init", kind: "command" as const, name: "init", description: "create/update AGENTS.md" },
      { id: "c:review", kind: "command" as const, name: "review", description: "review changes" },
      { id: "s:brainstorming", kind: "skill" as const, name: "brainstorming", description: "design" },
    ]

    expect(filterSlashItems(items, "").map((x) => x.id)).toEqual(["c:init", "c:review", "s:brainstorming"])
    expect(filterSlashItems(items, "in").map((x) => x.id)).toEqual(["c:init", "s:brainstorming"])
  })
})
