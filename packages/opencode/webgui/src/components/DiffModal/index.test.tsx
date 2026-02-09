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

vi.mock("./DiffNavigation", () => ({
  DiffNavigation: () => <div data-testid="diff-navigation" />,
}))

vi.mock("./DiffViewer", () => ({
  DiffViewer: () => <div data-testid="diff-viewer" />,
}))

import { DiffModal } from "./index"

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
        { file: "src/a.ts", before: "a", after: "b" },
        { file: "src/b.ts", before: "a", after: "b" },
      ],
      isLoading: false,
      error: null,
    })

    render(<DiffModal isOpen={true} onClose={vi.fn()} sessionID="s1" messageID="m1" patchHash="abc123" />)

    expect(screen.getByText("2 个文件变更")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument()
  })
})
