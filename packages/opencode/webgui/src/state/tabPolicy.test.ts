import { describe, expect, it } from "vitest"
import { MAX_OPEN_TABS, openWithPolicy } from "./tabPolicy"

const ids = (count: number) => Array.from({ length: count }, (_, i) => `s${i + 1}`)

describe("tabPolicy", () => {
  it("open existing activates without reordering", () => {
    const next = openWithPolicy(
      {
        openTabs: ["s1", "s2", "s3"],
        activeTab: "s3",
      },
      "s1",
    )

    expect(next.openTabs).toEqual(["s1", "s2", "s3"])
    expect(next.activeTab).toBe("s1")
  })

  it("open new over limit evicts oldest non-active", () => {
    const next = openWithPolicy(
      {
        openTabs: ids(MAX_OPEN_TABS),
        activeTab: "s3",
      },
      `s${MAX_OPEN_TABS + 1}`,
    )

    expect(next.openTabs).toEqual(ids(MAX_OPEN_TABS + 1).slice(1))
    expect(next.activeTab).toBe(`s${MAX_OPEN_TABS + 1}`)
  })

  it("open new over limit evicts oldest non-active even if it was previously active", () => {
    const next = openWithPolicy(
      {
        openTabs: ids(MAX_OPEN_TABS),
        activeTab: "s1",
      },
      `s${MAX_OPEN_TABS + 1}`,
    )

    expect(next.openTabs).toEqual(ids(MAX_OPEN_TABS + 1).slice(1))
    expect(next.activeTab).toBe(`s${MAX_OPEN_TABS + 1}`)
  })

  it("open new from already overflowed state shrinks back to the cap", () => {
    const next = openWithPolicy(
      {
        openTabs: ids(MAX_OPEN_TABS + 1),
        activeTab: `s${MAX_OPEN_TABS + 1}`,
      },
      `s${MAX_OPEN_TABS + 2}`,
    )

    expect(next.openTabs).toEqual(ids(MAX_OPEN_TABS + 2).slice(2))
    expect(next.activeTab).toBe(`s${MAX_OPEN_TABS + 2}`)
  })

  it("opens prefixed ids as normal tabs", () => {
    const next = openWithPolicy(
      {
        openTabs: ["s1", "virtual-temp"],
        activeTab: "virtual-temp",
      },
      "virtual-next",
    )

    expect(next.openTabs).toEqual(["s1", "virtual-temp", "virtual-next"])
    expect(next.activeTab).toBe("virtual-next")
  })
})
