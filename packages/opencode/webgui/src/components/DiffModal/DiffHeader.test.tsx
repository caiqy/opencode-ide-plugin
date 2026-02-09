import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import { DiffHeader } from "./DiffHeader"

describe("DiffHeader", () => {
  it("展示中文标题与视图切换按钮", () => {
    render(
      <DiffHeader
        patchHash="abcdef123456"
        viewMode="split"
        onViewModeChange={vi.fn()}
        onClose={vi.fn()}
        showViewToggle
      />,
    )

    expect(screen.getByText("文件差异")).toBeInTheDocument()
    expect(screen.getByText("并排")).toBeInTheDocument()
    expect(screen.getByText("统一")).toBeInTheDocument()
    expect(screen.getByTitle("并排视图")).toBeInTheDocument()
    expect(screen.getByTitle("统一视图")).toBeInTheDocument()
    expect(screen.getByTitle("关闭（Esc）")).toBeInTheDocument()
  })
})
