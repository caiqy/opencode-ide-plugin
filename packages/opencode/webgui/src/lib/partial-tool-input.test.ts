import { describe, it, expect } from "vitest"
import { parsePartialInput, countLines } from "./partial-tool-input"

describe("parsePartialInput", () => {
  it("returns empty object for empty input", () => {
    expect(parsePartialInput("")).toEqual({})
  })

  it("returns empty object for unparseable head", () => {
    expect(parsePartialInput("not json")).toEqual({})
  })

  it("returns empty object for half-written field name", () => {
    expect(parsePartialInput('{"fil')).toEqual({})
  })

  it("recovers full field when closed", () => {
    expect(parsePartialInput('{"filePath":"/tmp/a.ts"}')).toEqual({ filePath: "/tmp/a.ts" })
  })

  it("recovers partial trailing string", () => {
    const out = parsePartialInput('{"filePath":"/tmp/a.ts","content":"line 1\\nlin')
    expect(out.filePath).toBe("/tmp/a.ts")
    expect(typeof out.content).toBe("string")
    expect((out.content as string).startsWith("line 1\n")).toBe(true)
  })

  it("preserves boolean and number fields", () => {
    expect(parsePartialInput('{"replaceAll":true,"count":42}')).toEqual({ replaceAll: true, count: 42 })
  })

  it("returns empty object on null result", () => {
    expect(parsePartialInput("null")).toEqual({})
  })
})

describe("countLines", () => {
  it("returns 0 for non-string or empty", () => {
    expect(countLines(undefined)).toBe(0)
    expect(countLines(null)).toBe(0)
    expect(countLines(42)).toBe(0)
    expect(countLines("")).toBe(0)
  })

  it("counts lines including trailing newline", () => {
    expect(countLines("a")).toBe(1)
    expect(countLines("a\nb")).toBe(2)
    expect(countLines("a\nb\n")).toBe(3)
    expect(countLines("\n\n\n")).toBe(4)
  })
})
