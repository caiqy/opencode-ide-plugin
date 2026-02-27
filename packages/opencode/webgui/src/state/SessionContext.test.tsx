import { describe, expect, it, vi, beforeEach } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"

const events = vi.hoisted(() => {
  const handlers = new Map<string, Set<(event: any) => void>>()

  const on = (type: string, fn: (event: any) => void) => {
    const set = handlers.get(type) ?? new Set<(event: any) => void>()
    set.add(fn)
    handlers.set(type, set)
    return () => {
      set.delete(fn)
      if (set.size === 0) {
        handlers.delete(type)
      }
    }
  }

  const emit = (type: string, event: any) => {
    handlers.get(type)?.forEach((fn) => fn(event))
  }

  const reset = () => {
    handlers.clear()
  }

  return { on, emit, reset }
})

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
      storageGet: vi.fn(),
      storageSet: vi.fn(),
    },
  }
})

vi.mock("../lib/api/events", () => {
  return {
    eventEmitter: {
      on: events.on,
    },
  }
})

import { sdk } from "../lib/api/sdkClient"
import { ideBridge } from "../lib/ideBridge"
import { resetScopedStateForTest, scopedStateGetJSON, scopedStateSetJSON } from "./scopedStorage"
import { SessionProvider, useSession } from "./SessionContext"

const selectionKey = "opencode:webgui:workspace:last_selection:v1"
const draftsKey = "opencode:webgui:workspace:drafts:v1"
const draftSessionKey = "opencode:webgui:workspace:draft_session:v1"

function wrapper(props: { children: ReactNode }) {
  return <SessionProvider>{props.children}</SessionProvider>
}

describe("SessionContext migration", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    events.reset()
    resetScopedStateForTest()
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
    ;(ideBridge.isInstalled as any).mockReturnValue(false)
    ;(ideBridge.storageGet as any).mockResolvedValue({})
    ;(ideBridge.storageSet as any).mockResolvedValue(true)
  })

  it("session context initializes model and agent from workspace/global repos", async () => {
    ;(ideBridge.isInstalled as any).mockReturnValue(true)
    ;(ideBridge.storageGet as any).mockImplementation(async (scope: string) => {
      if (scope === "workspace") {
        return {
          [selectionKey]: JSON.stringify({
            agent: "plan",
            provider_id: "openai",
            model_id: "gpt-4.1",
            variant: null,
            agent_model_map: {},
            updated_at: 1,
          }),
        }
      }
      return {}
    })

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.selectedAgent).toBe("plan")
      expect(result.current.selectedProviderId).toBe("openai")
      expect(result.current.selectedModelId).toBe("gpt-4.1")
    })
  })

  it("retry still triggers assistant loop call path", async () => {
    const { result } = renderHook(() => useSession(), { wrapper })

    await act(async () => {
      await result.current.retrySession("s1")
    })

    expect(sdk.session.retry).toHaveBeenCalledWith({
      path: { sessionID: "s1" },
    })
  })

  it("setSelectedModel/setSelectedAgent 不再读取或写入 opencode_selected_*", async () => {
    const getSpy = vi.spyOn(Storage.prototype, "getItem")
    const setSpy = vi.spyOn(Storage.prototype, "setItem")

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.selectedAgent).toBe("build")
    })

    await act(async () => {
      await result.current.setSelectedModel("openai", "gpt-4.1")
      await result.current.setSelectedAgent("plan")
    })

    expect(getSpy).not.toHaveBeenCalledWith("opencode_selected_provider")
    expect(getSpy).not.toHaveBeenCalledWith("opencode_selected_model")
    expect(getSpy).not.toHaveBeenCalledWith("opencode_selected_agent")
    expect(setSpy).not.toHaveBeenCalled()
  })

  it("恢复优先级: workspace:last_selection > global:model.recent > config.model > providers 首个可用", async () => {
    ;(ideBridge.isInstalled as any).mockReturnValue(true)
    ;(sdk.config.get as any).mockResolvedValue({ data: { model: "openai/gpt-4.1" }, error: null })
    ;(ideBridge.storageGet as any).mockImplementation(async (scope: string) => {
      if (scope === "workspace") {
        return {
          [selectionKey]: JSON.stringify({
            agent: "build",
            provider_id: "anthropic",
            model_id: "claude-4-sonnet",
            variant: "high",
            updated_at: 123,
            agent_model_map: {},
          }),
        }
      }
      if (scope === "global") {
        return {
          "opencode:webgui:global:model:v1": JSON.stringify({
            recent: [{ providerID: "openai", modelID: "gpt-4.1" }],
            favorite: [],
          }),
        }
      }
      return {}
    })

    const first = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(first.result.current.selectedAgent).toBe("build")
      expect(first.result.current.selectedProviderId).toBe("anthropic")
      expect(first.result.current.selectedModelId).toBe("claude-4-sonnet")
      expect(first.result.current.selectedVariant).toBe("high")
    })
    first.unmount()
    ;(ideBridge.storageGet as any).mockImplementation(async (scope: string) => {
      if (scope === "workspace") {
        return {
          [selectionKey]: JSON.stringify({
            agent: "build",
            provider_id: null,
            model_id: null,
            variant: null,
            updated_at: 123,
            agent_model_map: {},
          }),
        }
      }
      if (scope === "global") {
        return {
          "opencode:webgui:global:model:v1": JSON.stringify({
            recent: [{ providerID: "openai", modelID: "gpt-4.1" }],
            favorite: [],
          }),
        }
      }
      return {}
    })

    const recentOnly = renderHook(() => useSession(), { wrapper })
    await waitFor(() => {
      expect(recentOnly.result.current.selectedProviderId).toBe("openai")
      expect(recentOnly.result.current.selectedModelId).toBe("gpt-4.1")
    })
    recentOnly.unmount()
    ;(ideBridge.storageGet as any).mockImplementation(async (scope: string) => {
      if (scope === "workspace") {
        return {
          [selectionKey]: JSON.stringify({
            agent: "build",
            provider_id: null,
            model_id: null,
            variant: null,
            updated_at: 123,
            agent_model_map: {},
          }),
        }
      }
      if (scope === "global") {
        return {
          "opencode:webgui:global:model:v1": JSON.stringify({
            recent: [],
            favorite: [],
          }),
        }
      }
      return {}
    })

    const configOnly = renderHook(() => useSession(), { wrapper })
    await waitFor(() => {
      expect(configOnly.result.current.selectedProviderId).toBe("openai")
      expect(configOnly.result.current.selectedModelId).toBe("gpt-4.1")
    })
    configOnly.unmount()
    ;(sdk.config.get as any).mockResolvedValue({ data: { model: "missing/not-found" }, error: null })
    ;(ideBridge.storageGet as any).mockImplementation(async (scope: string) => {
      if (scope === "workspace") {
        return {
          [selectionKey]: JSON.stringify({
            agent: "build",
            provider_id: null,
            model_id: null,
            variant: null,
            updated_at: 123,
            agent_model_map: {},
          }),
        }
      }
      if (scope === "global") {
        return {
          "opencode:webgui:global:model:v1": JSON.stringify({
            recent: [],
            favorite: [],
          }),
        }
      }
      return {}
    })

    const fallbackOnly = renderHook(() => useSession(), { wrapper })
    await waitFor(() => {
      expect(fallbackOnly.result.current.selectedProviderId).toBe("openai")
      expect(fallbackOnly.result.current.selectedModelId).toBe("gpt-4.1")
    })
    fallbackOnly.unmount()
  })

  it("host 模型不可用时自动回退到可用模型", async () => {
    ;(ideBridge.isInstalled as any).mockReturnValue(true)
    ;(ideBridge.storageGet as any).mockImplementation(async () => {
      return {
        [selectionKey]: JSON.stringify({
          agent: "build",
          provider_id: "missing-provider",
          model_id: "missing-model",
          variant: "high",
          updated_at: 123,
        }),
      }
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
    ;(ideBridge.storageGet as any).mockImplementation(async () => {
      return {
        [selectionKey]: JSON.stringify({
          agent: "build",
          provider_id: "openai",
          model_id: "gpt-4.1",
          variant: "non-existent-variant",
          updated_at: 123,
        }),
      }
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
    ;(ideBridge.storageGet as any).mockResolvedValue({})
    ;(ideBridge.storageSet as any).mockResolvedValue(true)

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
      expect((ideBridge.storageSet as any).mock.calls.length).toBeGreaterThan(0)

      const lastWrite = (ideBridge.storageSet as any).mock.calls.at(-1)
      expect(lastWrite?.[0]).toBe("workspace")
      expect(lastWrite?.[1]).toBe(selectionKey)

      const payload = JSON.parse(lastWrite?.[2] || "{}")
      expect(payload.provider_id).toBe("openai")
      expect(payload.model_id).toBe("gpt-4.1")
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
    events.reset()
    resetScopedStateForTest()
    ;(sdk.session.list as any).mockResolvedValue({ data: [], error: null })
    ;(sdk.session.retry as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.config.get as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.config.providers as any).mockResolvedValue({ data: { providers: [] }, error: null })
    ;(ideBridge.isInstalled as any).mockReturnValue(false)
    ;(ideBridge.storageGet as any).mockResolvedValue({})
    ;(ideBridge.storageSet as any).mockResolvedValue(true)
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
    events.reset()
    resetScopedStateForTest()
    ;(sdk.session.list as any).mockResolvedValue({ data: [], error: null })
    ;(sdk.session.retry as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.config.get as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.config.providers as any).mockResolvedValue({ data: { providers: [] }, error: null })
    ;(ideBridge.isInstalled as any).mockReturnValue(false)
    ;(ideBridge.storageGet as any).mockResolvedValue({})
    ;(ideBridge.storageSet as any).mockResolvedValue(true)
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

describe("SessionContext session.deleted scoped draft cleanup", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    events.reset()
    resetScopedStateForTest()
    ;(sdk.session.list as any).mockResolvedValue({ data: [], error: null })
    ;(sdk.session.retry as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.config.get as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.config.providers as any).mockResolvedValue({ data: { providers: [] }, error: null })
    ;(ideBridge.isInstalled as any).mockReturnValue(false)
    ;(ideBridge.storageGet as any).mockResolvedValue({})
    ;(ideBridge.storageSet as any).mockResolvedValue(true)
  })

  it("cleans drafts map and active draft session on session.deleted", async () => {
    await scopedStateSetJSON("workspace", draftsKey, {
      "s-keep": "keep me",
      "s-drop": "drop me",
    })
    await scopedStateSetJSON("workspace", draftSessionKey, "s-drop")

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      events.emit("session.deleted", {
        type: "session.deleted",
        properties: {
          info: {
            id: "s-drop",
          },
        },
      })
    })

    await waitFor(async () => {
      const drafts = await scopedStateGetJSON<Record<string, string>>("workspace", draftsKey, {})
      const draftSession = await scopedStateGetJSON<string | null>("workspace", draftSessionKey, null)

      expect(drafts).toEqual({ "s-keep": "keep me" })
      expect(draftSession).toBeNull()
    })
  })

  it("does not revive deleted draft keys when two sessions are deleted in sequence", async () => {
    await scopedStateSetJSON("workspace", draftsKey, {
      "s-a": "draft-a",
      "s-b": "draft-b",
      "s-keep": "keep",
    })
    await scopedStateSetJSON("workspace", draftSessionKey, "s-keep")

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      events.emit("session.deleted", {
        type: "session.deleted",
        properties: {
          info: {
            id: "s-a",
          },
        },
      })
      events.emit("session.deleted", {
        type: "session.deleted",
        properties: {
          info: {
            id: "s-b",
          },
        },
      })
    })

    await waitFor(async () => {
      const drafts = await scopedStateGetJSON<Record<string, string>>("workspace", draftsKey, {})
      const draftSession = await scopedStateGetJSON<string | null>("workspace", draftSessionKey, null)

      expect(drafts).toEqual({ "s-keep": "keep" })
      expect(draftSession).toBe("s-keep")
    })
  })

  it("keeps draft_session when deleting a non-active draft session", async () => {
    await scopedStateSetJSON("workspace", draftsKey, {
      "s-drop": "drop",
      "s-active": "active",
    })
    await scopedStateSetJSON("workspace", draftSessionKey, "s-active")

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      events.emit("session.deleted", {
        type: "session.deleted",
        properties: {
          info: {
            id: "s-drop",
          },
        },
      })
    })

    await waitFor(async () => {
      const drafts = await scopedStateGetJSON<Record<string, string>>("workspace", draftsKey, {})
      const draftSession = await scopedStateGetJSON<string | null>("workspace", draftSessionKey, null)

      expect(drafts).toEqual({ "s-active": "active" })
      expect(draftSession).toBe("s-active")
    })
  })
})
