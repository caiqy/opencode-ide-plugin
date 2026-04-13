// packages/opencode/webgui/src/hooks/useProviderStore.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest"
import { renderHook, waitFor } from "@testing-library/react"
import { useProviderStore, _resetProviderCache } from "./useProviderStore"

vi.mock("../lib/api/sdkClient", () => ({
  sdk: {
    config: {
      providers: vi.fn(),
    },
  },
}))

import { sdk } from "../lib/api/sdkClient"

const mockProviders = vi.mocked(sdk.config.providers)

beforeEach(() => {
  _resetProviderCache()
  vi.clearAllMocks()
})

describe("useProviderStore", () => {
  it("加载 provider 后 resolveModelName 返回显示名", async () => {
    mockProviders.mockResolvedValueOnce({
      data: {
        providers: [
          {
            id: "anthropic",
            name: "Anthropic",
            models: {
              "claude-sonnet-4-20250514": { name: "Claude Sonnet 4" },
            },
          },
        ],
        default: {},
      },
      error: null,
    } as any)

    const { result } = renderHook(() => useProviderStore())

    // 初始时缓存为空，fallback 到 modelID
    expect(result.current.resolveModelName("anthropic", "claude-sonnet-4-20250514")).toBe("claude-sonnet-4-20250514")

    // 等待异步加载完成
    await waitFor(() => {
      expect(result.current.resolveModelName("anthropic", "claude-sonnet-4-20250514")).toBe("Claude Sonnet 4")
    })
  })

  it("provider 或 model 不存在时 fallback 到 modelID", async () => {
    mockProviders.mockResolvedValueOnce({
      data: { providers: [], default: {} },
      error: null,
    } as any)

    const { result } = renderHook(() => useProviderStore())

    await waitFor(() => {
      expect(mockProviders).toHaveBeenCalled()
    })

    expect(result.current.resolveModelName("unknown", "unknown-model")).toBe("unknown-model")
  })

  it("SDK 调用失败时静默 fallback", async () => {
    mockProviders.mockRejectedValueOnce(new Error("network error"))

    const { result } = renderHook(() => useProviderStore())

    await waitFor(() => {
      expect(mockProviders).toHaveBeenCalled()
    })

    expect(result.current.resolveModelName("anthropic", "some-model")).toBe("some-model")
  })

  it("多个实例共享缓存，只请求一次", async () => {
    mockProviders.mockResolvedValueOnce({
      data: {
        providers: [
          {
            id: "openai",
            name: "OpenAI",
            models: { "gpt-4o": { name: "GPT-4o" } },
          },
        ],
        default: {},
      },
      error: null,
    } as any)

    const { result: r1 } = renderHook(() => useProviderStore())
    const { result: r2 } = renderHook(() => useProviderStore())

    await waitFor(() => {
      expect(r1.current.resolveModelName("openai", "gpt-4o")).toBe("GPT-4o")
    })

    expect(r2.current.resolveModelName("openai", "gpt-4o")).toBe("GPT-4o")
    expect(mockProviders).toHaveBeenCalledTimes(1)
  })
})
