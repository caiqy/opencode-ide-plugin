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
        regenerateTitle: vi.fn(),
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
import type { ServerEvent } from "../lib/api/events"
import { ideBridge } from "../lib/ideBridge"
import { resetDraftRepoForTest } from "./repo/draftRepo"
import { resetScopedStateForTest, scopedStateGetJSON, scopedStateSetJSON } from "./scopedStorage"
import { SessionProvider, useSession } from "./SessionContext"
import { SESSION_LIST_LIMIT, SESSION_LIST_PAGE_SIZE } from "./sessionPaging"

const selectionKey = "opencode:webgui:workspace:last_selection:v1"
const draftsKey = "opencode:webgui:workspace:drafts:v1"
const draftSessionKey = "opencode:webgui:workspace:draft_session:v1"

function wrapper(props: { children: ReactNode }) {
  return <SessionProvider>{props.children}</SessionProvider>
}

function session(id: string, created: number) {
  return {
    id,
    title: id,
    parentID: null,
    time: {
      created,
      updated: created,
    },
  } as any
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (err?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function sessionDeletedEvent(id: string): Extract<ServerEvent, { type: "session.deleted" }> {
  return {
    type: "session.deleted",
    properties: {
      info: {
        id,
      },
    },
  }
}

describe("SessionContext migration", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    events.reset()
    resetScopedStateForTest()
    resetDraftRepoForTest()
    ;(sdk.session.list as any).mockResolvedValue({ data: [], error: null })
    ;(sdk.session.retry as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.session.diff as any).mockResolvedValue({ data: [], error: null })
    ;(sdk.session.regenerateTitle as any).mockResolvedValue({ data: null, error: null })
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

  it("balances foreground session protection by session id", async () => {
    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    const emptySet = result.current.foregroundSessions

    act(() => {
      result.current.beginForegroundSession("s2")
    })

    const singleMemberSet = result.current.foregroundSessions
    expect(Array.from(result.current.foregroundSessions)).toEqual(["s2"])
    expect(singleMemberSet).not.toBe(emptySet)

    act(() => {
      result.current.beginForegroundSession("s2")
    })

    expect(result.current.foregroundSessions).toBe(singleMemberSet)
    expect(Array.from(result.current.foregroundSessions)).toEqual(["s2"])

    act(() => {
      result.current.endForegroundSession("s2")
    })

    expect(result.current.foregroundSessions).toBe(singleMemberSet)
    expect(Array.from(result.current.foregroundSessions)).toEqual(["s2"])

    act(() => {
      result.current.endForegroundSession("s2")
    })

    expect(result.current.foregroundSessions).not.toBe(singleMemberSet)
    expect(Array.from(result.current.foregroundSessions)).toEqual([])
  })

  it("retrySession 遇到结构化 error 时应恢复 idle 并暴露错误", async () => {
    ;(sdk.session.retry as any).mockResolvedValueOnce({ data: null, error: new Error("boom") })

    const { result } = renderHook(() => useSession(), { wrapper })

    await act(async () => {
      await result.current.retrySession("s1")
    })

    await waitFor(() => {
      expect(result.current.error?.message).toBe("boom")
      expect(result.current.isSessionIdle("s1")).toBe(true)
    })
  })

  it("retrySession 遇到 { error: { message } } 时应展示真实错误文案", async () => {
    ;(sdk.session.retry as any).mockResolvedValueOnce({ data: null, error: { message: "boom" } })

    const { result } = renderHook(() => useSession(), { wrapper })

    await act(async () => {
      await result.current.retrySession("s1")
    })

    await waitFor(() => {
      expect(result.current.error?.message).toBe("boom")
      expect(result.current.isSessionIdle("s1")).toBe(true)
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
    expect(setSpy).not.toHaveBeenCalledWith("opencode_selected_provider", expect.anything())
    expect(setSpy).not.toHaveBeenCalledWith("opencode_selected_model", expect.anything())
    expect(setSpy).not.toHaveBeenCalledWith("opencode_selected_agent", expect.anything())
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

  it("初始化恢复出的 variant 在切走再切回模型后仍会保留", async () => {
    ;(ideBridge.isInstalled as any).mockReturnValue(true)
    ;(ideBridge.storageGet as any).mockImplementation(async () => {
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
    })

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe("anthropic")
      expect(result.current.selectedModelId).toBe("claude-4-sonnet")
      expect(result.current.selectedVariant).toBe("high")
    })

    await act(async () => {
      await result.current.setSelectedModel("openai", "gpt-4.1")
    })

    await act(async () => {
      await result.current.setSelectedModel("anthropic", "claude-4-sonnet")
    })

    await waitFor(() => {
      expect(result.current.selectedProviderId).toBe("anthropic")
      expect(result.current.selectedModelId).toBe("claude-4-sonnet")
      expect(result.current.selectedVariant).toBe("high")
    })
  })

  it("setSelectedAgent 切到其他模型时会同步切换该模型的 variant", async () => {
    ;(ideBridge.isInstalled as any).mockReturnValue(true)
    ;(ideBridge.storageGet as any).mockImplementation(async () => {
      return {
        [selectionKey]: JSON.stringify({
          agent: "build",
          provider_id: "openai",
          model_id: "gpt-4.1",
          variant: null,
          updated_at: 123,
          agent_model_map: {
            plan: {
              provider_id: "anthropic",
              model_id: "claude-4-sonnet",
            },
          },
        }),
      }
    })

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.selectedAgent).toBe("build")
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
      await result.current.setSelectedAgent("plan")
    })

    await waitFor(() => {
      expect(result.current.selectedAgent).toBe("plan")
      expect(result.current.selectedProviderId).toBe("anthropic")
      expect(result.current.selectedModelId).toBe("claude-4-sonnet")
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
    resetDraftRepoForTest()
    ;(sdk.session.list as any).mockResolvedValue({ data: [], error: null })
    ;(sdk.session.retry as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.session.diff as any).mockResolvedValue({ data: [], error: null })
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
    resetDraftRepoForTest()
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

describe("SessionContext session paging", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    events.reset()
    resetScopedStateForTest()
    resetDraftRepoForTest()
    ;(sdk.session.retry as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.config.get as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.config.providers as any).mockResolvedValue({ data: { providers: [] }, error: null })
    ;(ideBridge.isInstalled as any).mockReturnValue(false)
    ;(ideBridge.storageGet as any).mockResolvedValue({})
    ;(ideBridge.storageSet as any).mockResolvedValue(true)
  })

  it("mount 时带 roots 与 limit 拉取主会话", async () => {
    ;(sdk.session.list as any).mockResolvedValue({ data: [], error: null })

    renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(sdk.session.list).toHaveBeenCalledWith({ roots: true, limit: SESSION_LIST_LIMIT })
    })
  })

  it("切换到未分页加载但可回源的 session 时不输出 warning", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    ;(sdk.session.list as any).mockResolvedValue({ data: [], error: null })
    ;(sdk.session.get as any).mockResolvedValue({ data: session("s-late", 1), error: null })
    ;(sdk.session.diff as any).mockResolvedValue({ data: [], error: null })

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    await act(async () => {
      await result.current.switchSession("s-late")
    })

    expect(sdk.session.get).toHaveBeenCalledWith({ path: { id: "s-late" } })
    expect(result.current.currentSession?.id).toBe("s-late")
    expect(warn).not.toHaveBeenCalledWith("[SessionContext] Session not found in local list, fetching...")
    warn.mockRestore()
  })

  it("loadMoreSessions 会扩大 limit 并再次请求", async () => {
    ;(sdk.session.list as any)
      .mockResolvedValueOnce({
        data: Array.from({ length: SESSION_LIST_LIMIT }, (_, i) => session(`s-${i}`, i)),
        error: null,
      })
      .mockResolvedValueOnce({
        data: Array.from({ length: SESSION_LIST_LIMIT + SESSION_LIST_PAGE_SIZE }, (_, i) => session(`s-${i}`, i)),
        error: null,
      })

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(SESSION_LIST_LIMIT)
      expect(result.current.hasMore).toBe(true)
    })

    await act(async () => {
      await result.current.loadMoreSessions()
    })

    expect(sdk.session.list).toHaveBeenNthCalledWith(1, { roots: true, limit: SESSION_LIST_LIMIT })
    expect(sdk.session.list).toHaveBeenNthCalledWith(2, {
      roots: true,
      limit: SESSION_LIST_LIMIT + SESSION_LIST_PAGE_SIZE,
    })

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(SESSION_LIST_LIMIT + SESSION_LIST_PAGE_SIZE)
      expect(result.current.hasMore).toBe(true)
    })
  })

  it("分页结果保持后端返回顺序，不按 created 重新洗牌", async () => {
    ;(sdk.session.list as any).mockResolvedValueOnce({
      data: [
        {
          id: "recently-updated-old",
          title: "old",
          parentID: null,
          time: { created: 1, updated: 300 },
        },
        {
          id: "newer-created",
          title: "new",
          parentID: null,
          time: { created: 200, updated: 200 },
        },
      ],
      error: null,
    })

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.sessions.map((item) => item.id)).toEqual(["recently-updated-old", "newer-created"])
    })
  })

  it("session.updated 会按 updated 时间重排已存在会话", async () => {
    ;(sdk.session.list as any).mockResolvedValueOnce({
      data: [
        {
          id: "s-2",
          title: "second",
          parentID: null,
          time: { created: 2, updated: 200 },
        },
        {
          id: "s-1",
          title: "first",
          parentID: null,
          time: { created: 1, updated: 100 },
        },
      ],
      error: null,
    })

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.sessions.map((item) => item.id)).toEqual(["s-2", "s-1"])
    })

    act(() => {
      events.emit("session.updated", {
        type: "session.updated",
        properties: {
          info: {
            id: "s-1",
            title: "first",
            parentID: null,
            time: { created: 1, updated: 300 },
          },
        },
      })
    })

    await waitFor(() => {
      expect(result.current.sessions.map((item) => item.id)).toEqual(["s-1", "s-2"])
    })
  })

  it("初始加载只更新 isLoading，不更新 isLoadingMore", async () => {
    const gate = deferred<any>()
    ;(sdk.session.list as any).mockImplementationOnce(() => gate.promise)

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(true)
      expect(result.current.isLoadingMore).toBe(false)
    })

    await act(async () => {
      gate.resolve({ data: [], error: null })
      await gate.promise
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
      expect(result.current.isLoadingMore).toBe(false)
    })
  })

  it("loadMoreSessions 只更新 isLoadingMore，不更新 isLoading", async () => {
    const gate = deferred<any>()
    ;(sdk.session.list as any)
      .mockResolvedValueOnce({
        data: Array.from({ length: SESSION_LIST_LIMIT }, (_, i) => session(`s-${i}`, i)),
        error: null,
      })
      .mockImplementationOnce(() => gate.promise)

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(SESSION_LIST_LIMIT)
      expect(result.current.isLoading).toBe(false)
      expect(result.current.isLoadingMore).toBe(false)
    })

    let next!: Promise<void>

    await act(async () => {
      next = result.current.loadMoreSessions()
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
      expect(result.current.isLoadingMore).toBe(true)
    })

    await act(async () => {
      gate.resolve({
        data: Array.from({ length: SESSION_LIST_LIMIT + SESSION_LIST_PAGE_SIZE }, (_, i) => session(`s-${i}`, i)),
        error: null,
      })
      await next
    })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
      expect(result.current.isLoadingMore).toBe(false)
    })
  })

  it("初始加载与 loadMore 并发时晚到旧响应不会覆盖更大窗口", async () => {
    const first = deferred<any>()
    const more = deferred<any>()
    ;(sdk.session.list as any)
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => more.promise)
      .mockResolvedValueOnce({
        data: Array.from({ length: SESSION_LIST_LIMIT + SESSION_LIST_PAGE_SIZE * 2 }, (_, i) => session(`s-${i}`, i)),
        error: null,
      })

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(true)
    })

    let next!: Promise<void>

    await act(async () => {
      next = result.current.loadMoreSessions()
    })

    await waitFor(() => {
      expect(result.current.isLoadingMore).toBe(true)
      expect(sdk.session.list).toHaveBeenNthCalledWith(2, {
        roots: true,
        limit: SESSION_LIST_LIMIT + SESSION_LIST_PAGE_SIZE,
      })
    })

    await act(async () => {
      more.resolve({
        data: Array.from({ length: SESSION_LIST_LIMIT + SESSION_LIST_PAGE_SIZE }, (_, i) => session(`s-${i}`, i)),
        error: null,
      })
      await next
    })

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(SESSION_LIST_LIMIT + SESSION_LIST_PAGE_SIZE)
    })

    await act(async () => {
      first.resolve({
        data: Array.from({ length: SESSION_LIST_LIMIT }, (_, i) => session(`s-${i}`, i)),
        error: null,
      })
      await first.promise
    })

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(SESSION_LIST_LIMIT + SESSION_LIST_PAGE_SIZE)
    })

    await act(async () => {
      await result.current.loadMoreSessions()
    })

    expect(sdk.session.list).toHaveBeenNthCalledWith(3, {
      roots: true,
      limit: SESSION_LIST_LIMIT + SESSION_LIST_PAGE_SIZE * 2,
    })
  })

  it("返回条数小于 limit 时 hasMore 为 false", async () => {
    ;(sdk.session.list as any).mockResolvedValue({ data: [session("s-1", 1)], error: null })

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1)
      expect(result.current.hasMore).toBe(false)
    })
  })

  it("请求失败时保留已有 sessions", async () => {
    ;(sdk.session.list as any)
      .mockResolvedValueOnce({
        data: Array.from({ length: SESSION_LIST_LIMIT }, (_, i) => session(`s-${i}`, i)),
        error: null,
      })
      .mockRejectedValueOnce(new Error("boom"))

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(SESSION_LIST_LIMIT)
    })

    const prev = result.current.sessions

    await act(async () => {
      await result.current.loadMoreSessions()
    })

    await waitFor(() => {
      expect(result.current.error?.message).toBe("boom")
      expect(result.current.sessions).toEqual(prev)
    })
  })

  it("loadMoreSessions 失败后重试仍请求同一分页窗口", async () => {
    ;(sdk.session.list as any)
      .mockResolvedValueOnce({
        data: Array.from({ length: SESSION_LIST_LIMIT }, (_, i) => session(`s-${i}`, i)),
        error: null,
      })
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        data: Array.from({ length: SESSION_LIST_LIMIT + SESSION_LIST_PAGE_SIZE }, (_, i) => session(`s-${i}`, i)),
        error: null,
      })

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(SESSION_LIST_LIMIT)
    })

    await act(async () => {
      await result.current.loadMoreSessions()
    })

    await waitFor(() => {
      expect(result.current.error?.message).toBe("boom")
      expect(result.current.sessions).toHaveLength(SESSION_LIST_LIMIT)
    })

    await act(async () => {
      await result.current.loadMoreSessions()
    })

    expect(sdk.session.list).toHaveBeenNthCalledWith(2, {
      roots: true,
      limit: SESSION_LIST_LIMIT + SESSION_LIST_PAGE_SIZE,
    })
    expect(sdk.session.list).toHaveBeenNthCalledWith(3, {
      roots: true,
      limit: SESSION_LIST_LIMIT + SESSION_LIST_PAGE_SIZE,
    })

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(SESSION_LIST_LIMIT + SESSION_LIST_PAGE_SIZE)
    })
  })

  it("连续触发两次 loadMoreSessions 时会复用同一次请求", async () => {
    const gate = deferred<any>()
    ;(sdk.session.list as any)
      .mockResolvedValueOnce({
        data: Array.from({ length: SESSION_LIST_LIMIT }, (_, i) => session(`s-${i}`, i)),
        error: null,
      })
      .mockImplementationOnce(() => gate.promise)

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(SESSION_LIST_LIMIT)
    })

    let a!: Promise<void>
    let b!: Promise<void>

    await act(async () => {
      a = result.current.loadMoreSessions()
      b = result.current.loadMoreSessions()

      expect(a).toBe(b)
      expect(sdk.session.list).toHaveBeenCalledTimes(2)
      expect(sdk.session.list).toHaveBeenNthCalledWith(2, {
        roots: true,
        limit: SESSION_LIST_LIMIT + SESSION_LIST_PAGE_SIZE,
      })

      gate.resolve({
        data: Array.from({ length: SESSION_LIST_LIMIT + SESSION_LIST_PAGE_SIZE }, (_, i) => session(`s-${i}`, i)),
        error: null,
      })

      await Promise.all([a, b])
    })

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(SESSION_LIST_LIMIT + SESSION_LIST_PAGE_SIZE)
    })
  })

  it("regenerateSessionTitle 成功后会更新本地 sessions 与当前会话", async () => {
    const initial = {
      id: "s1",
      title: "旧标题",
      parentID: null,
      time: { created: 1, updated: 1 },
    }
    const updated = {
      ...initial,
      title: "新标题",
      time: { created: 1, updated: 2 },
    }
    ;(sdk.session.list as any).mockResolvedValueOnce({ data: [initial], error: null })
    ;(sdk.session.get as any).mockResolvedValueOnce({ data: initial, error: null })
    ;(sdk.session.diff as any).mockResolvedValueOnce({ data: [], error: null })
    ;(sdk.session.regenerateTitle as any).mockResolvedValueOnce({ data: updated, error: null })

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1)
    })

    await act(async () => {
      await result.current.switchSession("s1")
    })

    await act(async () => {
      const ok = await result.current.regenerateSessionTitle("s1")
      expect(ok).toBe(true)
    })

    expect(sdk.session.regenerateTitle).toHaveBeenCalledWith({
      path: { sessionID: "s1" },
    })

    await waitFor(() => {
      expect(result.current.sessions[0]?.title).toBe("新标题")
      expect(result.current.currentSession?.title).toBe("新标题")
    })
  })

  it("当前会话首次 diff 读取完成前保持 foreground session，完成后释放", async () => {
    const diff = deferred<any>()
    ;(sdk.session.list as any).mockResolvedValueOnce({ data: [session("s1", 1)], error: null })
    ;(sdk.session.diff as any).mockReturnValueOnce(diff.promise)

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1)
    })

    await act(async () => {
      await result.current.switchSession("s1")
    })

    await waitFor(() => {
      expect(result.current.currentSession?.id).toBe("s1")
      expect(result.current.foregroundSessions.has("s1")).toBe(true)
    })

    await act(async () => {
      diff.resolve({ data: [], error: null })
    })

    await waitFor(() => {
      expect(result.current.foregroundSessions.has("s1")).toBe(false)
    })
  })

  it("当前会话首次 diff 读取失败后也会释放 foreground session", async () => {
    const diff = deferred<any>()
    ;(sdk.session.list as any).mockResolvedValueOnce({ data: [session("s1", 1)], error: null })
    ;(sdk.session.diff as any).mockReturnValueOnce(diff.promise)

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1)
    })

    await act(async () => {
      await result.current.switchSession("s1")
    })

    await waitFor(() => {
      expect(result.current.currentSession?.id).toBe("s1")
      expect(result.current.foregroundSessions.has("s1")).toBe(true)
    })

    await act(async () => {
      diff.reject(new Error("diff failed"))
    })

    await waitFor(() => {
      expect(result.current.foregroundSessions.has("s1")).toBe(false)
    })
  })

  it("当前会话首次 diff 读取 cleanup 时会释放 foreground session", async () => {
    const diff = deferred<any>()
    let signal: AbortSignal | undefined
    ;(sdk.session.list as any).mockResolvedValueOnce({ data: [session("s1", 1)], error: null })
    ;(sdk.session.diff as any).mockImplementationOnce(({ signal: next }: { signal?: AbortSignal }) => {
      signal = next
      return diff.promise
    })

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1)
    })

    await act(async () => {
      await result.current.switchSession("s1")
    })

    await waitFor(() => {
      expect(result.current.currentSession?.id).toBe("s1")
      expect(result.current.foregroundSessions.has("s1")).toBe(true)
      expect(signal).toBeInstanceOf(AbortSignal)
      expect(signal?.aborted).toBe(false)
    })

    act(() => {
      result.current.setCurrentSession(null)
    })

    await waitFor(() => {
      expect(result.current.currentSession).toBeNull()
      expect(result.current.foregroundSessions.has("s1")).toBe(false)
      expect(signal?.aborted).toBe(true)
    })
  })

  it("切到已是 current 的同一 session 时不会留下悬挂 foreground session", async () => {
    ;(sdk.session.list as any).mockResolvedValueOnce({ data: [session("s1", 1)], error: null })
    ;(sdk.session.diff as any).mockResolvedValueOnce({ data: [], error: null })

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1)
    })

    await act(async () => {
      await result.current.switchSession("s1")
    })

    await waitFor(() => {
      expect(result.current.currentSession?.id).toBe("s1")
      expect(result.current.foregroundSessions.has("s1")).toBe(false)
    })

    await act(async () => {
      await result.current.switchSession("s1")
    })

    await waitFor(() => {
      expect(result.current.currentSession?.id).toBe("s1")
      expect(result.current.foregroundSessions.has("s1")).toBe(false)
    })

    expect(sdk.session.diff).toHaveBeenCalledTimes(1)
  })

  it("连续切换两个需回源 session 时，旧响应晚到不会覆盖 currentSession 或释放新 foreground", async () => {
    const firstGet = deferred<any>()
    const secondGet = deferred<any>()
    const secondDiff = deferred<any>()

    ;(sdk.session.list as any).mockResolvedValueOnce({ data: [], error: null })
    ;(sdk.session.get as any).mockReturnValueOnce(firstGet.promise).mockReturnValueOnce(secondGet.promise)
    ;(sdk.session.diff as any).mockImplementation(({ path }: { path: { id: string } }) => {
      if (path.id === "s2") {
        return secondDiff.promise
      }
      return Promise.resolve({ data: [], error: null })
    })

    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    let firstSwitch!: Promise<void>
    let secondSwitch!: Promise<void>
    act(() => {
      firstSwitch = result.current.switchSession("s1")
      secondSwitch = result.current.switchSession("s2")
    })

    await waitFor(() => {
      expect(result.current.foregroundSessions.has("s1")).toBe(false)
      expect(result.current.foregroundSessions.has("s2")).toBe(true)
    })

    await act(async () => {
      secondGet.resolve({ data: session("s2", 2), error: null })
      await secondSwitch
    })

    await waitFor(() => {
      expect(result.current.currentSession?.id).toBe("s2")
      expect(result.current.foregroundSessions.has("s2")).toBe(true)
    })

    await act(async () => {
      firstGet.resolve({ data: session("s1", 1), error: null })
      await firstSwitch
    })

    await waitFor(() => {
      expect(result.current.currentSession?.id).toBe("s2")
      expect(result.current.foregroundSessions.has("s1")).toBe(false)
      expect(result.current.foregroundSessions.has("s2")).toBe(true)
    })

    expect(sdk.session.diff).toHaveBeenCalledTimes(1)
    expect(sdk.session.diff).toHaveBeenCalledWith({
      path: { id: "s2" },
      signal: expect.any(AbortSignal),
    })

    await act(async () => {
      secondDiff.resolve({ data: [], error: null })
    })

    await waitFor(() => {
      expect(result.current.foregroundSessions.has("s2")).toBe(false)
    })
  })
})

describe("SessionContext session.deleted scoped draft cleanup", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    events.reset()
    resetScopedStateForTest()
    resetDraftRepoForTest()
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
      events.emit("session.deleted", sessionDeletedEvent("s-drop"))
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
      events.emit("session.deleted", sessionDeletedEvent("s-a"))
      events.emit("session.deleted", sessionDeletedEvent("s-b"))
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
      events.emit("session.deleted", sessionDeletedEvent("s-drop"))
    })

    await waitFor(async () => {
      const drafts = await scopedStateGetJSON<Record<string, string>>("workspace", draftsKey, {})
      const draftSession = await scopedStateGetJSON<string | null>("workspace", draftSessionKey, null)

      expect(drafts).toEqual({ "s-active": "active" })
      expect(draftSession).toBe("s-active")
    })
  })

  it("ignores legacy session.deleted payload with properties.sessionID", async () => {
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
          sessionID: "s-drop",
        },
      })
    })

    await waitFor(async () => {
      const drafts = await scopedStateGetJSON<Record<string, string>>("workspace", draftsKey, {})
      const draftSession = await scopedStateGetJSON<string | null>("workspace", draftSessionKey, null)

      expect(drafts).toEqual({
        "s-keep": "keep me",
        "s-drop": "drop me",
      })
      expect(draftSession).toBe("s-drop")
    })
  })

  it("consumes session.diff.status and marks diff latest after session.diff", async () => {
    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      events.emit("session.diff.status", {
        type: "session.diff.status",
        properties: {
          sessionID: "s-1",
          status: "running",
          message: "Summary refresh in progress",
        },
      })
    })

    await waitFor(() => {
      expect("sessionDiffStatus" in result.current).toBe(true)
      expect((result.current as any).sessionDiffStatus).toEqual({
        "s-1": {
          type: "updating",
          message: "Summary refresh in progress",
        },
      })
    })

    act(() => {
      events.emit("session.diff", {
        type: "session.diff",
        properties: {
          sessionID: "s-1",
          diff: [],
        },
      })
    })

    await waitFor(() => {
      expect((result.current as any).sessionDiffStatus).toEqual({
        "s-1": {
          type: "latest",
          message: "已是最新结果",
        },
      })
    })
  })

  it("maps session.diff.status idle to latest", async () => {
    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      events.emit("session.diff.status", {
        type: "session.diff.status",
        properties: {
          sessionID: "s-idle",
          status: "idle",
          message: "Summary refresh complete",
        },
      })
    })

    await waitFor(() => {
      expect((result.current as any).sessionDiffStatus).toEqual({
        "s-idle": {
          type: "latest",
          message: "已是最新结果",
        },
      })
    })
  })

  it("clears diff status on session.diff.status deleted", async () => {
    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      events.emit("session.diff.status", {
        type: "session.diff.status",
        properties: {
          sessionID: "s-drop",
          status: "failed",
          message: "Summary refresh failed",
        },
      })
    })

    await waitFor(() => {
      expect((result.current as any).sessionDiffStatus).toEqual({
        "s-drop": {
          type: "failed",
          message: "Summary refresh failed",
        },
      })
    })

    act(() => {
      events.emit("session.diff.status", {
        type: "session.diff.status",
        properties: {
          sessionID: "s-drop",
          status: "deleted",
          message: "Summary refresh discarded",
        },
      })
    })

    await waitFor(() => {
      expect((result.current as any).sessionDiffStatus).toEqual({})
    })
  })

  it("clears diff status when session.deleted arrives", async () => {
    const { result } = renderHook(() => useSession(), { wrapper })

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false)
    })

    act(() => {
      events.emit("session.diff.status", {
        type: "session.diff.status",
        properties: {
          sessionID: "s-drop",
          status: "failed",
          message: "Summary refresh failed",
        },
      })
    })

    await waitFor(() => {
      expect((result.current as any).sessionDiffStatus).toEqual({
        "s-drop": {
          type: "failed",
          message: "Summary refresh failed",
        },
      })
    })

    act(() => {
      events.emit("session.deleted", sessionDeletedEvent("s-drop"))
    })

    await waitFor(() => {
      expect((result.current as any).sessionDiffStatus).toEqual({})
    })
  })
})
