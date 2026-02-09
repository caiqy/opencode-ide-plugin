import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { ModelsTab } from "./ModelsTab"

describe("ModelsTab", () => {
  it("基础文案为中文", () => {
    render(
      <ModelsTab
        formData={{}}
        setFormData={vi.fn()}
        providers={[]}
        configuredProviders={[]}
      />,
    )

    expect(screen.getByText("默认模型")).toBeInTheDocument()
    expect(screen.getByText("轻量模型")).toBeInTheDocument()
    expect(screen.getByText("禁用的提供方")).toBeInTheDocument()
    expect(screen.getByText("未找到已配置的提供方。")).toBeInTheDocument()
  })
})
