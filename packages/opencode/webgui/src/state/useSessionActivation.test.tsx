import { act, render, waitFor } from "../test/test-utils"
import { beforeEach, describe, expect, it, vi } from "vitest"
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
        get: vi.fn(),
        diff: vi.fn(),
        messages: vi.fn(),
        retry: vi.fn(),
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
import { SessionProvider, useSession } from "./SessionContext"
import { useSessionActivation } from "./useSessionActivation"

let sessionApi: ReturnType<typeof useSession> | null = null

function Capture() {
  sessionApi = useSession()
  return null
}

function ActivationHarness() {
  useSessionActivation()
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
    sessionApi = null
    localStorage.clear()
    vi.resetAllMocks()
    ;(ideBridge.isInstalled as any).mockReturnValue(false)
    ;(ideBridge.request as any).mockResolvedValue({ ok: true, result: {} })
    ;(sdk.session.list as any).mockResolvedValue({
      data: [{ id: "s1", title: "", time: { created: 1, updated: 1 } }],
      error: null,
    })
    ;(sdk.session.diff as any).mockResolvedValue({ data: [], error: null })
    ;(sdk.session.get as any).mockResolvedValue({ data: null, error: null })
    ;(sdk.kv.get as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.kv.update as any).mockResolvedValue({ data: {}, error: null })
    ;(sdk.model.get as any).mockResolvedValue({ data: { recent: [], favorite: [], variant: {} }, error: null })
    ;(sdk.model.update as any).mockResolvedValue({ data: {}, error: null })
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

    await act(async () => {
      await sessionApi!.switchSession("s1")
    })

    await waitFor(() => {
      expect(sdk.session.messages).toHaveBeenCalledWith({ path: { id: "s1" } })
    })

    await act(async () => {
      await sessionApi!.switchSession("s2")
    })

    await waitFor(() => {
      expect(sdk.session.messages).toHaveBeenCalledWith({ path: { id: "s2" } })
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
})
