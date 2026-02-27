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
  globalStateGetJSON,
  globalStateSetJSON,
  resetGlobalStateForTest,
  scopedStateGetJSON,
  scopedStateSetJSON,
  setGlobalStateWriteErrorReporter,
} from "./globalState"

describe("globalState", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-02-26T00:00:00Z"))
    resetGlobalStateForTest()
  })

  it("non-IDE 场景走内存态且可回读", async () => {
    vi.mocked(ideBridge.isInstalled).mockReturnValue(false)

    const write = await globalStateSetJSON("opencode:webgui:kv:v1", { a: 1 })
    const value = await globalStateGetJSON("opencode:webgui:kv:v1", {})

    expect(write.ok).toBe(true)
    expect(value).toEqual({ a: 1 })
  })

  it("host 写失败时按 key+error 节流上报", async () => {
    vi.mocked(ideBridge.isInstalled).mockReturnValue(true)
    vi.mocked(ideBridge.storageSet).mockResolvedValue(false)

    const report = vi.fn()
    setGlobalStateWriteErrorReporter(report)

    await globalStateSetJSON("opencode:webgui:theme:v1", "dark")
    await globalStateSetJSON("opencode:webgui:theme:v1", "light")

    expect(report).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date("2026-02-26T00:00:06Z"))
    await globalStateSetJSON("opencode:webgui:theme:v1", "dark")

    expect(report).toHaveBeenCalledTimes(2)
  })

  it("scoped API 显式支持 global/workspace/mem 且三域均有内存镜像", async () => {
    vi.mocked(ideBridge.isInstalled).mockReturnValue(true)
    vi.mocked(ideBridge.storageGet).mockResolvedValue({
      "opencode:webgui:workspace:tabs:v1": JSON.stringify({ open_tabs: ["s1"], active_tab: "s1" }),
    })

    await scopedStateSetJSON("mem", "opencode:webgui:mem:runtime:v1", { panel: "chat" })
    const tabs = await scopedStateGetJSON("workspace", "opencode:webgui:workspace:tabs:v1", {
      open_tabs: [],
      active_tab: "",
    })

    expect(tabs.active_tab).toBe("s1")
    expect(ideBridge.storageGet).toHaveBeenCalledWith("workspace", ["opencode:webgui:workspace:tabs:v1"])
  })
})
