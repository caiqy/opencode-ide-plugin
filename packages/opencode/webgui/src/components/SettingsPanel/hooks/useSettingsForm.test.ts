import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"

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

describe("useSettingsForm", () => {
  beforeEach(() => {
    vi.resetAllMocks()
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
})
