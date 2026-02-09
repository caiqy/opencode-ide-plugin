import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

vi.mock("../../../../lib/api/sdkClient", () => {
  return {
    sdk: {
      auth: {
        start: vi.fn(),
        submit: vi.fn(),
      },
    },
  }
})

vi.mock("../../../../lib/ideBridge", () => {
  return {
    ideBridge: {
      isInstalled: vi.fn(),
      send: vi.fn(),
    },
  }
})

import { sdk } from "../../../../lib/api/sdkClient"
import { ideBridge } from "../../../../lib/ideBridge"
import { useOAuthFlow } from "./useOAuthFlow"

describe("useOAuthFlow migration", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    ;(ideBridge.isInstalled as any).mockReturnValue(false)
    vi.spyOn(window, "open").mockImplementation(() => null)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("auto oauth flow completes without polling", async () => {
    const setConfiguredProviders = vi.fn()
    const setSelectedProviderToAdd = vi.fn()
    const markProvidersDirty = vi.fn()
    ;(sdk.auth.start as any).mockResolvedValue({
      id: "flow-auto",
      url: "https://auth.example.com",
      method: "auto",
    })
    ;(sdk.auth.submit as any).mockResolvedValue(true)
    const interval = vi.spyOn(globalThis, "setInterval")

    const { result } = renderHook(() =>
      useOAuthFlow({
        configuredProviders: [],
        setConfiguredProviders,
        selectedProviderToAdd: "openai",
        setSelectedProviderToAdd,
        markProvidersDirty,
      }),
    )

    await act(async () => {
      await result.current.handleOAuthLogin("openai", 0)
    })

    expect(interval).not.toHaveBeenCalled()
    expect(sdk.auth.submit).toHaveBeenCalledWith("flow-auto", "")
    expect(result.current.authStatus.openai).toBe("已连接！")
    expect(setConfiguredProviders).toHaveBeenCalledWith(["openai"])
    expect(setSelectedProviderToAdd).toHaveBeenCalledWith("")
    expect(markProvidersDirty).toHaveBeenCalled()
  })

  it("code oauth flow submits code via callback", async () => {
    const setConfiguredProviders = vi.fn()
    const setSelectedProviderToAdd = vi.fn()
    const markProvidersDirty = vi.fn()
    ;(sdk.auth.start as any).mockResolvedValue({
      id: "flow-code",
      method: "code",
      instructions: "Paste code",
    })
    ;(sdk.auth.submit as any).mockResolvedValue(true)

    const { result } = renderHook(() =>
      useOAuthFlow({
        configuredProviders: [],
        setConfiguredProviders,
        selectedProviderToAdd: "openai",
        setSelectedProviderToAdd,
        markProvidersDirty,
      }),
    )

    await act(async () => {
      await result.current.handleOAuthLogin("openai", 0)
    })

    expect(result.current.manualCodeState?.providerId).toBe("openai")
    expect(result.current.authStatus.openai).toBe("等待输入授权码…")

    act(() => {
      result.current.setManualCodeInput("abc123")
    })

    await act(async () => {
      await result.current.handleManualCodeSubmit()
    })

    await waitFor(() => {
      expect(sdk.auth.submit).toHaveBeenCalledWith("flow-code", "abc123")
    })
    expect(result.current.authStatus.openai).toBe("已连接！")
  })
})
