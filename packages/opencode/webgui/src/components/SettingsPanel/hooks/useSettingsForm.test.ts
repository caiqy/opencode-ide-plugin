import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"

vi.mock("../../../lib/api/sdkClient", () => {
  return {
    sdk: {
      config: {
        get: vi.fn(),
        providers: vi.fn(),
      },
      auth: {
        list: vi.fn(),
      },
    },
  }
})

import { sdk } from "../../../lib/api/sdkClient"
import { useSettingsForm } from "./useSettingsForm"

describe("useSettingsForm migration", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("settings form loads providers from provider.list all[]", async () => {
    ;(sdk.config.get as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.config.providers as any).mockResolvedValue({
      data: {
        providers: [
          { id: "zeta", name: "Zeta", models: {}, source: {}, options: {} },
          { id: "alpha", name: "Alpha", models: {}, source: {}, options: {} },
        ],
        default: {},
      },
      error: null,
    })
    ;(sdk.auth.list as any).mockResolvedValue({ alpha: true })

    const { result } = renderHook(() => useSettingsForm(true))

    await waitFor(() => {
      expect(result.current.providers.map((item) => item.id)).toEqual(["alpha", "zeta"])
    })
  })

  it("configuredProviders derived from connected[] compatibility mapping", async () => {
    ;(sdk.config.get as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.config.providers as any).mockResolvedValue({
      data: { providers: [], default: {} },
      error: null,
    })
    ;(sdk.auth.list as any).mockResolvedValue({ openai: true, anthropic: true })

    const { result } = renderHook(() => useSettingsForm(true))

    await waitFor(() => {
      expect(result.current.configuredProviders.sort()).toEqual(["anthropic", "openai"])
    })
  })
})
