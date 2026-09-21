import { describe, expect, it, vi, beforeEach } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

vi.mock("../../../lib/api/sdkClient", () => {
  return {
    sdk: {
      global: {
        config: {
          get: vi.fn(),
        },
      },
    },
  }
})

import { sdk } from "../../../lib/api/sdkClient"
import { useSettingsForm } from "./useSettingsForm"
import { saveDefaultApprovalMode } from "../../../state/approval"

describe("useSettingsForm", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    localStorage.clear()
  })

  it("打开设置时加载全局配置", async () => {
    ;((sdk as any).global.config.get as any).mockResolvedValue({
      data: { username: "demo", snapshot: true },
      error: null,
    })

    const { result } = renderHook(() => useSettingsForm(true))

    await waitFor(() => {
      expect(result.current.formData).toEqual({ username: "demo", snapshot: true })
      expect(result.current.originalFormData).toEqual({ username: "demo", snapshot: true })
    })
    expect((sdk as any).global.config.get).toHaveBeenCalledTimes(1)
  })

  it("配置为空时回退为默认空对象", async () => {
    ;((sdk as any).global.config.get as any).mockResolvedValue({ data: null, error: null })

    const { result } = renderHook(() => useSettingsForm(true))

    await waitFor(() => {
      expect(result.current.formData).toEqual({})
      expect(result.current.originalFormData).toEqual({})
    })
  })

  it("重新打开设置时加载已保存的默认审批模式并丢弃未保存草稿", async () => {
    vi.mocked(sdk.global.config.get).mockResolvedValue({ data: {}, error: null })
    await saveDefaultApprovalMode("automatic")
    const { result, rerender } = renderHook(({ open }) => useSettingsForm(open), { initialProps: { open: true } })
    await waitFor(() => expect(result.current.defaultApprovalMode).toBe("automatic"))
    expect(result.current.originalDefaultApprovalMode).toBe("automatic")
    act(() => result.current.setDefaultApprovalMode("full"))
    rerender({ open: false })
    rerender({ open: true })
    await waitFor(() => expect(result.current.defaultApprovalMode).toBe("automatic"))
    expect(result.current.originalDefaultApprovalMode).toBe("automatic")
  })
})
