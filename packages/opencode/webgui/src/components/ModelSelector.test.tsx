import { beforeEach, describe, expect, it, vi } from "vitest"
import userEvent from "@testing-library/user-event"
import { render, screen, within } from "../test/test-utils"

vi.mock("../lib/api/sdkClient", () => {
  return {
    sdk: {
      config: {
        providers: vi.fn(),
      },
      state: {
        get: vi.fn(),
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
import { ModelSelector } from "./ModelSelector"

describe("ModelSelector favorites", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.resetAllMocks()
    ;(sdk.config.providers as any).mockResolvedValue({
      data: {
        providers: [
          {
            id: "openai",
            name: "OpenAI",
            models: {
              "gpt-4.1": {
                name: "GPT 4.1",
                capabilities: { reasoning: false },
              },
            },
          },
        ],
        default: { provider: "openai", model: "gpt-4.1" },
      },
      error: null,
    })
    ;(sdk.state.get as any).mockResolvedValue({
      data: {
        recently_used_models: [],
      },
      error: null,
    })
    ;(ideBridge.isInstalled as any).mockReturnValue(false)
    ;(ideBridge.request as any).mockResolvedValue({ ok: true, result: {} })
  })

  it("在下拉顶部展示 Favorites 分组（来自 localStorage）", async () => {
    localStorage.setItem("opencode_favorite_models_v1", JSON.stringify(["openai/gpt-4.1"]))

    render(<ModelSelector onSelect={() => {}} />)

    await screen.findByText("GPT 4.1")

    const user = userEvent.setup()
    await user.click(screen.getByTitle("Select model"))

    const input = screen.getByPlaceholderText("Search models...")
    const dropdown = input.closest("div")?.parentElement
    expect(dropdown).toBeTruthy()

    const ui = within(dropdown as HTMLElement)
    expect(ui.getByText("Favorites")).toBeInTheDocument()
    expect(ui.getByText("GPT 4.1")).toBeInTheDocument()
  })

  it("点击星标会切换收藏且不会触发选择", async () => {
    const onSelect = vi.fn()

    render(<ModelSelector onSelect={onSelect} />)
    await screen.findByText("GPT 4.1")

    const user = userEvent.setup()
    await user.click(screen.getByTitle("Select model"))

    const input = screen.getByPlaceholderText("Search models...")
    const dropdown = input.closest("div")?.parentElement
    expect(dropdown).toBeTruthy()

    const ui = within(dropdown as HTMLElement)
    expect(ui.queryByText("Favorites")).not.toBeInTheDocument()

    await user.click(ui.getByLabelText("Toggle favorite openai/gpt-4.1"))
    expect(onSelect).not.toHaveBeenCalled()

    expect(JSON.parse(localStorage.getItem("opencode_favorite_models_v1") || "[]")).toEqual(["openai/gpt-4.1"])
    expect(ui.getByText("Favorites")).toBeInTheDocument()
  })

  it("在 IDE 环境中会从 host storage 恢复收藏", async () => {
    ;(ideBridge.isInstalled as any).mockReturnValue(true)
    ;(ideBridge.request as any).mockImplementation(async (type: string) => {
      if (type === "storageGet") {
        return {
          ok: true,
          result: {
            opencode_favorite_models_v1: JSON.stringify(["openai/gpt-4.1"]),
          },
        }
      }
      return { ok: true }
    })

    render(<ModelSelector onSelect={() => {}} />)

    await screen.findByText("GPT 4.1")

    const user = userEvent.setup()
    await user.click(screen.getByTitle("Select model"))

    const input = screen.getByPlaceholderText("Search models...")
    const dropdown = input.closest("div")?.parentElement
    expect(dropdown).toBeTruthy()

    const ui = within(dropdown as HTMLElement)
    expect(ui.getByText("Favorites")).toBeInTheDocument()
    expect(ideBridge.request).toHaveBeenCalledWith("storageGet", {
      keys: ["opencode_favorite_models_v1"],
    })
  })

  it("在 IDE 环境中切换收藏会同步到 host storage", async () => {
    ;(ideBridge.isInstalled as any).mockReturnValue(true)
    ;(ideBridge.request as any).mockResolvedValue({ ok: true, result: {} })

    const user = userEvent.setup()
    render(<ModelSelector onSelect={() => {}} />)
    await screen.findByText("GPT 4.1")
    await user.click(screen.getByTitle("Select model"))

    const input = screen.getByPlaceholderText("Search models...")
    const dropdown = input.closest("div")?.parentElement
    const ui = within(dropdown as HTMLElement)

    await user.click(ui.getByLabelText("Toggle favorite openai/gpt-4.1"))

    expect(ideBridge.request).toHaveBeenCalledWith("storageSet", {
      key: "opencode_favorite_models_v1",
      value: JSON.stringify(["openai/gpt-4.1"]),
    })
  })
})
