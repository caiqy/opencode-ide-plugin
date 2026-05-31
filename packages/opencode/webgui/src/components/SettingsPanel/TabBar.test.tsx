import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { TabBar } from "./TabBar"

describe("TabBar", () => {
  it("只展示保留的中文标签", () => {
    render(<TabBar activeTab="general" onTabChange={vi.fn()} />)

    expect(screen.getByRole("button", { name: /常规/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Agent 配置/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /高级/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /快捷短语/ })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /API\s*密钥/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /模型/ })).not.toBeInTheDocument()
  })

  it("点击会触发 onTabChange", async () => {
    const user = userEvent.setup()
    const onTabChange = vi.fn()
    render(<TabBar activeTab="general" onTabChange={onTabChange} />)

    await user.click(screen.getByRole("button", { name: /快捷短语/ }))
    expect(onTabChange).toHaveBeenCalledWith("quick-phrases")

    await user.click(screen.getByRole("button", { name: /高级/ }))
    expect(onTabChange).toHaveBeenCalledWith("advanced")
  })
})
