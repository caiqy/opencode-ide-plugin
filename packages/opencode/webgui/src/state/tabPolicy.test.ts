import { describe, expect, it } from "vitest"
import { openVirtualUnique, openWithPolicy } from "./tabPolicy"

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

  it("openVirtualUnique reuses existing virtual", () => {
    const next = openVirtualUnique(
      {
        openTabs: ["s1", "virtual-temp", "s2"],
        activeTab: "s2",
      },
      "virtual-next",
    )

    expect(next.openTabs).toEqual(["s1", "virtual-temp", "s2"])
    expect(next.activeTab).toBe("virtual-temp")
  })

  it("open first virtual appends and activates", () => {
    const next = openVirtualUnique(
      {
        openTabs: ["s1", "s2"],
        activeTab: "s2",
      },
      "virtual-first",
    )

    expect(next.openTabs).toEqual(["s1", "s2", "virtual-first"])
    expect(next.activeTab).toBe("virtual-first")
  })

  it("openVirtualUnique falls back when id is not virtual", () => {
    const next = openVirtualUnique(
      {
        openTabs: ["virtual-temp", "s1"],
        activeTab: "s1",
      },
      "s2",
    )

    expect(next.openTabs).toEqual(["virtual-temp", "s1", "s2"])
    expect(next.activeTab).toBe("s2")
  })
})
