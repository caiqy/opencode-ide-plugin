import { describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"

vi.mock("../../../hooks/useOpenFile", () => {
  return {
    useOpenFile: () => vi.fn(),
  }
})

vi.mock("../../../state/ProjectContext", () => {
  return {
    useProject: () => ({ worktree: null }),
  }
})

import { ToolHeader } from "./ToolHeader"

describe("ToolHeader", () => {
  it("文件类工具在头部使用中文工具名，tooltip 显示英文 id", () => {
    const { container } = render(
      <ToolHeader
        tool="read"
        status="completed"
        toolName="read"
        filePath="src/foo.ts"
        isExpanded={false}
        onToggle={() => undefined}
      />,
    )

    const button = container.querySelector("button")
    expect(button).toBeTruthy()
    if (!button) return
    expect(button).toHaveTextContent("查看：")
    expect(button).toHaveTextContent("src/foo.ts")
    expect(button).toHaveAttribute("title", "read")
    expect(button).toHaveAttribute("data-tip", "read")
  })
})
