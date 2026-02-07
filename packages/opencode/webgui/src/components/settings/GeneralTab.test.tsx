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
  it("自动展开设置应显示帮助 tooltip", () => {
    render(<GeneralTab formData={{}} setFormData={vi.fn()} />)

    expect(screen.getByRole("button", { name: "Auto expand help" })).toHaveAttribute(
      "title",
      "When disabled, thinking/tool blocks are collapsed by default and can still be expanded manually.",
    )
  })
})
