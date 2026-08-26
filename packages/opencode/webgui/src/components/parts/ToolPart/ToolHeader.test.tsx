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
    const onToggle = vi.fn()
    const { container } = render(
      <ToolHeader
        tool="edit"
        status="completed"
        toolName="edit"
        filePath="src/bar.ts"
        isExpanded={false}
        isExpandable={true}
        onToggle={onToggle}
        time={{ start: 1000, end: 3500 }}
      />,
    )

    const header = container.firstElementChild
    expect(header).toBeTruthy()
    if (!header) return
    fireEvent.click(header)
    expect(onToggle).toHaveBeenCalledTimes(1)
    expect(header).toHaveTextContent("编辑：")
    expect(header).toHaveTextContent("bar.ts")
    expect(header).toHaveTextContent("2.5s")
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
        patchFilePaths={["src/a/very/deep/foo.ts", "src/b/bar.ts"]}
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

  it("rightActions 点击不应触发展开", () => {
    const onToggle = vi.fn()
    const onAction = vi.fn()

    render(
      <ToolHeader
        tool="task"
        status="running"
        toolName="委派子任务"
        isExpanded={false}
        isExpandable={true}
        onToggle={onToggle}
        rightActions={
          <button type="button" onClick={onAction}>
            查看子任务
          </button>
        }
      />,
    )

    fireEvent.click(screen.getByText("查看子任务"))
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onToggle).toHaveBeenCalledTimes(0)
  })

  it("运行中的工具头部启用扫光，其他状态不启用", () => {
    const { container, rerender } = render(
      <ToolHeader
        tool="task"
        status="running"
        toolName="委派子任务"
        isExpanded={false}
        isExpandable={false}
        onToggle={() => undefined}
      />,
    )

    const header = container.firstElementChild
    expect(header).toHaveClass("tool-header-running")
    const shimmerText = header?.querySelector(".tool-header-running-text")
    expect(shimmerText).toBeTruthy()
    expect(shimmerText).not.toHaveClass("flex-1")

    rerender(
      <ToolHeader
        tool="task"
        status="completed"
        toolName="委派子任务"
        isExpanded={false}
        isExpandable={false}
        onToggle={() => undefined}
      />,
    )
    expect(container.firstElementChild).not.toHaveClass("tool-header-running")
    expect(container.firstElementChild?.querySelector(".tool-header-running-text")).toBeNull()
  })
})
