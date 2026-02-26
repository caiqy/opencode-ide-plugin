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
})
