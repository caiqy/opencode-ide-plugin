import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

vi.mock("../lib/api/sdkClient", () => {
  return {
    sdk: {
      app: {
        agents: vi.fn(),
      },
    },
  }
})

import { sdk } from "../lib/api/sdkClient"
import { AgentSelector } from "./AgentSelector"

describe("AgentSelector", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("触发按钮与搜索框文案为中文", async () => {
    ;(sdk.app.agents as any).mockResolvedValue({
      data: [{ name: "build", description: "Build things", mode: "primary", hidden: false, builtIn: true }],
      error: null,
    })

    const user = userEvent.setup()
    render(<AgentSelector onSelect={() => {}} />)

    await screen.findByText("Build")

    const trigger = screen.getByTitle("选择智能体")
    expect(trigger).toBeInTheDocument()

    await user.click(trigger)
    expect(screen.getByPlaceholderText("搜索智能体…")).toBeInTheDocument()
    expect(screen.getByText("内置")).toBeInTheDocument()
  })

  it("无智能体时展示中文空状态", async () => {
    ;(sdk.app.agents as any).mockResolvedValue({ data: [], error: null })

    const user = userEvent.setup()
    render(<AgentSelector onSelect={() => {}} />)

    await screen.findByText("Build")
    await user.click(screen.getByTitle("选择智能体"))
    expect(screen.getByText("暂无可用智能体")).toBeInTheDocument()
  })

  it("搜索无结果时展示中文提示", async () => {
    ;(sdk.app.agents as any).mockResolvedValue({
      data: [{ name: "build", description: "Build things", mode: "primary", hidden: false, builtIn: false }],
      error: null,
    })

    const user = userEvent.setup()
    render(<AgentSelector onSelect={() => {}} />)

    await screen.findByText("Build")
    await user.click(screen.getByTitle("选择智能体"))

    const input = screen.getByPlaceholderText("搜索智能体…")
    await user.type(input, "xyz")

    expect(screen.getByText("未找到智能体")).toBeInTheDocument()
  })
})
