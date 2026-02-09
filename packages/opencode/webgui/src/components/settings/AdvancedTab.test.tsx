import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { AdvancedTab } from "./AdvancedTab"

describe("AdvancedTab", () => {
  it("基础文案为中文", () => {
    render(<AdvancedTab formData={{}} setFormData={vi.fn()} />)

    expect(screen.getByText("主题")).toBeInTheDocument()
    expect(screen.getByText("监视忽略模式")).toBeInTheDocument()
    expect(screen.getByText("插件")).toBeInTheDocument()
  })
})
