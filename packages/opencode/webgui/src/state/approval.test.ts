import { beforeEach, describe, expect, it, vi } from "vitest"
import { ideBridge } from "../lib/ideBridge"
import { loadDefaultApprovalMode, saveDefaultApprovalMode } from "./approval"

vi.mock("../lib/ideBridge", () => ({
  ideBridge: { isInstalled: vi.fn(), storageGet: vi.fn(), storageSet: vi.fn() },
}))

describe("默认审批模式", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
  })

  it("未配置及无效值均使用手动审批", async () => {
    expect(await loadDefaultApprovalMode()).toBe("manual")
    localStorage.setItem("commonSettings.defaultApprovalMode", "invalid")
    expect(await loadDefaultApprovalMode()).toBe("manual")
  })

  it.each(["manual", "automatic", "full"] as const)("浏览器持久化 %s", async (mode) => {
    expect(await saveDefaultApprovalMode(mode)).toBe(true)
    expect(await loadDefaultApprovalMode()).toBe(mode)
  })

  it("IDE 保存失败后仍读取原来的模式", async () => {
    vi.mocked(ideBridge.isInstalled).mockReturnValue(true)
    vi.mocked(ideBridge.storageGet).mockResolvedValue({ "commonSettings.defaultApprovalMode": "manual" })
    vi.mocked(ideBridge.storageSet).mockResolvedValue(false)
    expect(await saveDefaultApprovalMode("full")).toBe(false)
    expect(await loadDefaultApprovalMode()).toBe("manual")
    expect(ideBridge.storageSet).toHaveBeenCalledWith("global", "commonSettings.defaultApprovalMode", "full")
    expect(localStorage.getItem("commonSettings.defaultApprovalMode")).toBeNull()
  })
})
