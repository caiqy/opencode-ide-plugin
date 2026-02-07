import { describe, expect, it, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"

vi.mock("../../../../lib/api/sdkClient", () => {
  return {
    sdk: {
      auth: {
        methods: vi.fn(),
      },
    },
  }
})

import { sdk } from "../../../../lib/api/sdkClient"
import { useApiKeys } from "./useApiKeys"

describe("useApiKeys migration", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("methods(providerId) uses mapped provider.auth result", async () => {
    ;(sdk.auth.methods as any).mockResolvedValue([{ label: "OAuth", type: "oauth" }])

    const providers = [{ id: "openai", name: "OpenAI", source: {}, options: {}, models: {} }] as any
    const { result } = renderHook(() => useApiKeys(providers))

    await waitFor(() => {
      expect(result.current.methods.openai).toEqual([{ label: "OAuth", type: "oauth" }])
    })
  })

  it("does not refetch when provider has empty methods", async () => {
    ;(sdk.auth.methods as any).mockResolvedValue([])

    const providers = [{ id: "openai", name: "OpenAI", source: {}, options: {}, models: {} }] as any
    const { rerender } = renderHook(({ list }) => useApiKeys(list), {
      initialProps: { list: providers },
    })

    await waitFor(() => {
      expect(sdk.auth.methods).toHaveBeenCalledTimes(1)
    })

    rerender({ list: providers })

    await waitFor(() => {
      expect(sdk.auth.methods).toHaveBeenCalledTimes(1)
    })
  })
})
