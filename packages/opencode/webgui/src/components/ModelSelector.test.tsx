import { beforeEach, describe, expect, it, vi } from "vitest"
import userEvent from "@testing-library/user-event"
import { render, screen, within, waitFor } from "../test/test-utils"

vi.mock("../lib/api/sdkClient", () => ({
  sdk: {
    config: {
      providers: vi.fn(),
    },
  },
}))

const repo = vi.hoisted(() => ({
  loadModelPrefs: vi.fn(),
  updateModelPrefs: vi.fn(),
  addRecentModel: vi.fn(),
}))

vi.mock("../state/repo/modelPrefsRepo", () => ({
  loadModelPrefs: (...args: unknown[]) => repo.loadModelPrefs(...args),
  updateModelPrefs: (...args: unknown[]) => repo.updateModelPrefs(...args),
  addRecentModel: (...args: unknown[]) => repo.addRecentModel(...args),
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
    repo.loadModelPrefs.mockResolvedValue({
      recent: [],
      favorite: [],
    })
    repo.updateModelPrefs.mockResolvedValue({ recent: [], favorite: [] })
    repo.addRecentModel.mockResolvedValue({ recent: [], favorite: [] })
  })

  it("在下拉顶部展示收藏分组（来自 sdk.model）", async () => {
    repo.loadModelPrefs.mockResolvedValue({
      recent: [],
      favorite: [{ providerID: "openai", modelID: "gpt-4.1" }],
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
      expect(repo.updateModelPrefs).toHaveBeenCalledTimes(1)
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

  it("显示清空入口并在点击时调用 onClear，且关闭 dropdown", async () => {
    const onSelect = vi.fn()
    const onClear = vi.fn()
    render(
      <ModelSelector
        selectedProviderId="openai"
        selectedModelId="gpt-4.1"
        onSelect={onSelect}
        allowClear
        clearLabel="默认"
        onClear={onClear}
      />,
    )
    await screen.findByText("GPT 4.1")

    const user = userEvent.setup()
    await user.click(screen.getByTitle("选择模型"))
    expect(screen.getByPlaceholderText("搜索模型…")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "默认" }))

    expect(onClear).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText("搜索模型…")).not.toBeInTheDocument()
  })

  it("未选择模型时使用传入的 placeholder，provider 加载后仍稳定显示", async () => {
    render(<ModelSelector onSelect={() => {}} placeholder="默认" />)
    await screen.findByText("默认")

    // provider 加载完成后按钮仍显示 placeholder 而非 SDK 默认模型名
    await waitFor(() => expect(screen.queryByText("GPT 4.1")).not.toBeInTheDocument())
    expect(screen.getByTitle("选择模型")).toHaveTextContent("默认")
  })

  it("unknown selected model 显示 provider/model", async () => {
    render(<ModelSelector selectedProviderId="openai" selectedModelId="unknown-model" onSelect={() => {}} />)
    await screen.findByText("openai/unknown-model")
  })

  it("默认不显示清空入口", async () => {
    render(<ModelSelector selectedProviderId="openai" selectedModelId="gpt-4.1" onSelect={() => {}} />)
    await screen.findByText("GPT 4.1")

    const user = userEvent.setup()
    await user.click(screen.getByTitle("选择模型"))

    expect(screen.queryByRole("button", { name: "默认" })).not.toBeInTheDocument()
  })
})
