import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { GeneralTab } from "./GeneralTab"

vi.mock("../../state/ProjectContext", () => ({
  useProject: () => ({
    worktree: "D:/repo",
  }),
}))

describe("GeneralTab", () => {
  it("基础文案为中文", () => {
    render(<GeneralTab formData={{}} setFormData={vi.fn()} />)

    expect(screen.getByText("用户名")).toBeInTheDocument()
    expect(screen.getByText("自动更新")).toBeInTheDocument()
    expect(screen.getByText("启用快照")).toBeInTheDocument()
    expect(screen.getByText("分享模式")).toBeInTheDocument()
    expect(screen.getByText("工作目录")).toBeInTheDocument()

    expect(screen.getByRole("option", { name: "手动" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "自动" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "禁用" })).toBeInTheDocument()
  })

  it("快照开关在未配置时默认开启并标注默认开启", () => {
    render(<GeneralTab formData={{}} setFormData={vi.fn()} />)

    expect(screen.getByRole("checkbox", { name: "启用快照" })).toBeChecked()
    expect(screen.getByText("在会话中记录文件状态快照（默认开启）")).toBeInTheDocument()
  })
})
