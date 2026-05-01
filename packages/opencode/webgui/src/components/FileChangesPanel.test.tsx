import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen } from "@testing-library/react"
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
        before: "",
        after: "next",
        additions: 1,
        deletions: 0,
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

    expect(screen.getByText("差异仍在后台刷新，当前显示的是上一版结果")).toBeInTheDocument()
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
})
