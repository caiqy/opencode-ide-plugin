import { describe, expect, it } from "vitest"
import { openWithPolicy } from "./tabPolicy"

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
        openTabs: ["s1", "s2", "s3", "s4", "s5", "s6"],
        activeTab: "s3",
      },
      "s7",
    )

    expect(next.openTabs).toEqual(["s2", "s3", "s4", "s5", "s6", "s7"])
    expect(next.activeTab).toBe("s7")
  })

  it("open new over limit evicts oldest non-active even if it was previously active", () => {
    const next = openWithPolicy(
      {
        openTabs: ["s1", "s2", "s3", "s4", "s5", "s6"],
        activeTab: "s1",
      },
      "s7",
    )

    expect(next.openTabs).toEqual(["s2", "s3", "s4", "s5", "s6", "s7"])
    expect(next.activeTab).toBe("s7")
  })

  it("open new from already overflowed state shrinks back to six tabs", () => {
    const next = openWithPolicy(
      {
        openTabs: ["s1", "s2", "s3", "s4", "s5", "s6", "s7"],
        activeTab: "s7",
      },
      "s8",
    )

    expect(next.openTabs).toEqual(["s3", "s4", "s5", "s6", "s7", "s8"])
    expect(next.activeTab).toBe("s8")
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
