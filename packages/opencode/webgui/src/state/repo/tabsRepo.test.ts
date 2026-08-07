import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../scopedStorage", () => ({
  scopedStateGetJSON: vi.fn(),
  scopedStateSetJSON: vi.fn(),
}))

import { scopedStateGetJSON, scopedStateSetJSON } from "../scopedStorage"
import { loadTabs, saveTabs } from "./tabsRepo"

describe("tabsRepo", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("loadTabs 使用 workspace:tabs 真源", async () => {
    vi.mocked(scopedStateGetJSON).mockResolvedValue({ open_tabs: ["s1"], active_tab: "s1" })
    const tabs = await loadTabs()
    expect(tabs).toEqual({ open_tabs: ["s1"], active_tab: "s1" })
    expect(scopedStateGetJSON).toHaveBeenCalledWith("workspace", "opencode:webgui:workspace:tabs:v1", {
      open_tabs: [],
      active_tab: "",
    })
  })

  it("saveTabs 保存规范化的完整快照", async () => {
    vi.mocked(scopedStateSetJSON).mockResolvedValue({ ok: true })

    await saveTabs({
      open_tabs: ["s1", 1, "s2"],
      active_tab: "missing",
    } as unknown as Parameters<typeof saveTabs>[0])

    expect(scopedStateSetJSON).toHaveBeenCalledWith("workspace", "opencode:webgui:workspace:tabs:v1", {
      open_tabs: ["s1", "s2"],
      active_tab: "s2",
    })
  })
})
