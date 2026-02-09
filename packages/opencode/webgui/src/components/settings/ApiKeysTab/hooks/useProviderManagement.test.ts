import { act, renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("../../../../lib/api/sdkClient", () => ({
  sdk: {
    auth: {
      remove: vi.fn(),
    },
  },
}))

import { sdk } from "../../../../lib/api/sdkClient"
import { useProviderManagement } from "./useProviderManagement"

describe("useProviderManagement", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("移除失败时弹出中文提示", async () => {
    ;(sdk.auth.remove as any).mockRejectedValue(new Error("boom"))
    const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {})

    const { result } = renderHook(() =>
      useProviderManagement({
        configuredProviders: ["openai"],
        setConfiguredProviders: vi.fn(),
        selectedProviderToAdd: "",
        setSelectedProviderToAdd: vi.fn(),
        apiKeys: {},
        setApiKeys: vi.fn(),
        markProvidersDirty: vi.fn(),
      }),
    )

    act(() => {
      result.current.handleDeleteProvider("openai", { stopPropagation: vi.fn() } as any)
    })

    await act(async () => {
      await result.current.confirmDeleteProvider()
    })

    expect(alertSpy).toHaveBeenCalledWith("移除提供方失败")
  })
})
