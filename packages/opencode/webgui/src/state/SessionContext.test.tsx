import { describe, expect, it, vi, beforeEach } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"

vi.mock("../lib/api/sdkClient", () => {
  return {
    sdk: {
      kv: {
        get: vi.fn(),
        update: vi.fn(),
      },
      model: {
        get: vi.fn(),
        update: vi.fn(),
      },
      config: {
        get: vi.fn(),
        providers: vi.fn(),
      },
      session: {
        list: vi.fn(),
        retry: vi.fn(),
        get: vi.fn(),
        diff: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        fork: vi.fn(),
        revert: vi.fn(),
        unrevert: vi.fn(),
        messages: vi.fn(),
      },
    },
  }
})

vi.mock("../lib/ideBridge", () => {
  return {
    ideBridge: {
      isInstalled: vi.fn(),
      request: vi.fn(),
    },
  }
})

vi.mock("../lib/api/events", () => {
  return {
    eventEmitter: {
      on: vi.fn(() => () => {}),
    },
  }
})

import { sdk } from "../lib/api/sdkClient"
import { ideBridge } from "../lib/ideBridge"
import { SessionProvider, useSession } from "./SessionContext"

function wrapper(props: { children: ReactNode }) {
  return <SessionProvider>{props.children}</SessionProvider>
}

describe("SessionContext migration", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    ;(sdk.session.list as any).mockResolvedValue({ data: [], error: null })
    ;(sdk.session.retry as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.config.get as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.config.providers as any).mockResolvedValue({
      data: {
        providers: [
          {
            id: "openai",
            name: "OpenAI",
            models: {
              "gpt-4.1": {
                id: "gpt-4.1",
                name: "GPT 4.1",
                variants: {
                  low: {},
                  medium: {},
                },
                capabilities: { reasoning: true },
              },
            },
          },
          {
            id: "anthropic",
            name: "Anthropic",
            models: {
              "claude-4-sonnet": {
                id: "claude-4-sonnet",
                name: "Claude 4 Sonnet",
                variants: {
                  high: {},
                },
                capabilities: { reasoning: true },
              },
            },
          },
        ],
        default: { provider: "openai", model: "gpt-4.1" },
      },
      error: null,
    })
    ;(sdk.kv.get as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.kv.update as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.model.get as any).mockResolvedValue({ data: { recent: [], favorite: [], variant: {} }, error: null })
    ;(sdk.model.update as any).mockResolvedValue({ data: {}, error: null })
    ;(ideBridge.isInstalled as any).mockReturnValue(false)
    ;(ideBridge.request as any).mockResolvedValue({ ok: true, result: {} })
  })

  it("session context still initializes model and agent from kv/model api", async () => {
    ;(sdk.kv.get as any).mockResolvedValue({
      data: {
        webgui_agent: "plan",
        webgui_provider: "openai",
        webgui_model: "gpt-4.1",
      },
      error: null,
    })

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.selectedAgent).toBe("plan")
      expect(result.current.selectedProviderId).toBe("openai")
      expect(result.current.selectedModelId).toBe("gpt-4.1")
    })
  })

  it("retry still triggers assistant loop call path", async () => {
    ;(sdk.kv.get as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.model.get as any).mockResolvedValue({ data: { recent: [], favorite: [] }, error: null })

    const { result } = renderHook(() => useSession(), { wrapper })

    await act(async () => {
      await result.current.retrySession("s1")
    })

    expect(sdk.session.retry).toHaveBeenCalledWith({
      path: { sessionID: "s1" },
    })
  })

  it("host 记录优先于 kv/model", async () => {
    ;(ideBridge.isInstalled as any).mockReturnValue(true)
    ;(ideBridge.request as any).mockImplementation(async (type: string) => {
      if (type === "storageGet") {
        return {
          ok: true,
          result: {
            opencode_last_selection_v1: JSON.stringify({
              v: 1,
              agent: "build",
              providerId: "anthropic",
              modelId: "claude-4-sonnet",
              variant: "high",
              updatedAt: 123,
            }),
          },
        }
      }
      return { ok: true, result: {} }
    })
    ;(sdk.kv.get as any).mockResolvedValue({
      data: {
        webgui_agent: "plan",
        webgui_provider: "openai",
        webgui_model: "gpt-4.1",
      },
      error: null,
    })
    ;(sdk.model.get as any).mockResolvedValue({
      data: {
        recent: [{ providerID: "openai", modelID: "gpt-4.1" }],
        favorite: [],
        variant: {
          "openai/gpt-4.1": "low",
        },
      },
      error: null,
    })

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.selectedAgent).toBe("build")
      expect(result.current.selectedProviderId).toBe("anthropic")
      expect(result.current.selectedModelId).toBe("claude-4-sonnet")
      expect(result.current.selectedVariant).toBe("high")
    })
  })

  it("host 模型不可用时自动回退到可用模型", async () => {
    ;(ideBridge.isInstalled as any).mockReturnValue(true)
    ;(ideBridge.request as any).mockImplementation(async (type: string) => {
      if (type === "storageGet") {
        return {
          ok: true,
          result: {
            opencode_last_selection_v1: JSON.stringify({
              v: 1,
              agent: "build",
              providerId: "missing-provider",
              modelId: "missing-model",
              variant: "high",
              updatedAt: 123,
            }),
          },
        }
      }
      return { ok: true, result: {} }
    })
    ;(sdk.model.get as any).mockResolvedValue({
      data: {
        recent: [{ providerID: "openai", modelID: "gpt-4.1" }],
        favorite: [],
        variant: {},
      },
      error: null,
    })

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe("openai")
      expect(result.current.selectedModelId).toBe("gpt-4.1")
      expect((result.current as any).selectionRestoreNotice).toContain("已恢复")
    })
  })

  it("host variant 不可用时清空为 undefined", async () => {
    ;(ideBridge.isInstalled as any).mockReturnValue(true)
    ;(ideBridge.request as any).mockImplementation(async (type: string) => {
      if (type === "storageGet") {
        return {
          ok: true,
          result: {
            opencode_last_selection_v1: JSON.stringify({
              v: 1,
              agent: "build",
              providerId: "openai",
              modelId: "gpt-4.1",
              variant: "non-existent-variant",
              updatedAt: 123,
            }),
          },
        }
      }
      return { ok: true, result: {} }
    })

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe("openai")
      expect(result.current.selectedModelId).toBe("gpt-4.1")
      expect(result.current.selectedVariant).toBeUndefined()
    })
  })

  it("变更 agent/model/variant 后会写回 host storage", async () => {
    ;(ideBridge.isInstalled as any).mockReturnValue(true)
    ;(ideBridge.request as any).mockImplementation(async (type: string) => {
      if (type === "storageGet") {
        return { ok: true, result: {} }
      }
      return { ok: true, result: {} }
    })

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.selectedAgent).toBe("build")
    })

    await act(async () => {
      await result.current.setSelectedModel("openai", "gpt-4.1")
    })

    await act(async () => {
      await result.current.setSelectedVariant("medium")
    })

    await waitFor(() => {
      const writes = (ideBridge.request as any).mock.calls.filter((call: any[]) => call[0] === "storageSet")
      expect(writes.length).toBeGreaterThan(0)

      const lastWrite = writes[writes.length - 1]?.[1]
      expect(lastWrite?.key).toBe("opencode_last_selection_v1")

      const payload = JSON.parse(lastWrite?.value || "{}")
      expect(payload.providerId).toBe("openai")
      expect(payload.modelId).toBe("gpt-4.1")
      expect(payload.variant).toBe("medium")
      expect(payload.agent).toBe("build")
    })
  })

  it("restoreSelections 传入 variant: null 时应清空当前 variant，并移除该模型的临时偏好", async () => {
    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe("openai")
      expect(result.current.selectedModelId).toBe("gpt-4.1")
      expect(result.current.selectedVariant).toBeUndefined()
    })

    await act(async () => {
      await result.current.setSelectedVariant("medium")
    })

    await waitFor(() => {
      expect(result.current.selectedVariant).toBe("medium")
    })

    await act(async () => {
      result.current.restoreSelections({
        providerId: "openai",
        modelId: "gpt-4.1",
        agent: "build",
        variant: null,
      })
    })

    await waitFor(() => {
      expect(result.current.selectedVariant).toBeUndefined()
    })

    await act(async () => {
      await result.current.setSelectedModel("anthropic", "claude-4-sonnet")
    })

    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe("anthropic")
      expect(result.current.selectedModelId).toBe("claude-4-sonnet")
    })

    await act(async () => {
      await result.current.setSelectedModel("openai", "gpt-4.1")
    })

    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe("openai")
      expect(result.current.selectedModelId).toBe("gpt-4.1")
      expect(result.current.selectedVariant).toBeUndefined()
    })
  })
})

describe("SessionContext virtual API removed", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    ;(sdk.session.list as any).mockResolvedValue({ data: [], error: null })
    ;(sdk.session.retry as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.config.get as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.config.providers as any).mockResolvedValue({ data: { providers: [] }, error: null })
    ;(sdk.kv.get as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.kv.update as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.model.get as any).mockResolvedValue({ data: { recent: [], favorite: [], variant: {} }, error: null })
    ;(sdk.model.update as any).mockResolvedValue({ data: {}, error: null })
    ;(ideBridge.isInstalled as any).mockReturnValue(false)
    ;(ideBridge.request as any).mockResolvedValue({ ok: true, result: {} })
  })

  it("context does not expose newVirtual", async () => {
    const { result } = renderHook(() => useSession(), { wrapper })
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect((result.current as any).newVirtual).toBeUndefined()
  })

  it("context does not expose materializeSession", async () => {
    const { result } = renderHook(() => useSession(), { wrapper })
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect((result.current as any).materializeSession).toBeUndefined()
  })

  it("context does not expose isVirtualSession", async () => {
    const { result } = renderHook(() => useSession(), { wrapper })
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect((result.current as any).isVirtualSession).toBeUndefined()
  })

  it("currentSession initializes as null", async () => {
    const { result } = renderHook(() => useSession(), { wrapper })
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })
    expect(result.current.currentSession).toBeNull()
  })
})

describe("SessionContext session 状态查询", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    ;(sdk.session.list as any).mockResolvedValue({ data: [], error: null })
    ;(sdk.session.retry as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.config.get as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.config.providers as any).mockResolvedValue({ data: { providers: [] }, error: null })
    ;(sdk.kv.get as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.kv.update as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.model.get as any).mockResolvedValue({ data: { recent: [], favorite: [], variant: {} }, error: null })
    ;(sdk.model.update as any).mockResolvedValue({ data: {}, error: null })
    ;(ideBridge.isInstalled as any).mockReturnValue(false)
    ;(ideBridge.request as any).mockResolvedValue({ ok: true, result: {} })
  })

  it("暴露 isSessionIdle/isSessionReasoning，并可按 session 查询状态", async () => {
    const { result } = renderHook(() => useSession(), { wrapper })
    const ctx = () => result.current as any

    expect(typeof ctx().isSessionIdle).toBe("function")
    expect(typeof ctx().isSessionReasoning).toBe("function")

    if (typeof ctx().isSessionIdle !== "function" || typeof ctx().isSessionReasoning !== "function") return

    expect(ctx().isSessionIdle("missing")).toBe(true)
    expect(ctx().isSessionReasoning("missing")).toBe(false)

    await act(async () => {
      ctx().setSessionIdle("s-child", false)
      ctx().setReasoning("s-child", true)
    })

    await waitFor(() => {
      expect(ctx().isSessionIdle("s-child")).toBe(false)
      expect(ctx().isSessionReasoning("s-child")).toBe(true)
    })
  })
})
