import { describe, expect, it, vi, beforeEach } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"

vi.mock("../lib/api/sdkClient", () => {
  return {
    sdk: {
      state: {
        get: vi.fn(),
        update: vi.fn(),
      },
      config: {
        get: vi.fn(),
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

vi.mock("../lib/api/events", () => {
  return {
    eventEmitter: {
      on: vi.fn(() => () => {}),
    },
  }
})

import { sdk } from "../lib/api/sdkClient"
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
    ;(sdk.state.update as any).mockResolvedValue({ data: {}, error: null })
  })

  it("session context still initializes model and agent from state api", async () => {
    ;(sdk.state.get as any).mockResolvedValue({
      data: {
        agent: "plan",
        provider: "openai",
        model: "gpt-4.1",
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
    ;(sdk.state.get as any).mockResolvedValue({ data: {}, error: null })

    const { result } = renderHook(() => useSession(), { wrapper })

    await act(async () => {
      await result.current.retrySession("s1")
    })

    expect(sdk.session.retry).toHaveBeenCalledWith({
      path: { sessionID: "s1" },
    })
  })
})
