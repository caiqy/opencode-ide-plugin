import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/ideBridge", () => ({
  ideBridge: {
    isInstalled: vi.fn(),
    storageGet: vi.fn(),
    storageSet: vi.fn(),
  },
}))

import { ideBridge } from "../lib/ideBridge"
import {
  resetScopedStateForTest,
  scopedStateGetJSON,
  scopedStateSetJSON,
  setScopedStateWriteErrorReporter,
} from "./scopedStorage"

describe("scopedStorage", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-02-26T00:00:00Z"))
    resetScopedStateForTest()
  })

  it("三域 global/workspace/mem 读写与 cache 行为", async () => {
    vi.mocked(ideBridge.isInstalled).mockReturnValue(true)
    vi.mocked(ideBridge.storageGet).mockResolvedValue({
      "opencode:webgui:workspace:tabs:v1": JSON.stringify({ open_tabs: ["s1"], active_tab: "s1" }),
    })

    await scopedStateSetJSON("mem", "opencode:webgui:mem:runtime:v1", { panel: "chat" })
    const tabs = await scopedStateGetJSON("workspace", "opencode:webgui:workspace:tabs:v1", {
      open_tabs: [],
      active_tab: "",
    })
    const mem = await scopedStateGetJSON("mem", "opencode:webgui:mem:runtime:v1", {})

    expect(tabs.active_tab).toBe("s1")
    expect(mem).toEqual({ panel: "chat" })
    expect(ideBridge.storageGet).toHaveBeenCalledWith("workspace", ["opencode:webgui:workspace:tabs:v1"])
  })

  it("host 写失败按 key+error 节流告警", async () => {
    vi.mocked(ideBridge.isInstalled).mockReturnValue(true)
    vi.mocked(ideBridge.storageSet).mockResolvedValue(false)

    const report = vi.fn()
    setScopedStateWriteErrorReporter(report)

    await scopedStateSetJSON("global", "opencode:webgui:global:theme:v1", "dark")
    await scopedStateSetJSON("global", "opencode:webgui:global:theme:v1", "light")
    expect(report).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date("2026-02-26T00:00:06Z"))
    await scopedStateSetJSON("global", "opencode:webgui:global:theme:v1", "dark")
    expect(report).toHaveBeenCalledTimes(2)
  })

  it("JSON 解析失败返回 fallback", async () => {
    vi.mocked(ideBridge.isInstalled).mockReturnValue(true)
    vi.mocked(ideBridge.storageGet).mockResolvedValue({
      "opencode:webgui:workspace:last_selection:v1": "{bad-json",
    })

    const value = await scopedStateGetJSON("workspace", "opencode:webgui:workspace:last_selection:v1", {
      agent: "build",
    })

    expect(value).toEqual({ agent: "build" })
  })
})
