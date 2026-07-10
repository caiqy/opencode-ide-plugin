import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  useDiffData: vi.fn(),
}))

vi.mock("./hooks/useDiffData", () => ({
  useDiffData: (...args: unknown[]) => mocks.useDiffData(...args),
}))

vi.mock("./DiffHeader", () => ({
  DiffHeader: () => <div data-testid="diff-header" />,
}))

vi.mock("./DiffViewer", () => ({
  DiffViewer: ({ before, after }: { before: string; after: string }) => (
    <div data-testid="diff-viewer">{`${before}:${after}`}</div>
  ),
}))

import { DiffModal } from "./index"
import { DiffNavigation } from "./DiffNavigation"

describe("DiffModal", () => {
  beforeEach(() => {
    mocks.useDiffData.mockReturnValue({
      diffs: [],
      isLoading: false,
      error: null,
    })
  })

  it("加载状态文案显示为中文", () => {
    mocks.useDiffData.mockReturnValue({
      diffs: [],
      isLoading: true,
      error: null,
    })

    render(<DiffModal isOpen={true} onClose={vi.fn()} sessionID="s1" messageID="m1" patchHash="abc123" />)

    expect(screen.getByText("加载差异中…")).toBeInTheDocument()
  })

  it("空差异状态文案显示为中文", () => {
    render(<DiffModal isOpen={true} onClose={vi.fn()} sessionID="s1" messageID="m1" patchHash="abc123" />)

    expect(screen.getByText("未发现变更")).toBeInTheDocument()
  })

  it("底部按钮和文件计数显示为中文", () => {
    mocks.useDiffData.mockReturnValue({
      diffs: [
        { file: "src/a.ts", patch: "@@ -1 +1 @@\n-a\n+b", status: "modified", additions: 1, deletions: 1 },
        { file: "src/b.ts", patch: "@@ -1 +1 @@\n-a\n+b", status: "modified", additions: 1, deletions: 1 },
      ],
      isLoading: false,
      error: null,
    })

    render(<DiffModal isOpen={true} onClose={vi.fn()} sessionID="s1" messageID="m1" patchHash="abc123" />)

    expect(screen.getByText("2 个文件变更")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument()
  })

  it("无法解析的 patch 显示原始只读内容", () => {
    const patch = "Binary files a/image.png and b/image.png differ"
    mocks.useDiffData.mockReturnValue({
      diffs: [{ file: "image.png", patch, status: "modified", additions: 0, deletions: 0 }],
      isLoading: false,
      error: null,
    })

    render(<DiffModal isOpen={true} onClose={vi.fn()} sessionID="s1" messageID="m1" patchHash="abc123" />)

    expect(screen.getByText(patch)).toBeInTheDocument()
    expect(screen.queryByTestId("diff-viewer")).not.toBeInTheDocument()
  })

  it("缺少文件路径的导航项被禁用", () => {
    render(
      <DiffNavigation
        diffs={[
          { file: "src/a.ts", patch: "", status: "modified", additions: 0, deletions: 0 },
          { patch: "", status: "modified", additions: 0, deletions: 0 },
        ]}
        selectedFile={0}
        onSelectFile={vi.fn()}
      />,
    )

    expect(screen.getByRole("button", { name: "Unavailable file" })).toBeDisabled()
  })
})
