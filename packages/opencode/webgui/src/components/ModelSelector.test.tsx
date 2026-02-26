import { beforeEach, describe, expect, it, vi } from "vitest"
import userEvent from "@testing-library/user-event"
import { render, screen, within, waitFor } from "../test/test-utils"

vi.mock("../lib/api/sdkClient", () => ({
  sdk: {
    config: {
      providers: vi.fn(),
    },
    model: {
      get: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock("../lib/ideBridge", () => ({
  ideBridge: {
    isInstalled: vi.fn(),
    request: vi.fn(),
  },
}))

import { sdk } from "../lib/api/sdkClient"
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
    ;(sdk.model.get as any).mockResolvedValue({
      data: {
        recent: [],
        favorite: [],
      },
      error: null,
    })
    ;(sdk.model.update as any).mockResolvedValue({ data: { recent: [], favorite: [] }, error: null })
  })

  it("在下拉顶部展示收藏分组（来自 sdk.model）", async () => {
    ;(sdk.model.get as any).mockResolvedValue({
      data: {
        recent: [],
        favorite: [{ providerID: "openai", modelID: "gpt-4.1" }],
      },
      error: null,
    })

    render(<ModelSelector onSelect={() => {}} />)
    await screen.findByText("GPT 4.1")

    const user = userEvent.setup()
    await user.click(screen.getByTitle("选择模型"))

    const input = screen.getByPlaceholderText("搜索模型…")
    const dropdown = input.closest("div")?.parentElement
    expect(dropdown).toBeTruthy()

    const ui = within(dropdown as HTMLElement)
    expect(ui.getByText("收藏")).toBeInTheDocument()
    expect(ui.getByText("GPT 4.1")).toBeInTheDocument()
  })

  it("不读取历史 localStorage 收藏键", async () => {
    localStorage.setItem("opencode_favorite_models_v1", JSON.stringify(["openai/gpt-4.1"]))
    const getSpy = vi.spyOn(Storage.prototype, "getItem")

    render(<ModelSelector onSelect={() => {}} />)
    await screen.findByText("GPT 4.1")

    expect(getSpy).not.toHaveBeenCalledWith("opencode_favorite_models_v1")
  })

  it("点击星标会切换收藏且不会触发选择，也不写 localStorage", async () => {
    const onSelect = vi.fn()
    const setSpy = vi.spyOn(Storage.prototype, "setItem")
    render(<ModelSelector onSelect={onSelect} />)
    await screen.findByText("GPT 4.1")

    const user = userEvent.setup()
    await user.click(screen.getByTitle("选择模型"))

    const input = screen.getByPlaceholderText("搜索模型…")
    const dropdown = input.closest("div")?.parentElement
    expect(dropdown).toBeTruthy()

    const ui = within(dropdown as HTMLElement)
    expect(ui.queryByText("收藏")).not.toBeInTheDocument()

    await user.click(ui.getByLabelText("切换收藏 openai/gpt-4.1"))
    expect(onSelect).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(sdk.model.update).toHaveBeenCalledWith({
        body: {
          favorite: [{ providerID: "openai", modelID: "gpt-4.1" }],
        },
      })
    })
    expect(setSpy).not.toHaveBeenCalled()
  })

  it("选中模型使用前置亮点，且不再显示末尾勾选图标", async () => {
    render(<ModelSelector selectedProviderId="openai" selectedModelId="gpt-4.1" onSelect={() => {}} />)
    await screen.findByText("GPT 4.1")

    const user = userEvent.setup()
    await user.click(screen.getByTitle("选择模型"))

    const input = screen.getByPlaceholderText("搜索模型…")
    const dropdown = input.closest("div")?.parentElement
    expect(dropdown).toBeTruthy()

    const ui = within(dropdown as HTMLElement)
    const selectedRow = ui.getByText("GPT 4.1").closest("[role='button']")
    expect(selectedRow).toBeTruthy()

    const leadingDot = (selectedRow as HTMLElement).querySelector("[data-slot='model-selection-indicator']")
    expect(leadingDot).toBeInTheDocument()

    const legacyCheckPath = (selectedRow as HTMLElement).querySelector(
      "svg path[d='M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z']",
    )
    expect(legacyCheckPath).not.toBeInTheDocument()
  })
})
