import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  openFile: vi.fn(),
}))

vi.mock("../../../hooks/useOpenFile", () => {
  return {
    useOpenFile: () => mocks.openFile,
  }
})

vi.mock("../../../state/ProjectContext", () => {
  return {
    useProject: () => ({ worktree: null }),
  }
})

import { ToolHeader } from "./ToolHeader"

describe("ToolHeader", () => {
  it("文件类工具在头部使用中文工具名，只显示文件名，tooltip 显示完整路径", () => {
    const { container } = render(
      <ToolHeader
        tool="read"
        status="completed"
        toolName="read"
        filePath="src/foo.ts"
        isExpanded={false}
        isExpandable={false}
        onToggle={() => undefined}
      />,
    )

    // read tool: isExpandable=false → renders as div, not button
    const header = container.firstElementChild
    expect(header).toBeTruthy()
    if (!header) return
    expect(header).toHaveTextContent("查看：")
    expect(header).toHaveTextContent("foo.ts")
    expect(header).toHaveAttribute("title", "read")
    expect(header).toHaveAttribute("data-tip", "read")

    // File link tooltip should show full path
    const fileLink = header.querySelector("[role='button']")
    expect(fileLink).toBeTruthy()
    expect(fileLink).toHaveAttribute("title", "src/foo.ts")
  })

  it("可展开工具渲染为 button 并显示展开箭头和用时", () => {
    const { container } = render(
      <ToolHeader
        tool="edit"
        status="completed"
        toolName="edit"
        filePath="src/bar.ts"
        isExpanded={false}
        isExpandable={true}
        onToggle={() => undefined}
        time={{ start: 1000, end: 3500 }}
      />,
    )

    const button = container.querySelector("button")
    expect(button).toBeTruthy()
    if (!button) return
    expect(button).toHaveTextContent("编辑：")
    expect(button).toHaveTextContent("bar.ts")
    expect(button).toHaveTextContent("2.5s")
  })

  it("文件补丁标题栏仅显示文件名，点击文件名可定位", () => {
    render(
      <ToolHeader
        tool={"apply_patch"}
        status="completed"
        toolName="文件补丁：Success. Updated the following files: src/a/very/deep/foo.ts"
        isExpanded={false}
        isExpandable={true}
        onToggle={() => undefined}
        {...({ patchFilePaths: ["src/a/very/deep/foo.ts", "src/b/bar.ts"] } as any)}
      />,
    )

    expect(screen.getByText("文件补丁：")).toBeInTheDocument()
    expect(screen.getByText("foo.ts")).toBeInTheDocument()
    expect(screen.getByText("bar.ts")).toBeInTheDocument()
    expect(screen.queryByText("src/a/very/deep/foo.ts")).not.toBeInTheDocument()

    fireEvent.click(screen.getByText("foo.ts"))
    expect(mocks.openFile).toHaveBeenCalledWith({
      path: "src/a/very/deep/foo.ts",
      display: "src/a/very/deep/foo.ts",
    })
  })
})
