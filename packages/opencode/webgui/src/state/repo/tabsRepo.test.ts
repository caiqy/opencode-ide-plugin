import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../scopedStorage", () => ({
  scopedStateGetJSON: vi.fn(),
  scopedStateSetJSON: vi.fn(),
}))

import { scopedStateGetJSON, scopedStateSetJSON } from "../scopedStorage"
import { activateTab, loadTabs, saveOpenTabs } from "./tabsRepo"

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

  it("activateTab 是 active_tab 更新入口", async () => {
    vi.mocked(scopedStateGetJSON).mockResolvedValue({ open_tabs: ["s1"], active_tab: "s1" })
    vi.mocked(scopedStateSetJSON).mockResolvedValue({ ok: true })

    const next = await activateTab("s2")
    expect(next).toEqual({ open_tabs: ["s1", "s2"], active_tab: "s2" })
    expect(scopedStateSetJSON).toHaveBeenCalledWith("workspace", "opencode:webgui:workspace:tabs:v1", {
      open_tabs: ["s1", "s2"],
      active_tab: "s2",
    })
  })

  it("saveOpenTabs 保留可用 active_tab 并更新 open_tabs", async () => {
    vi.mocked(scopedStateGetJSON).mockResolvedValue({ open_tabs: ["s1", "s2"], active_tab: "s2" })
    vi.mocked(scopedStateSetJSON).mockResolvedValue({ ok: true })

    const next = await saveOpenTabs(["s1", "s2", "s3"])
    expect(next).toEqual({ open_tabs: ["s1", "s2", "s3"], active_tab: "s2" })
    expect(scopedStateSetJSON).toHaveBeenCalledWith("workspace", "opencode:webgui:workspace:tabs:v1", {
      open_tabs: ["s1", "s2", "s3"],
      active_tab: "s2",
    })
  })
})
