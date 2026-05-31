import { describe, expect, it, vi, beforeEach } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
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
          variants: { low: {}, medium: {}, high: {} },
        },
        "gpt-4o": {
          name: "GPT-4o",
          variants: { low: {}, high: {} },
        },
      },
    },
    {
      id: "anthropic",
      name: "Anthropic",
      models: {
        "claude-opus-4-6": {
          name: "Claude Opus 4.6",
          variants: { medium: {}, high: {}, xhigh: {} },
        },
      },
    },
  ],
}

function setup(formData = {}, setFormData = vi.fn(), onReloadConfig = vi.fn()) {
  ;(sdk.app.agents as any).mockResolvedValue({ data: mockAgents, error: null })
  ;(sdk.config.providers as any).mockResolvedValue({ data: mockProviders, error: null })
  ;(sdk.global.config.get as any).mockResolvedValue({ data: formData, error: null })

  const result = render(
    <AgentConfigTab formData={formData} setFormData={setFormData} onReloadConfig={onReloadConfig} />,
  )
  return { ...result, setFormData, onReloadConfig }
}

describe("AgentConfigTab", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("shows loading state initially", () => {
    ;(sdk.app.agents as any).mockReturnValue(new Promise(() => {})) // never resolves
    ;(sdk.config.providers as any).mockReturnValue(new Promise(() => {}))
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

  it("selecting model updates formData", async () => {
    const user = userEvent.setup()
    const { setFormData } = setup()
    await waitFor(() => {
      expect(screen.getByText("build")).toBeInTheDocument()
    })

    const buildRow = screen.getByText("build").closest("tr")!
    const modelSelect = buildRow.querySelectorAll("select")[0]

    await user.selectOptions(modelSelect, "openai/gpt-5.5")
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
    await waitFor(() => {
      expect(screen.getByText("build")).toBeInTheDocument()
    })

    const buildRow = screen.getByText("build").closest("tr")!
    const modelSelect = buildRow.querySelectorAll("select")[0]

    // Change to openai/gpt-5.5 which doesn't have "xhigh" variant
    await user.selectOptions(modelSelect, "openai/gpt-5.5")
    expect(setFormData).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: expect.objectContaining({
          build: expect.objectContaining({ model: "openai/gpt-5.5", variant: undefined }),
        }),
      }),
    )
  })

  it("clearing model/variant preserves other agent fields", async () => {
    const user = userEvent.setup()
    const formData = {
      agent: {
        build: { model: "openai/gpt-5.5", variant: "high", prompt: "custom prompt", temperature: 0.7 },
      },
    }
    const { setFormData } = setup(formData)
    await waitFor(() => {
      expect(screen.getByText("build")).toBeInTheDocument()
    })

    const buildRow = screen.getByText("build").closest("tr")!
    const modelSelect = buildRow.querySelectorAll("select")[0]

    // Clear model (select "默认")
    await user.selectOptions(modelSelect, "")

    // Should preserve prompt and temperature
    const call = setFormData.mock.calls[setFormData.mock.calls.length - 1][0]
    expect(call.agent.build.prompt).toBe("custom prompt")
    expect(call.agent.build.temperature).toBe(0.7)
  })

  it("reload button re-fetches config", async () => {
    const user = userEvent.setup()
    const { onReloadConfig } = setup()
    await waitFor(() => {
      expect(screen.getByText("build")).toBeInTheDocument()
    })

    await user.click(screen.getByTitle("重新加载配置"))
    expect(sdk.global.config.get).toHaveBeenCalled()
  })
})
