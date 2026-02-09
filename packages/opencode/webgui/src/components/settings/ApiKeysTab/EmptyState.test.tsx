import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { EmptyState } from "./EmptyState"

describe("EmptyState", () => {
  it("空状态文案为中文", () => {
    render(<EmptyState />)
    expect(screen.getByText("尚未配置任何提供方。请先在上方添加。")).toBeInTheDocument()
  })
})
