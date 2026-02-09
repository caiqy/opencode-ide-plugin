import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import { ProviderDropdown } from "./ProviderDropdown"

describe("ProviderDropdown", () => {
  it("展示中文添加与搜索文案", () => {
    render(
      <ProviderDropdown
        isOpen={true}
        searchTerm=""
        filteredProviders={[]}
        dropdownRef={{ current: null }}
        onToggle={vi.fn()}
        onSearchChange={vi.fn()}
        onSelectProvider={vi.fn()}
      />,
    )

    expect(screen.getByText("添加提供方…")).toBeInTheDocument()
    expect(screen.getByPlaceholderText("搜索提供方…")).toBeInTheDocument()
    expect(screen.getByText("未找到可用提供方")).toBeInTheDocument()
  })
})
