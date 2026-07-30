import { describe, it, expect, beforeEach, vi } from "vitest"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { FileChangesPanel } from "./FileChangesPanel"

const mocks = vi.hoisted(() => ({
  openFile: vi.fn(),
  useMergedFileDiffs: vi.fn(),
}))

vi.mock("../hooks/useOpenFile", () => ({
  useOpenFile: () => mocks.openFile,
}))

vi.mock("../state/ProjectContext", () => ({
  useProject: () => ({ worktree: null }),
}))

vi.mock("../hooks/useMergedFileDiffs", () => ({
  useMergedFileDiffs: (...args: unknown[]) => mocks.useMergedFileDiffs(...args),
}))

describe("FileChangesPanel", () => {
  beforeEach(() => {
    mocks.openFile.mockReset()
    mocks.useMergedFileDiffs.mockReset()
    mocks.useMergedFileDiffs.mockReturnValue([
      {
        file: "src/a.ts",
        patch: "@@ -0,0 +1 @@\n+next",
        status: "modified",
        additions: 1,
        deletions: 0,
      },
      {
        file: "src/new.ts",
        patch: "@@ -0,0 +1 @@\n+new",
        status: "added",
        additions: 1,
        deletions: 0,
      },
      {
        file: "src/deleted.ts",
        patch: "@@ -1 +0,0 @@\n-old",
        status: "deleted",
        additions: 0,
        deletions: 1,
      },
    ])
  })

  it("shows updating hint when diff is still refreshing", () => {
    render(
      <FileChangesPanel
        diffs={[]}
        status={{
          type: "updating",
          message: "Summary refresh in progress",
        }}
      />,
    )

    const summary = screen.getByText("3 files").parentElement!
    expect(screen.getByText("差异仍在后台刷新，当前显示的是上一版结果")).toBeInTheDocument()
    expect(screen.getByText("3 files")).toBeInTheDocument()
    expect(within(summary).getByText("+2")).toBeInTheDocument()
    expect(within(summary).getByText("-1")).toBeInTheDocument()
    expect(within(summary).getByText("net +1")).toBeInTheDocument()
    expect(screen.getByText("1 added • 1 modified • 1 deleted")).toBeInTheDocument()
    expect(screen.getByTitle("src/new.ts")).toHaveClass("text-green-700")
  })

  it("opens an added file with mouse and keyboard", () => {
    render(<FileChangesPanel diffs={[]} />)
    const added = screen.getByTitle("src/new.ts")

    fireEvent.click(added)
    fireEvent.keyDown(added, { key: "Enter" })
    fireEvent.keyDown(added, { key: " " })

    expect(mocks.openFile).toHaveBeenCalledTimes(3)
    expect(mocks.openFile).toHaveBeenNthCalledWith(1, { path: "src/new.ts", display: "src/new.ts" })
    expect(mocks.openFile).toHaveBeenNthCalledWith(2, { path: "src/new.ts", display: "src/new.ts" })
    expect(mocks.openFile).toHaveBeenNthCalledWith(3, { path: "src/new.ts", display: "src/new.ts" })
  })

  it("shows latest hint when diff is current", () => {
    render(
      <FileChangesPanel
        diffs={[]}
        status={{
          type: "latest",
          message: "已是最新结果",
        }}
      />,
    )

    expect(screen.getByText("已是最新结果")).toBeInTheDocument()
  })

  it("shows failed hint and prefers the provided message", () => {
    render(
      <FileChangesPanel
        diffs={[]}
        status={{
          type: "failed",
          message: "自定义失败文案",
        }}
      />,
    )

    expect(screen.getByText("自定义失败文案")).toBeInTheDocument()
  })

  it("ignores entries without a file path", () => {
    mocks.useMergedFileDiffs.mockReturnValue([
      { patch: "@@ -1 +1 @@\n-old\n+new", status: "modified", additions: 1, deletions: 1 },
    ])

    const { container } = render(<FileChangesPanel diffs={[]} />)

    expect(container).toBeEmptyDOMElement()
    expect(mocks.openFile).not.toHaveBeenCalled()
  })
})
