import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { AgentConfigTab } from "./AgentConfigTab"

vi.mock("../../lib/api/sdkClient", () => ({
  sdk: {
    app: {
      agents: vi.fn(),
    },
    config: {
      providers: vi.fn(),
    },
    global: {
      config: {
        get: vi.fn(),
      },
    },
  },
}))

vi.mock("../../state/repo/modelPrefsRepo", () => ({
  loadModelPrefs: vi.fn().mockResolvedValue({ recent: [], favorite: [] }),
  addRecentModel: vi.fn().mockResolvedValue({ recent: [], favorite: [] }),
  updateModelPrefs: vi.fn().mockResolvedValue({ recent: [], favorite: [] }),
}))

import { sdk } from "../../lib/api/sdkClient"

const mockAgents = [
  { name: "build", mode: "primary", description: "Build agent" },
  { name: "explore", mode: "subagent", description: "Explore agent" },
  { name: "title", mode: "primary", description: "Title agent" },
]

const mockProviders = {
  providers: [
    {
      id: "openai",
      name: "OpenAI",
      models: {
        "gpt-5.5": {
          name: "GPT-5.5",
          capabilities: {},
          variants: { low: {}, medium: {}, high: {} },
        },
        "gpt-4o": {
          name: "GPT-4o",
          capabilities: {},
          variants: { low: {}, high: {} },
        },
        "family/model-v1": {
          name: "Family Model V1",
          capabilities: {},
          variants: {},
        },
      },
    },
    {
      id: "anthropic",
      name: "Anthropic",
      models: {
        "claude-opus-4-6": {
          name: "Claude Opus 4.6",
          capabilities: {},
          variants: { medium: {}, high: {}, xhigh: {} },
        },
      },
    },
  ],
  default: { provider: "openai", model: "gpt-5.5" },
}

const mockedSdk = vi.mocked(sdk, { deep: true })

function setup(formData = {}, setFormData = vi.fn(), onReloadConfig = vi.fn()) {
  mockedSdk.app.agents.mockResolvedValue({ data: mockAgents, error: null } as any)
  mockedSdk.config.providers.mockResolvedValue({ data: mockProviders, error: null } as any)
  mockedSdk.global.config.get.mockResolvedValue({ data: formData, error: null } as any)

  const result = render(
    <AgentConfigTab formData={formData} setFormData={setFormData} onReloadConfig={onReloadConfig} />,
  )
  return { ...result, setFormData, onReloadConfig }
}

/** Wait for a row's model picker button to become interactive */
async function waitForPickerReady(rowName = "build") {
  await waitFor(() => {
    const row = screen.getByText(rowName).closest("tr")!
    expect(within(row).getByTitle("选择模型")).not.toBeDisabled()
  })
}

/** Get the portal dropdown container */
function getPortalDropdown() {
  return screen.getByTestId("model-selector-portal")
}

describe("AgentConfigTab", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("shows loading state initially", () => {
    mockedSdk.app.agents.mockReturnValue(new Promise(() => {}) as any)
    mockedSdk.config.providers.mockReturnValue(new Promise(() => {}) as any)
    render(<AgentConfigTab formData={{}} setFormData={vi.fn()} />)
    expect(screen.getByText("正在加载 Agent 配置…")).toBeInTheDocument()
  })

  it("renders agent rows after load", async () => {
    setup()
    await waitFor(() => {
      expect(screen.getByText("build")).toBeInTheDocument()
      expect(screen.getByText("explore")).toBeInTheDocument()
      expect(screen.getByText("title")).toBeInTheDocument()
    })
  })

  it("configured agents appear before unconfigured", async () => {
    const formData = {
      agent: {
        explore: { model: "anthropic/claude-opus-4-6", variant: "high" },
      },
    }
    setup(formData)
    await waitFor(() => {
      expect(screen.getByText("explore")).toBeInTheDocument()
    })
    const rows = screen.getAllByRole("row")
    // First data row (index 1, after header) should be "explore" (configured)
    expect(rows[1]).toHaveTextContent("explore")
  })

  it("selecting model with the search picker updates formData", async () => {
    const user = userEvent.setup()
    const { setFormData } = setup()
    await waitForPickerReady()

    const buildRow = screen.getByText("build").closest("tr")!
    await user.click(within(buildRow).getByTitle("选择模型"))
    const portal = getPortalDropdown()
    await user.type(within(portal).getByPlaceholderText("搜索模型…"), "gpt-5.5")
    await user.click(within(portal).getByRole("button", { name: /GPT-5.5/ }))

    expect(setFormData).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({
          build: expect.objectContaining({ model: "openai/gpt-5.5" }),
        }),
      }),
    )
  })

  it("changing model clears incompatible variant", async () => {
    const user = userEvent.setup()
    const formData = {
      agent: {
        build: { model: "anthropic/claude-opus-4-6", variant: "xhigh" },
      },
    }
    const { setFormData } = setup(formData)
    await waitForPickerReady()

    const buildRow = screen.getByText("build").closest("tr")!
    await user.click(within(buildRow).getByTitle("选择模型"))
    const portal = getPortalDropdown()
    await user.type(within(portal).getByPlaceholderText("搜索模型…"), "gpt-5.5")
    await user.click(within(portal).getByRole("button", { name: /GPT-5.5/ }))

    expect(setFormData).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({
          build: expect.objectContaining({ model: "openai/gpt-5.5", variant: undefined }),
        }),
      }),
    )
  })

  it("clearing model with the picker preserves other agent fields", async () => {
    const user = userEvent.setup()
    const formData = {
      agent: {
        build: { model: "openai/gpt-5.5", variant: "high", prompt: "custom prompt", temperature: 0.7 },
      },
    }
    const { setFormData } = setup(formData)
    await waitForPickerReady()

    const buildRow = screen.getByText("build").closest("tr")!
    await user.click(within(buildRow).getByTitle("选择模型"))
    const portal = getPortalDropdown()
    await user.click(within(portal).getByRole("button", { name: "默认" }))

    const call = setFormData.mock.calls[setFormData.mock.calls.length - 1][0]
    expect(call.agent.build.prompt).toBe("custom prompt")
    expect(call.agent.build.temperature).toBe(0.7)
    expect(call.agent.build.model).toBeUndefined()
    expect(call.agent.build.variant).toBeUndefined()
  })

  it("model id containing slash is parsed and written correctly", async () => {
    const user = userEvent.setup()
    const formData = {
      agent: {
        build: { model: "openai/family/model-v1" },
      },
    }
    const { setFormData } = setup(formData)
    await waitForPickerReady()

    // Verify display: the picker should show the model name resolved from providers
    const buildRow = screen.getByText("build").closest("tr")!
    expect(within(buildRow).getByTitle("选择模型")).toHaveTextContent("Family Model V1")

    // Select a different model and verify the slash-containing id round-trips
    await user.click(within(buildRow).getByTitle("选择模型"))
    const portal = getPortalDropdown()
    await user.type(within(portal).getByPlaceholderText("搜索模型…"), "Family")
    await user.click(within(portal).getByRole("button", { name: /Family Model V1/ }))

    expect(setFormData).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({
          build: expect.objectContaining({ model: "openai/family/model-v1" }),
        }),
      }),
    )
  })

  it("portal dropdown renders outside the table DOM subtree", async () => {
    const user = userEvent.setup()
    setup()
    await waitForPickerReady()

    const buildRow = screen.getByText("build").closest("tr")!
    await user.click(within(buildRow).getByTitle("选择模型"))

    const portal = getPortalDropdown()
    const table = screen.getByRole("table")
    // Portal dropdown should NOT be inside the table
    expect(table.contains(portal)).toBe(false)
    // It should be a direct child of document.body
    expect(portal.parentElement).toBe(document.body)
  })

  it("model column has no native select elements (only variant column)", async () => {
    setup()
    await waitForPickerReady()

    const rows = screen.getAllByRole("row").slice(1) // skip header
    for (const row of rows) {
      const selects = row.querySelectorAll("select")
      // Each row should have at most 1 select (the variant selector)
      expect(selects.length).toBeLessThanOrEqual(1)
      // No select should have optgroup (which the old model select had)
      for (const sel of selects) {
        expect(sel.querySelector("optgroup")).toBeNull()
      }
    }
  })

  it("loads providers once even with multiple agent rows and opened pickers", async () => {
    const user = userEvent.setup()
    setup()
    await waitForPickerReady("build")
    await waitForPickerReady("explore")
    expect(mockedSdk.config.providers).toHaveBeenCalledTimes(1)

    const buildRow = screen.getByText("build").closest("tr")!
    await user.click(within(buildRow).getByTitle("选择模型"))
    await user.keyboard("{Escape}")

    const exploreRow = screen.getByText("explore").closest("tr")!
    await user.click(within(exploreRow).getByTitle("选择模型"))

    expect(mockedSdk.config.providers).toHaveBeenCalledTimes(1)
  })

  it("reload button re-fetches config", async () => {
    const user = userEvent.setup()
    const { onReloadConfig } = setup()
    await waitFor(() => {
      expect(screen.getByText("build")).toBeInTheDocument()
    })

    await user.click(screen.getByTitle("重新加载配置"))
    expect(mockedSdk.global.config.get).toHaveBeenCalled()
  })
})
