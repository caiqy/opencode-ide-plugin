import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  providers: vi.fn(),
  session: { currentSession: { id: "session-a" }, selectedProviderId: undefined, selectedModelId: undefined },
}))

vi.mock("../lib/api/sdkClient", () => ({ sdk: { config: { providers: mocks.providers } } }))
vi.mock("../state/MessagesContext", () => ({ useMessages: () => ({ messages: [] }) }))
vi.mock("../state/SessionContext", () => ({ useSession: () => mocks.session }))

import { useSessionUsage } from "./useSessionUsage"

describe("useSessionUsage", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.session.currentSession = { id: "session-a" }
    mocks.session.selectedProviderId = undefined
    mocks.session.selectedModelId = undefined
  })

  it("uses the first valid provider default when selection is absent", async () => {
    mocks.providers.mockResolvedValue({
      data: {
        providers: [
          { id: "openai", models: { "gpt-5": { limit: { context: 200000 } } } },
          { id: "other", models: { "other-model": { limit: { context: 1000 } } } },
        ],
        default: { openai: "gpt-5" },
      },
    })

    const { result } = renderHook(() => useSessionUsage())

    await waitFor(() => expect(result.current.contextLimit).toBe(200000))
  })

  it("uses the default for partial or invalid selections but preserves a valid explicit pair", async () => {
    mocks.providers.mockResolvedValue({
      data: {
        providers: [
          { id: "openai", models: { "gpt-5": { limit: { context: 200000 } }, "gpt-4": { limit: { context: 128000 } } } },
        ],
        default: { missing: "none", openai: "gpt-5" },
      },
    })
    mocks.session.selectedProviderId = "openai"
    const { result, rerender } = renderHook(() => useSessionUsage())
    await waitFor(() => expect(result.current.contextLimit).toBe(200000))

    mocks.session.selectedModelId = "missing"
    rerender()
    await waitFor(() => expect(mocks.providers).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.contextLimit).toBe(200000))

    mocks.session.selectedModelId = "gpt-4"
    rerender()
    await waitFor(() => expect(mocks.providers).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(result.current.contextLimit).toBe(128000))
  })

  it("ignores a previous session's late provider response", async () => {
    let resolveFirst!: (value: unknown) => void
    const first = new Promise((resolve) => {
      resolveFirst = resolve
    })
    mocks.providers.mockReturnValueOnce(first).mockResolvedValueOnce({
      data: { providers: [{ id: "new", models: { model: { limit: { context: 1000 } } } }], default: { new: "model" } },
    })

    const { result, rerender } = renderHook(() => useSessionUsage())
    mocks.session.currentSession = { id: "session-b" }
    rerender()
    await waitFor(() => expect(result.current.contextLimit).toBe(1000))

    await act(async () => {
      resolveFirst({
        data: { providers: [{ id: "old", models: { model: { limit: { context: 200000 } } } }], default: { old: "model" } },
      })
    })

    expect(result.current.contextLimit).toBe(1000)
  })
})
