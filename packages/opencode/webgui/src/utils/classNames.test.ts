import { describe, it, expect } from "vitest"
import { cn } from "./classNames"

describe("cn (classNames utility)", () => {
  it("merges string classnames", () => {
    expect(cn("foo", "bar")).toBe("foo bar")
  })

  it("filters out falsy values", () => {
    expect(cn("foo", false, "bar", null, undefined, "baz")).toBe("foo bar baz")
  })

  it("handles conditional classes with objects", () => {
    expect(cn({ foo: true, bar: false, baz: true })).toBe("foo baz")
  })

  it("handles arrays of classes", () => {
    expect(cn(["foo", "bar"], "baz")).toBe("foo bar baz")
  })

  it("handles nested arrays", () => {
    expect(cn(["foo", ["bar", "baz"]])).toBe("foo bar baz")
  })

  it("handles mixed types", () => {
    expect(cn("foo", { bar: true, qux: false }, ["baz"], null, "quux")).toBe("foo bar baz quux")
  })

  it("handles empty input", () => {
    expect(cn()).toBe("")
  })

  it("handles only falsy values", () => {
    expect(cn(false, null, undefined, 0, "")).toBe("")
  })

  it("trims and deduplicates classes", () => {
    expect(cn("  foo  ", "bar", "foo")).toBe("foo bar")
  })

  it("handles numbers as truthy", () => {
    expect(cn(1, 2, 3)).toBe("1 2 3")
  })

  it("handles empty strings", () => {
    expect(cn("", "foo", "")).toBe("foo")
  })

  it("handles complex nested structures", () => {
    expect(
      cn(
        "base",
        {
          active: true,
          disabled: false,
        },
        ["foo", { bar: true }],
        undefined,
        "final",
      ),
    ).toBe("base active foo bar final")
  })
})
