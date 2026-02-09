import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { GeneralTab } from "./GeneralTab"

vi.mock("../../state/ProjectContext", () => ({
  useProject: () => ({
    worktree: "D:/repo",
  }),
}))

vi.mock("../../state/UISettingsContext", () => ({
  useUISettings: () => ({
    autoExpandMessageParts: true,
    setAutoExpandMessageParts: vi.fn().mockResolvedValue(undefined),
  }),
}))

describe("GeneralTab", () => {
  it("基础文案为中文", () => {
    render(<GeneralTab formData={{}} setFormData={vi.fn()} />)

    expect(screen.getByText("用户名")).toBeInTheDocument()
    expect(screen.getByText("自动更新")).toBeInTheDocument()
    expect(screen.getByText("自动展开思考与工具调用")).toBeInTheDocument()
    expect(screen.getByText("启用快照")).toBeInTheDocument()
    expect(screen.getByText("分享模式")).toBeInTheDocument()
    expect(screen.getByText("工作目录")).toBeInTheDocument()

    expect(screen.getByRole("option", { name: "手动" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "自动" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "禁用" })).toBeInTheDocument()
  })

  it("自动展开设置应显示帮助 tooltip", () => {
    render(<GeneralTab formData={{}} setFormData={vi.fn()} />)

    expect(screen.getByRole("button", { name: "自动展开说明" })).toHaveAttribute(
      "title",
      "关闭后，思考/工具调用块默认折叠，但仍可手动展开。",
    )
  })
})
