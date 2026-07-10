import { beforeEach, describe, expect, it, vi } from "vitest"
import userEvent from "@testing-library/user-event"
import { act, render, screen, within, waitFor } from "../test/test-utils"

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
        default: { openai: "gpt-4.1" },
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

    const clearBtn = screen.getByRole("button", { name: "默认" })
    expect(clearBtn).toHaveAttribute("type", "button")

    await user.click(clearBtn)

    expect(onClear).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.queryByPlaceholderText("搜索模型…")).not.toBeInTheDocument()
  })

  it("未选择模型时使用传入的 placeholder，provider 加载后仍稳定显示", async () => {
    render(<ModelSelector onSelect={() => {}} placeholder="默认" />)
    await screen.findByText("默认")

    // 打开 dropdown，等待 provider 数据加载完成（GPT 4.1 出现在列表中）
    const user = userEvent.setup()
    await user.click(screen.getByTitle("选择模型"))
    await screen.findByRole("button", { name: /切换收藏 openai\/gpt-4\.1/ })

    // 关闭 dropdown 后 trigger 仍稳定显示 placeholder 而非 SDK 默认模型名
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByPlaceholderText("搜索模型…")).not.toBeInTheDocument())
    expect(screen.getByTitle("选择模型")).toHaveTextContent("默认")
  })

  it("按 provider ID 显示默认模型并标记默认项", async () => {
    render(
      <ModelSelector
        onSelect={() => {}}
        providersData={[
          {
            id: "openai",
            name: "OpenAI",
            models: { "gpt-5": { name: "GPT 5", capabilities: { reasoning: false } } },
          },
        ] as any}
        defaultIdsData={{ openai: "gpt-5" }}
      />,
    )

    expect(screen.getByTitle("选择模型")).toHaveTextContent("GPT 5")
    const user = userEvent.setup()
    await user.click(screen.getByTitle("选择模型"))
    expect(screen.getByText("默认")).toBeInTheDocument()
  })

  it("invalid selected pair falls back to the valid provider default", async () => {
    render(<ModelSelector selectedProviderId="openai" selectedModelId="unknown-model" onSelect={() => {}} />)
    await screen.findByText("GPT 4.1")

    // 打开 dropdown 确认 provider 已加载，trigger 仍为有效默认模型
    const user = userEvent.setup()
    await user.click(screen.getByTitle("选择模型"))
    await screen.findByRole("button", { name: /切换收藏 openai\/gpt-4\.1/ })
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByPlaceholderText("搜索模型…")).not.toBeInTheDocument())
    expect(screen.getByTitle("选择模型")).toHaveTextContent("GPT 4.1")
  })

  it("默认不显示清空入口", async () => {
    render(<ModelSelector selectedProviderId="openai" selectedModelId="gpt-4.1" onSelect={() => {}} />)
    await screen.findByText("GPT 4.1")

    const user = userEvent.setup()
    await user.click(screen.getByTitle("选择模型"))

    expect(screen.queryByRole("button", { name: "默认" })).not.toBeInTheDocument()
  })

  it("键盘激活星标按钮不触发模型选择", async () => {
    const onSelect = vi.fn()
    render(<ModelSelector onSelect={onSelect} />)
    await screen.findByText("GPT 4.1")

    const user = userEvent.setup()
    await user.click(screen.getByTitle("选择模型"))

    const starBtn = screen.getByLabelText("切换收藏 openai/gpt-4.1")
    starBtn.focus()

    // Enter 不应触发 onSelect
    await user.keyboard("{Enter}")
    expect(onSelect).not.toHaveBeenCalled()

    // Space 不应触发 onSelect
    await user.keyboard(" ")
    expect(onSelect).not.toHaveBeenCalled()

    // 收藏逻辑被触发
    await waitFor(() => {
      expect(repo.updateModelPrefs).toHaveBeenCalled()
    })
  })

  it("partial provider selection falls back to the default", async () => {
    render(<ModelSelector selectedProviderId="openai" onSelect={() => {}} />)
    await screen.findByText("GPT 4.1")

    // 打开 dropdown 确认 provider 已加载
    const user = userEvent.setup()
    await user.click(screen.getByTitle("选择模型"))
    await screen.findByRole("button", { name: /切换收藏 openai\/gpt-4\.1/ })

    // 关闭后 trigger 仍为默认模型，不出现 openai/undefined
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByPlaceholderText("搜索模型…")).not.toBeInTheDocument())
    expect(screen.getByTitle("选择模型")).toHaveTextContent("GPT 4.1")
    expect(screen.queryByText("openai/undefined")).not.toBeInTheDocument()
  })

  it("partial model selection falls back to the default", async () => {
    render(<ModelSelector selectedModelId="gpt-4.1" onSelect={() => {}} />)
    await screen.findByText("GPT 4.1")

    // 打开 dropdown 确认 provider 已加载
    const user = userEvent.setup()
    await user.click(screen.getByTitle("选择模型"))
    await screen.findByRole("button", { name: /切换收藏 openai\/gpt-4\.1/ })

    // 关闭后 trigger 仍为默认模型，不出现 undefined/gpt-4.1
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByPlaceholderText("搜索模型…")).not.toBeInTheDocument())
    expect(screen.getByTitle("选择模型")).toHaveTextContent("GPT 4.1")
    expect(screen.queryByText("undefined/gpt-4.1")).not.toBeInTheDocument()
  })

  it("dropdownPlacement='bottom' 时 dropdown 使用 top-full mt-1", async () => {
    render(
      <ModelSelector
        selectedProviderId="openai"
        selectedModelId="gpt-4.1"
        onSelect={() => {}}
        dropdownPlacement="bottom"
      />,
    )
    await screen.findByText("GPT 4.1")

    const user = userEvent.setup()
    await user.click(screen.getByTitle("选择模型"))

    const input = screen.getByPlaceholderText("搜索模型…")
    const dropdown = input.closest("div")?.parentElement
    expect(dropdown).toBeTruthy()
    expect((dropdown as HTMLElement).className).toContain("top-full")
    expect((dropdown as HTMLElement).className).toContain("mt-1")
    expect((dropdown as HTMLElement).className).not.toContain("bottom-full")
    expect((dropdown as HTMLElement).className).not.toContain("mb-1")
  })

  it("opening a second selector refreshes prefs to show latest recent/favorite", async () => {
    // First render: loadModelPrefs returns empty
    repo.loadModelPrefs.mockResolvedValue({ recent: [], favorite: [] })

    const { container } = render(
      <div>
        <ModelSelector onSelect={() => {}} />
        <ModelSelector onSelect={() => {}} />
      </div>,
    )
    // Wait for both to load
    const buttons = await screen.findAllByTitle("选择模型")
    expect(buttons).toHaveLength(2)

    const user = userEvent.setup()

    // Open first selector
    await user.click(buttons[0])
    expect(screen.getByPlaceholderText("搜索模型…")).toBeInTheDocument()

    // Simulate that after first selector interaction, prefs now have a recent entry
    repo.loadModelPrefs.mockResolvedValue({
      recent: [{ providerID: "openai", modelID: "gpt-4.1" }],
      favorite: [],
    })

    // Close first selector via Escape
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByPlaceholderText("搜索模型…")).not.toBeInTheDocument())

    // Open second selector — it should refresh prefs and show "最近" section
    await user.click(buttons[1])
    await waitFor(() => {
      expect(screen.getByText("最近")).toBeInTheDocument()
    })

    // The recent model should be visible
    const dropdown = screen.getByPlaceholderText("搜索模型…").closest("div")?.parentElement
    expect(dropdown).toBeTruthy()
    const ui = within(dropdown as HTMLElement)
    expect(ui.getByText("最近")).toBeInTheDocument()
  })

  it("portal dropdown repositions on window scroll", async () => {
    render(
      <ModelSelector
        selectedProviderId="openai"
        selectedModelId="gpt-4.1"
        onSelect={() => {}}
        renderInPortal
        dropdownPlacement="bottom"
      />,
    )
    await screen.findByText("GPT 4.1")

    const button = screen.getByTitle("选择模型")
    const rects = [
      { left: 12, bottom: 44, top: 20, width: 180 },
      { left: 30, bottom: 90, top: 66, width: 220 },
    ]
    vi.spyOn(button, "getBoundingClientRect").mockImplementation(
      () => ({ ...rects.shift()!, right: 0, height: 24, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    )

    const user = userEvent.setup()
    await user.click(button)
    const portal = await screen.findByTestId("model-selector-portal")
    await waitFor(() => expect(portal).toHaveStyle({ top: "48px", left: "12px", minWidth: "300px" }))

    act(() => {
      window.dispatchEvent(new Event("scroll"))
    })

    await waitFor(() => expect(portal).toHaveStyle({ top: "94px", left: "30px", minWidth: "300px" }))
  })

  it("portal dropdown repositions on window resize", async () => {
    render(
      <ModelSelector
        selectedProviderId="openai"
        selectedModelId="gpt-4.1"
        onSelect={() => {}}
        renderInPortal
        dropdownPlacement="bottom"
      />,
    )
    await screen.findByText("GPT 4.1")

    const button = screen.getByTitle("选择模型")
    const rects = [
      { left: 12, bottom: 44, top: 20, width: 180 },
      { left: 40, bottom: 110, top: 86, width: 260 },
    ]
    vi.spyOn(button, "getBoundingClientRect").mockImplementation(
      () => ({ ...rects.shift()!, right: 0, height: 24, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    )

    const user = userEvent.setup()
    await user.click(button)
    const portal = await screen.findByTestId("model-selector-portal")
    await waitFor(() => expect(portal).toHaveStyle({ top: "48px", left: "12px", minWidth: "300px" }))

    act(() => {
      window.dispatchEvent(new Event("resize"))
    })

    await waitFor(() => expect(portal).toHaveStyle({ top: "114px", left: "40px", minWidth: "300px" }))
  })

  it("portal dropdown repositions on ancestor container scroll (capture)", async () => {
    const { container } = render(
      <div data-testid="scroll-container" style={{ overflow: "auto", height: "200px" }}>
        <ModelSelector
          selectedProviderId="openai"
          selectedModelId="gpt-4.1"
          onSelect={() => {}}
          renderInPortal
          dropdownPlacement="bottom"
        />
      </div>,
    )
    await screen.findByText("GPT 4.1")

    const button = screen.getByTitle("选择模型")
    const rects = [
      { left: 10, bottom: 50, top: 26, width: 200 },
      { left: 10, bottom: 30, top: 6, width: 200 },
    ]
    vi.spyOn(button, "getBoundingClientRect").mockImplementation(
      () => ({ ...rects.shift()!, right: 0, height: 24, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
    )

    const user = userEvent.setup()
    await user.click(button)
    const portal = await screen.findByTestId("model-selector-portal")
    await waitFor(() => expect(portal).toHaveStyle({ top: "54px", left: "10px", minWidth: "300px" }))

    // Scroll the ancestor container (not window)
    const scrollContainer = screen.getByTestId("scroll-container")
    act(() => {
      scrollContainer.dispatchEvent(new Event("scroll", { bubbles: false }))
    })

    await waitFor(() => expect(portal).toHaveStyle({ top: "34px", left: "10px", minWidth: "300px" }))
  })
})
