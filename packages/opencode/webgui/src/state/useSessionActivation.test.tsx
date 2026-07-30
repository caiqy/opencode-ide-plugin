import { act, render, waitFor } from "../test/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"

vi.mock("../lib/api/sdkClient", () => {
  return {
    sdk: {
      config: {
        get: vi.fn(),
        providers: vi.fn(),
      },
      session: {
        list: vi.fn(),
        get: vi.fn(),
        diff: vi.fn(),
        messages: vi.fn(),
        retry: vi.fn(),
        syncVisible: vi.fn(),
      },
      permissions: {
        respond: vi.fn(),
      },
      question: {
        reply: vi.fn(),
        reject: vi.fn(),
      },
    },
  }
})

const tabStore = vi.hoisted(() => ({
  state: {
    openTabs: [] as string[],
  },
}))

vi.mock("./tabStore", () => ({
  useTabStore: () => ({
    openTabs: tabStore.state.openTabs,
  }),
}))

vi.mock("../lib/ideBridge", () => {
  return {
    ideBridge: {
      isInstalled: vi.fn(),
      request: vi.fn(),
    },
  }
})

import { sdk } from "../lib/api/sdkClient"
import { ideBridge } from "../lib/ideBridge"
import { MessagesProvider } from "./MessagesContext"
import { useMessages } from "./MessagesContext"
import { SessionProvider, useSession } from "./SessionContext"
import { useSessionActivation } from "./useSessionActivation"
import { useSessionVisibilitySync } from "../hooks/useSessionVisibilitySync"

let sessionApi: ReturnType<typeof useSession> | null = null
let messagesApi: ReturnType<typeof useMessages> | null = null
let activate: ((sessionID?: string | null) => Promise<void>) | null = null

function Capture() {
  sessionApi = useSession()
  messagesApi = useMessages()
  return null
}

function ActivationHarness() {
  activate = useSessionActivation()
  return null
}

function ActivationToggle(props: { enabled: boolean }) {
  return props.enabled ? <ActivationHarness /> : null
}

function VisibilityHarness() {
  useSessionVisibilitySync()
  return null
}

function Providers(props: { children: ReactNode }) {
  return (
    <SessionProvider>
      <MessagesProvider>{props.children}</MessagesProvider>
    </SessionProvider>
  )
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe("useSessionActivation", () => {
  beforeEach(() => {
    activate = null
    sessionApi = null
    messagesApi = null
    localStorage.clear()
    vi.resetAllMocks()
    tabStore.state.openTabs = []
    ;(ideBridge.isInstalled as any).mockReturnValue(false)
    ;(ideBridge.request as any).mockResolvedValue({ ok: true, result: {} })
    ;(sdk.session.list as any).mockResolvedValue({
      data: [{ id: "s1", title: "", time: { created: 1, updated: 1 } }],
      error: null,
    })
    ;(sdk.session.diff as any).mockResolvedValue({ data: [], error: null })
    ;(sdk.session.get as any).mockResolvedValue({ data: null, error: null })
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
                variants: { low: {}, medium: {} },
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
                variants: { high: {} },
                capabilities: { reasoning: true },
              },
            },
          },
        ],
        default: { provider: "openai", model: "gpt-4.1" },
      },
      error: null,
    })
    ;(sdk.session.messages as any).mockResolvedValue({
      error: null,
      data: [
        {
          info: {
            id: "u1",
            sessionID: "s1",
            role: "user",
            time: { created: 1 },
            agent: "plan",
            model: { providerID: "anthropic", modelID: "claude-4-sonnet" },
            variant: "high",
          },
          parts: [],
        },
      ],
    })
    ;(sdk.session.syncVisible as any).mockResolvedValue({ data: { sessionIDs: [] }, error: null })
  })

  it("switchSession 后恢复最后一条 user 选择，手动切换 model 不会重复触发加载", async () => {
    render(
      <Providers>
        <ActivationHarness />
        <Capture />
      </Providers>,
    )

    await waitFor(() => {
      expect(sessionApi).toBeTruthy()
    })

    await waitFor(() => {
      expect(sessionApi!.sessions.length).toBeGreaterThan(0)
    })

    await act(async () => {
      await sessionApi!.switchSession("s1")
    })

    await waitFor(() => {
      expect(sessionApi!.currentSession?.id).toBe("s1")
      expect(sessionApi!.selectedAgent).toBe("plan")
      expect(sessionApi!.selectedProviderId).toBe("anthropic")
      expect(sessionApi!.selectedModelId).toBe("claude-4-sonnet")
      expect(sessionApi!.selectedVariant).toBe("high")
    })

    expect(sdk.session.messages).toHaveBeenCalledTimes(1)

    await act(async () => {
      await sessionApi!.setSelectedModel("openai", "gpt-4.1")
    })

    await waitFor(() => {
      expect(sessionApi!.selectedProviderId).toBe("openai")
      expect(sessionApi!.selectedModelId).toBe("gpt-4.1")
    })

    expect(sdk.session.messages).toHaveBeenCalledTimes(1)
  })

  it("会忽略 revert 边界及其后的 user 选择，只恢复可见消息里的最后一次选择", async () => {
    ;(sdk.session.list as any).mockResolvedValue({
      data: [{ id: "s1", title: "", time: { created: 1, updated: 1 }, revert: { messageID: "u2" } }],
      error: null,
    })
    ;(sdk.session.messages as any).mockResolvedValue({
      error: null,
      data: [
        {
          info: {
            id: "u1",
            sessionID: "s1",
            role: "user",
            time: { created: 1 },
            agent: "plan",
            model: { providerID: "openai", modelID: "gpt-4.1" },
            variant: "low",
          },
          parts: [],
        },
        {
          info: {
            id: "u2",
            sessionID: "s1",
            role: "user",
            time: { created: 2 },
            agent: "build",
            model: { providerID: "anthropic", modelID: "claude-4-sonnet" },
            variant: "high",
          },
          parts: [],
        },
      ],
    })

    render(
      <Providers>
        <ActivationHarness />
        <Capture />
      </Providers>,
    )

    await waitFor(() => {
      expect(sessionApi).toBeTruthy()
      expect(sessionApi!.sessions.length).toBe(1)
    })

    await act(async () => {
      await sessionApi!.switchSession("s1")
    })

    await waitFor(() => {
      expect(sessionApi!.selectedAgent).toBe("plan")
      expect(sessionApi!.selectedProviderId).toBe("openai")
      expect(sessionApi!.selectedModelId).toBe("gpt-4.1")
      expect(sessionApi!.selectedVariant).toBe("low")
    })
  })

  it("同一 session 的 revert 边界变化时会恢复边界前最后一条 user 选择", async () => {
    ;(sdk.session.messages as any).mockResolvedValue({
      error: null,
      data: [
        {
          info: {
            id: "u1",
            sessionID: "s1",
            role: "user",
            time: { created: 1 },
            agent: "plan",
            model: { providerID: "openai", modelID: "gpt-4.1" },
            variant: "low",
          },
          parts: [],
        },
        {
          info: {
            id: "u2",
            sessionID: "s1",
            role: "user",
            time: { created: 2 },
            agent: "build",
            model: { providerID: "anthropic", modelID: "claude-4-sonnet" },
            variant: "high",
          },
          parts: [],
        },
      ],
    })

    render(
      <Providers>
        <ActivationHarness />
        <Capture />
      </Providers>,
    )

    await waitFor(() => expect(sessionApi).toBeTruthy())

    act(() => {
      sessionApi!.setCurrentSession({ id: "s1", title: "", time: { created: 1, updated: 1 } } as any)
    })

    await waitFor(() => expect(sessionApi!.selectedModelId).toBe("claude-4-sonnet"))

    act(() => {
      sessionApi!.setCurrentSession({
        id: "s1",
        title: "",
        time: { created: 1, updated: 1 },
        revert: { messageID: "u2" },
      } as any)
    })

    await waitFor(() => {
      expect(sessionApi!.selectedModelId).toBe("gpt-4.1")
      expect(sessionApi!.selectedAgent).toBe("plan")
    })
  })

  it("最近一页没有 user 消息时会继续向前加载，直到恢复最后一次 user 选择", async () => {
    const older = deferred<any>()

    ;(sdk.session.messages as any)
      .mockResolvedValueOnce({
        error: null,
        data: Array.from({ length: 50 }, (_, i) => ({
          info: {
            id: `a${i + 1}`,
            sessionID: "s1",
            role: "assistant",
            time: { created: i + 2 },
          },
          parts: [],
        })),
        response: {
          headers: new Headers({ "X-Next-Cursor": "c1" }),
        },
      })
      .mockReturnValueOnce(older.promise)

    render(
      <Providers>
        <ActivationHarness />
        <Capture />
      </Providers>,
    )

    await waitFor(() => {
      expect(sessionApi).toBeTruthy()
      expect(sessionApi!.sessions.length).toBe(1)
    })

    await act(async () => {
      await sessionApi!.switchSession("s1")
    })

    await waitFor(() => {
      expect(sdk.session.messages).toHaveBeenNthCalledWith(1, {
        path: { id: "s1" },
        query: { limit: 50 },
        signal: expect.any(AbortSignal),
      })
      expect(sdk.session.messages).toHaveBeenNthCalledWith(2, {
        path: { id: "s1" },
        query: { before: "c1", limit: 50 },
        signal: expect.any(AbortSignal),
      })
    })

    expect(messagesApi!.getSessionPagination("s1").olderLoading).toBe(false)
    expect(messagesApi!.getSessionPagination("s1").complete).toBe(false)
    expect(messagesApi!.getMessagesBySession("s1").some((m) => m.info.id === "u0")).toBe(false)

    older.resolve({
      error: null,
      data: [
        {
          info: {
            id: "u0",
            sessionID: "s1",
            role: "user",
            time: { created: 1 },
            agent: "plan",
            model: { providerID: "anthropic", modelID: "claude-4-sonnet" },
            variant: "high",
          },
          parts: [],
        },
      ],
      response: {
        headers: new Headers(),
      },
    })

    await waitFor(() => {
      expect(sessionApi!.currentSession?.id).toBe("s1")
      expect(sessionApi!.selectedAgent).toBe("plan")
      expect(sessionApi!.selectedProviderId).toBe("anthropic")
      expect(sessionApi!.selectedModelId).toBe("claude-4-sonnet")
      expect(sessionApi!.selectedVariant).toBe("high")
    })

    expect(messagesApi!.getSessionPagination("s1").olderLoading).toBe(false)
    expect(messagesApi!.getSessionPagination("s1").complete).toBe(false)
    expect(messagesApi!.getMessagesBySession("s1").some((m) => m.info.id === "u0")).toBe(false)
  })

  it("older 页与前页重复但 cursor 前进时仍会继续扫描，直到找到更早的 user selection", async () => {
    ;(sdk.session.messages as any)
      .mockResolvedValueOnce({
        error: null,
        data: Array.from({ length: 50 }, (_, i) => ({
          info: {
            id: `a${i + 1}`,
            sessionID: "s1",
            role: "assistant",
            time: { created: i + 2 },
          },
          parts: [],
        })),
        response: {
          headers: new Headers({ "X-Next-Cursor": "c1" }),
        },
      })
      .mockResolvedValueOnce({
        error: null,
        // 服务端可能重叠返回：与上一页完全重复，但 cursor 仍会向前推进
        data: Array.from({ length: 50 }, (_, i) => ({
          info: {
            id: `a${i + 1}`,
            sessionID: "s1",
            role: "assistant",
            time: { created: i + 2 },
          },
          parts: [],
        })),
        response: {
          headers: new Headers({ "X-Next-Cursor": "c2" }),
        },
      })
      .mockResolvedValueOnce({
        error: null,
        data: [
          {
            info: {
              id: "u0",
              sessionID: "s1",
              role: "user",
              time: { created: 1 },
              agent: "plan",
              model: { providerID: "anthropic", modelID: "claude-4-sonnet" },
              variant: "high",
            },
            parts: [],
          },
        ],
        response: {
          headers: new Headers(),
        },
      })

    render(
      <Providers>
        <ActivationHarness />
        <Capture />
      </Providers>,
    )

    await waitFor(() => {
      expect(sessionApi).toBeTruthy()
      expect(messagesApi).toBeTruthy()
      expect(activate).toBeTruthy()
    })

    await act(async () => {
      await activate!("s1")
    })

    expect(sdk.session.messages).toHaveBeenNthCalledWith(1, {
      path: { id: "s1" },
      query: { limit: 50 },
      signal: expect.any(AbortSignal),
    })
    expect(sdk.session.messages).toHaveBeenNthCalledWith(2, {
      path: { id: "s1" },
      query: { before: "c1", limit: 50 },
      signal: expect.any(AbortSignal),
    })
    expect(sdk.session.messages).toHaveBeenNthCalledWith(3, {
      path: { id: "s1" },
      query: { before: "c2", limit: 50 },
      signal: expect.any(AbortSignal),
    })

    expect(sessionApi!.selectedAgent).toBe("plan")
    expect(sessionApi!.selectedProviderId).toBe("anthropic")
    expect(sessionApi!.selectedModelId).toBe("claude-4-sonnet")
    expect(sessionApi!.selectedVariant).toBe("high")

    // 后台扫描不应污染 UI 历史分页状态，也不应把 older 页落到可见消息列表
    expect(messagesApi!.getSessionPagination("s1").olderLoading).toBe(false)
    expect(messagesApi!.getSessionPagination("s1").complete).toBe(false)
    expect(messagesApi!.getMessagesBySession("s1").some((m) => m.info.id === "u0")).toBe(false)
  })

  it("revert 边界不在最新页时，会继续向前扫描直到命中边界前的可见 user 选择", async () => {
    ;(sdk.session.list as any).mockResolvedValue({
      data: [{ id: "s1", title: "", time: { created: 1, updated: 1 }, revert: { messageID: "r1" } }],
      error: null,
    })
    ;(sdk.session.messages as any)
      .mockResolvedValueOnce({
        error: null,
        data: [
          {
            info: {
              id: "u2",
              sessionID: "s1",
              role: "user",
              time: { created: 3 },
              agent: "build",
              model: { providerID: "anthropic", modelID: "claude-4-sonnet" },
              variant: "high",
            },
            parts: [],
          },
        ],
        response: {
          headers: new Headers({ "X-Next-Cursor": "c1" }),
        },
      })
      .mockResolvedValueOnce({
        error: null,
        data: [
          {
            info: {
              id: "u0",
              sessionID: "s1",
              role: "user",
              time: { created: 1 },
              agent: "plan",
              model: { providerID: "openai", modelID: "gpt-4.1" },
              variant: "low",
            },
            parts: [],
          },
          {
            info: {
              id: "r1",
              sessionID: "s1",
              role: "assistant",
              time: { created: 2 },
            },
            parts: [],
          },
        ],
        response: {
          headers: new Headers(),
        },
      })

    render(
      <Providers>
        <ActivationHarness />
        <Capture />
      </Providers>,
    )

    await waitFor(() => {
      expect(sessionApi).toBeTruthy()
      expect(sessionApi!.sessions.length).toBe(1)
    })

    await act(async () => {
      await sessionApi!.switchSession("s1")
    })

    await waitFor(() => {
      expect(sdk.session.messages).toHaveBeenNthCalledWith(1, {
        path: { id: "s1" },
        query: { limit: 50 },
        signal: expect.any(AbortSignal),
      })
      expect(sdk.session.messages).toHaveBeenNthCalledWith(2, {
        path: { id: "s1" },
        query: { before: "c1", limit: 50 },
        signal: expect.any(AbortSignal),
      })
      expect(sessionApi!.selectedAgent).toBe("plan")
      expect(sessionApi!.selectedProviderId).toBe("openai")
      expect(sessionApi!.selectedModelId).toBe("gpt-4.1")
      expect(sessionApi!.selectedVariant).toBe("low")
    })
  })

  it("第十一页存在 selection 时会持续扫描并恢复", async () => {
    ;(sdk.session.messages as any).mockImplementation(
      ({ query }: { query: { before?: string; limit: number } }) => {
        if (!query.before) {
          return Promise.resolve({
            error: null,
            data: [
              {
                info: { id: "a0", sessionID: "s1", role: "assistant", time: { created: 100 } },
                parts: [],
              },
            ],
            response: { headers: new Headers({ "X-Next-Cursor": "c1" }) },
          })
        }

        const n = Number(query.before.slice(1))
        if (n === 11) {
          return Promise.resolve({
            error: null,
            data: [
              {
                info: {
                  id: "u-old",
                  sessionID: "s1",
                  role: "user",
                  time: { created: 1 },
                  agent: "plan",
                  model: { providerID: "openai", modelID: "gpt-4.1" },
                  variant: "low",
                },
                parts: [],
              },
            ],
            response: { headers: new Headers() },
          })
        }

        return Promise.resolve({
          error: null,
          data: [
            {
              info: { id: `a${n}`, sessionID: "s1", role: "assistant", time: { created: 100 - n } },
              parts: [],
            },
          ],
          response: { headers: new Headers({ "X-Next-Cursor": `c${n + 1}` }) },
        })
      },
    )

    render(
      <Providers>
        <ActivationHarness />
        <Capture />
      </Providers>,
    )

    await waitFor(() => {
      expect(messagesApi).toBeTruthy()
      expect(activate).toBeTruthy()
    })

    await act(async () => {
      await activate!("s1")
    })

    expect(sdk.session.messages).toHaveBeenCalledTimes(12)
    expect(sessionApi!.selectedAgent).toBe("plan")
    expect(sessionApi!.selectedModelId).toBe("gpt-4.1")
  })

  it("重复 cursor 时结束扫描并释放 foreground session", async () => {
    ;(sdk.session.messages as any)
      .mockResolvedValueOnce({
        error: null,
        data: [
          {
            info: { id: "a0", sessionID: "s1", role: "assistant", time: { created: 2 } },
            parts: [],
          },
        ],
        response: { headers: new Headers({ "X-Next-Cursor": "c1" }) },
      })
      .mockResolvedValueOnce({
        error: null,
        data: [
          {
            info: { id: "a1", sessionID: "s1", role: "assistant", time: { created: 1 } },
            parts: [],
          },
        ],
        response: { headers: new Headers({ "X-Next-Cursor": "c1" }) },
      })

    render(
      <Providers>
        <ActivationHarness />
        <Capture />
      </Providers>,
    )

    await waitFor(() => {
      expect(sessionApi).toBeTruthy()
      expect(activate).toBeTruthy()
    })

    await act(async () => {
      await activate!("s1")
    })

    expect(sdk.session.messages).toHaveBeenCalledTimes(2)
    expect(sessionApi!.foregroundSessions.has("s1")).toBe(false)
  })

  it("向前翻页恢复 selection 失败时保留当前选择并给出提示", async () => {
    ;(sdk.session.messages as any)
      .mockResolvedValueOnce({
        error: null,
        data: Array.from({ length: 50 }, (_, i) => ({
          info: {
            id: `a${i + 1}`,
            sessionID: "s1",
            role: "assistant",
            time: { created: i + 2 },
          },
          parts: [],
        })),
        response: {
          headers: new Headers({ "X-Next-Cursor": "c1" }),
        },
      })
      .mockResolvedValueOnce({
        error: { message: "boom" },
      })

    render(
      <Providers>
        <ActivationHarness />
        <Capture />
      </Providers>,
    )

    await waitFor(() => {
      expect(sessionApi).toBeTruthy()
      expect(sessionApi!.sessions.length).toBe(1)
    })

    await act(async () => {
      await sessionApi!.setSelectedVariant("medium")
    })

    await waitFor(() => {
      expect(sessionApi!.selectedVariant).toBe("medium")
    })

    await act(async () => {
      await sessionApi!.switchSession("s1")
    })

    await waitFor(() => {
      expect(sessionApi!.currentSession?.id).toBe("s1")
      expect(sessionApi!.selectionSessionId).toBe("s1")
      expect(sessionApi!.selectedVariant).toBe("medium")
      expect(sessionApi!.selectionRestoreNotice).toContain("未能恢复")
    })
  })

  it("切到 s2 后 s1 的晚到响应不会覆盖当前选择", async () => {
    ;(sdk.session.list as any).mockResolvedValue({
      data: [
        { id: "s1", title: "", time: { created: 1, updated: 1 } },
        { id: "s2", title: "", time: { created: 2, updated: 2 } },
      ],
      error: null,
    })

    const s1Messages = deferred<any>()
    const s2Messages = deferred<any>()

    ;(sdk.session.messages as any).mockImplementation(({ path }: { path: { id: string } }) => {
      if (path.id === "s1") return s1Messages.promise
      return s2Messages.promise
    })

    render(
      <Providers>
        <ActivationHarness />
        <Capture />
      </Providers>,
    )

    await waitFor(() => {
      expect(sessionApi).toBeTruthy()
    })

    await waitFor(() => {
      expect(sessionApi!.sessions.length).toBe(2)
    })

    await act(async () => {
      await sessionApi!.switchSession("s1")
    })

    await waitFor(() => {
      expect(sdk.session.messages).toHaveBeenCalledWith({
        path: { id: "s1" },
        query: { limit: 50 },
        signal: expect.any(AbortSignal),
      })
    })

    await act(async () => {
      await sessionApi!.switchSession("s2")
    })

    await waitFor(() => {
      expect(sdk.session.messages).toHaveBeenCalledWith({
        path: { id: "s2" },
        query: { limit: 50 },
        signal: expect.any(AbortSignal),
      })
    })

    await act(async () => {
      s2Messages.resolve({
        error: null,
        data: [
          {
            info: {
              id: "u2",
              sessionID: "s2",
              role: "user",
              time: { created: 2 },
              agent: "build",
              model: { providerID: "openai", modelID: "gpt-4.1" },
              variant: "medium",
            },
            parts: [],
          },
        ],
      })
    })

    await waitFor(() => {
      expect(sessionApi!.currentSession?.id).toBe("s2")
      expect(sessionApi!.selectedAgent).toBe("build")
      expect(sessionApi!.selectedProviderId).toBe("openai")
      expect(sessionApi!.selectedModelId).toBe("gpt-4.1")
      expect(sessionApi!.selectedVariant).toBe("medium")
    })

    await act(async () => {
      s1Messages.resolve({
        error: null,
        data: [
          {
            info: {
              id: "u1",
              sessionID: "s1",
              role: "user",
              time: { created: 1 },
              agent: "plan",
              model: { providerID: "anthropic", modelID: "claude-4-sonnet" },
              variant: "high",
            },
            parts: [],
          },
        ],
      })
    })

    await waitFor(() => {
      expect(sessionApi!.currentSession?.id).toBe("s2")
      expect(sessionApi!.selectedAgent).toBe("build")
      expect(sessionApi!.selectedProviderId).toBe("openai")
      expect(sessionApi!.selectedModelId).toBe("gpt-4.1")
      expect(sessionApi!.selectedVariant).toBe("medium")
    })
  })

  it("首次激活失败后 retry 应恢复 selection", async () => {
    ;(sdk.session.messages as any).mockResolvedValueOnce({ error: { message: "boom" } }).mockResolvedValueOnce({
      error: null,
      data: [
        {
          info: {
            id: "u1",
            sessionID: "s1",
            role: "user",
            time: { created: 1 },
            agent: "plan",
            model: { providerID: "anthropic", modelID: "claude-4-sonnet" },
            variant: "high",
          },
          parts: [],
        },
      ],
    })

    render(
      <Providers>
        <ActivationHarness />
        <Capture />
      </Providers>,
    )

    await waitFor(() => {
      expect(sessionApi).toBeTruthy()
      expect(activate).toBeTruthy()
    })

    await waitFor(() => {
      expect(sessionApi!.sessions.length).toBe(1)
    })

    await act(async () => {
      await sessionApi!.switchSession("s1")
    })

    await waitFor(() => {
      expect(sdk.session.messages).toHaveBeenCalledTimes(1)
      expect(sessionApi!.currentSession?.id).toBe("s1")
      expect(sessionApi!.selectedAgent).toBe("build")
      expect(sessionApi!.selectedProviderId).toBe("openai")
      expect(sessionApi!.selectedModelId).toBe("gpt-4.1")
      expect(sessionApi!.selectedVariant).not.toBe("high")
    })

    await act(async () => {
      await activate?.("s1")
    })

    await waitFor(() => {
      expect(sdk.session.messages).toHaveBeenCalledTimes(2)
      expect(sessionApi!.selectedAgent).toBe("plan")
      expect(sessionApi!.selectedProviderId).toBe("anthropic")
      expect(sessionApi!.selectedModelId).toBe("claude-4-sonnet")
      expect(sessionApi!.selectedVariant).toBe("high")
    })
  })

  it("没有可恢复 user 选择时也会结束当前会话的 selection pending", async () => {
    ;(sdk.session.messages as any).mockResolvedValue({ error: null, data: [] })

    render(
      <Providers>
        <ActivationHarness />
        <Capture />
      </Providers>,
    )

    await waitFor(() => {
      expect(sessionApi).toBeTruthy()
      expect(sessionApi!.sessions.length).toBe(1)
    })

    await act(async () => {
      await sessionApi!.switchSession("s1")
    })

    await waitFor(() => {
      expect(sessionApi!.currentSession?.id).toBe("s1")
      expect(sessionApi!.selectionSessionId).toBe("s1")
    })
  })

  it("已有可见消息但 latest 拉取失败时，也会结束 selection pending 并给出提示", async () => {
    ;(sdk.session.messages as any).mockResolvedValue({ error: { message: "boom" } })

    render(
      <Providers>
        <ActivationHarness />
        <Capture />
      </Providers>,
    )

    await waitFor(() => {
      expect(sessionApi).toBeTruthy()
      expect(messagesApi).toBeTruthy()
      expect(sessionApi!.sessions.length).toBe(1)
    })

    act(() => {
      messagesApi!.addMessage({
        info: {
          id: "m1",
          sessionID: "s1",
          role: "assistant",
          time: { created: 1 },
        },
        parts: [],
      } as any)
    })

    await act(async () => {
      await sessionApi!.switchSession("s1")
    })

    await waitFor(() => {
      expect(sessionApi!.currentSession?.id).toBe("s1")
      expect(sessionApi!.selectionSessionId).toBe("s1")
      expect(sessionApi!.selectionRestoreNotice).toContain("未能恢复")
    })
  })

  it("已有本地缓存的 user 选择时，latest 失败也会直接用缓存恢复", async () => {
    ;(sdk.session.messages as any).mockResolvedValue({ error: { message: "boom" } })

    render(
      <Providers>
        <ActivationHarness />
        <Capture />
      </Providers>,
    )

    await waitFor(() => {
      expect(sessionApi).toBeTruthy()
      expect(messagesApi).toBeTruthy()
      expect(sessionApi!.sessions.length).toBe(1)
    })

    act(() => {
      messagesApi!.addMessage({
        info: {
          id: "u-cache",
          sessionID: "s1",
          role: "user",
          time: { created: 1 },
          agent: "plan",
          model: { providerID: "anthropic", modelID: "claude-4-sonnet" },
          variant: "high",
        },
        parts: [],
      } as any)
    })

    await act(async () => {
      await sessionApi!.switchSession("s1")
    })

    await waitFor(() => {
      expect(sessionApi!.currentSession?.id).toBe("s1")
      expect(sessionApi!.selectionSessionId).toBe("s1")
      expect(sessionApi!.selectedAgent).toBe("plan")
      expect(sessionApi!.selectedProviderId).toBe("anthropic")
      expect(sessionApi!.selectedModelId).toBe("claude-4-sonnet")
      expect(sessionApi!.selectedVariant).toBe("high")
      expect(sessionApi!.selectionRestoreNotice).toBeNull()
    })
  })

  it("latest 失败且没有本地缓存时，也会结束 selection pending 并给出提示", async () => {
    ;(sdk.session.messages as any).mockResolvedValue({ error: { message: "boom" } })

    render(
      <Providers>
        <ActivationHarness />
        <Capture />
      </Providers>,
    )

    await waitFor(() => {
      expect(sessionApi).toBeTruthy()
      expect(sessionApi!.sessions.length).toBe(1)
    })

    await act(async () => {
      await sessionApi!.switchSession("s1")
    })

    await waitFor(() => {
      expect(sessionApi!.currentSession?.id).toBe("s1")
      expect(sessionApi!.selectionSessionId).toBe("s1")
      expect(sessionApi!.selectionRestoreNotice).toContain("未能恢复")
    })
  })

  it("selection 恢复失败后也会结束 foreground session", async () => {
    const load = deferred<any>()
    ;(sdk.session.messages as any).mockReturnValue(load.promise)

    render(
      <Providers>
        <ActivationHarness />
        <Capture />
      </Providers>,
    )

    await waitFor(() => {
      expect(sessionApi).toBeTruthy()
      expect(sessionApi!.sessions.length).toBe(1)
    })

    await act(async () => {
      await sessionApi!.switchSession("s1")
    })

    await waitFor(() => {
      expect(sessionApi!.foregroundSessions.has("s1")).toBe(true)
    })

    await act(async () => {
      load.resolve({ error: { message: "load failed" }, data: null })
    })

    await waitFor(() => {
      expect(sessionApi!.foregroundSessions.has("s1")).toBe(false)
      expect(sessionApi!.selectionRestoreNotice).toContain("未能恢复")
    })
  })

  it("switchSession 后在 activation 完成前不会把当前 session 立即上报为 visible", async () => {
    const load = deferred<any>()
    ;(sdk.session.messages as any).mockReturnValue(load.promise)
    ;(sdk.session.syncVisible as any)
      .mockResolvedValueOnce({ data: { sessionIDs: [] }, error: null })
      .mockResolvedValueOnce({ data: { sessionIDs: ["s1"] }, error: null })

    render(
      <Providers>
        <ActivationHarness />
        <VisibilityHarness />
        <Capture />
      </Providers>,
    )

    await waitFor(() => {
      expect(sessionApi).toBeTruthy()
      expect(sessionApi!.sessions.length).toBe(1)
      expect(sdk.session.syncVisible).toHaveBeenCalledWith({ body: { sessionIDs: [] } })
    })
    ;(sdk.session.syncVisible as any).mockClear()

    await act(async () => {
      await sessionApi!.switchSession("s1")
    })

    await waitFor(() => {
      expect(sessionApi!.currentSession?.id).toBe("s1")
      expect(sessionApi!.foregroundSessions.has("s1")).toBe(true)
    })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(sdk.session.syncVisible).not.toHaveBeenCalled()

    await act(async () => {
      load.resolve({
        error: null,
        data: [
          {
            info: {
              id: "u1",
              sessionID: "s1",
              role: "user",
              time: { created: 1 },
              agent: "plan",
              model: { providerID: "anthropic", modelID: "claude-4-sonnet" },
              variant: "high",
            },
            parts: [],
          },
        ],
      })
    })

    await waitFor(() => {
      expect(sdk.session.syncVisible).toHaveBeenCalledWith({ body: { sessionIDs: ["s1"] } })
    })
  })

  it("切到其他会话时会立即释放 pending latest 的 foreground session", async () => {
    ;(sdk.session.list as any).mockResolvedValue({
      data: [
        { id: "s1", title: "", time: { created: 1, updated: 1 } },
        { id: "s2", title: "", time: { created: 2, updated: 2 } },
      ],
      error: null,
    })

    const s1Messages = deferred<any>()
    const s2Messages = deferred<any>()
    let s1Signal: AbortSignal | undefined
    let s2Signal: AbortSignal | undefined
    ;(sdk.session.messages as any).mockImplementation(
      ({ path, signal }: { path: { id: string }; signal?: AbortSignal }) => {
        if (path.id === "s1") {
          s1Signal = signal
          return s1Messages.promise
        }
        s2Signal = signal
        return s2Messages.promise
      },
    )

    render(
      <Providers>
        <ActivationHarness />
        <Capture />
      </Providers>,
    )

    await waitFor(() => {
      expect(sessionApi).toBeTruthy()
      expect(sessionApi!.sessions.length).toBe(2)
    })

    await act(async () => {
      await sessionApi!.switchSession("s1")
    })

    await waitFor(() => {
      expect(sessionApi!.foregroundSessions.has("s1")).toBe(true)
      expect(s1Signal).toBeInstanceOf(AbortSignal)
      expect(s1Signal?.aborted).toBe(false)
    })

    await act(async () => {
      await sessionApi!.switchSession("s2")
    })

    await waitFor(() => {
      expect(sessionApi!.currentSession?.id).toBe("s2")
      expect(sessionApi!.foregroundSessions.has("s1")).toBe(false)
      expect(sessionApi!.foregroundSessions.has("s2")).toBe(true)
      expect(s1Signal?.aborted).toBe(true)
      expect(s2Signal).toBeInstanceOf(AbortSignal)
    })
  })

  it("卸载 activation hook 时会立即释放 pending older scan 的 foreground session", async () => {
    const older = deferred<any>()
    let olderSignal: AbortSignal | undefined
    ;(sdk.session.messages as any)
      .mockResolvedValueOnce({
        error: null,
        data: Array.from({ length: 50 }, (_, i) => ({
          info: {
            id: `a${i + 1}`,
            sessionID: "s1",
            role: "assistant",
            time: { created: i + 1 },
          },
          parts: [],
        })),
        response: {
          headers: new Headers({ "X-Next-Cursor": "c1" }),
        },
      })
      .mockImplementationOnce(({ signal }: { signal?: AbortSignal }) => {
        olderSignal = signal
        return older.promise
      })

    const view = render(
      <Providers>
        <ActivationToggle enabled={true} />
        <Capture />
      </Providers>,
    )

    await waitFor(() => {
      expect(sessionApi).toBeTruthy()
      expect(sessionApi!.sessions.length).toBe(1)
    })

    await act(async () => {
      await sessionApi!.switchSession("s1")
    })

    await waitFor(() => {
      expect(sdk.session.messages).toHaveBeenNthCalledWith(2, {
        path: { id: "s1" },
        query: { before: "c1", limit: 50 },
        signal: expect.any(AbortSignal),
      })
      expect(sessionApi!.foregroundSessions.has("s1")).toBe(true)
      expect(olderSignal).toBeInstanceOf(AbortSignal)
      expect(olderSignal?.aborted).toBe(false)
    })

    view.rerender(
      <Providers>
        <ActivationToggle enabled={false} />
        <Capture />
      </Providers>,
    )

    await waitFor(() => {
      expect(sessionApi!.foregroundSessions.has("s1")).toBe(false)
      expect(olderSignal?.aborted).toBe(true)
    })
  })

  it("手动 activate pending 时卸载 hook 也会立即释放 foreground session", async () => {
    const retryLoad = deferred<any>()
    ;(sdk.session.messages as any)
      .mockResolvedValueOnce({ error: { message: "boom" } })
      .mockReturnValueOnce(retryLoad.promise)

    const view = render(
      <Providers>
        <ActivationToggle enabled={true} />
        <Capture />
      </Providers>,
    )

    await waitFor(() => {
      expect(sessionApi).toBeTruthy()
      expect(activate).toBeTruthy()
      expect(sessionApi!.sessions.length).toBe(1)
    })

    await act(async () => {
      await sessionApi!.switchSession("s1")
    })

    await waitFor(() => {
      expect(sessionApi!.currentSession?.id).toBe("s1")
      expect(sessionApi!.selectionRestoreNotice).toContain("未能恢复")
      expect(sessionApi!.foregroundSessions.has("s1")).toBe(false)
    })

    act(() => {
      void activate!("s1")
    })

    await waitFor(() => {
      expect(sessionApi!.foregroundSessions.has("s1")).toBe(true)
    })

    view.rerender(
      <Providers>
        <ActivationToggle enabled={false} />
        <Capture />
      </Providers>,
    )

    await waitFor(() => {
      expect(sessionApi!.foregroundSessions.has("s1")).toBe(false)
    })
  })
})
