import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { FooterPanels } from "./FooterPanels"

const mocks = vi.hoisted(() => ({
  getMessagesBySession: vi.fn(),
  useMergedFileDiffs: vi.fn(),
  fileChangesPanel: vi.fn(),
  sessionState: {
    sessionDiff: {},
    sessionDiffStatus: {},
  },
}))

vi.mock("../../state/MessagesContext", () => ({
  useMessages: () => ({
    getMessagesBySession: mocks.getMessagesBySession,
  }),
}))

vi.mock("../../state/SessionContext", () => ({
  useSession: () => ({
    sessionDiff: mocks.sessionState.sessionDiff,
    sessionDiffStatus: mocks.sessionState.sessionDiffStatus,
  }),
}))

vi.mock("../../hooks/useMergedFileDiffs", () => ({
  useMergedFileDiffs: (...args: unknown[]) => mocks.useMergedFileDiffs(...args),
}))

vi.mock("./TodosPanel", () => ({
  TodosList: () => <div data-testid="todos-panel">todos panel</div>,
}))

vi.mock("../FileChangesPanel", () => ({
  FileChangesPanel: (props: unknown) => {
    mocks.fileChangesPanel(props)
    return <div data-testid="files-panel">files panel</div>
  },
}))

describe("FooterPanels", () => {
  beforeEach(() => {
    mocks.getMessagesBySession.mockReset()
    mocks.useMergedFileDiffs.mockReset()
    mocks.fileChangesPanel.mockReset()
    mocks.sessionState.sessionDiff = {}
    mocks.sessionState.sessionDiffStatus = {}

    mocks.getMessagesBySession.mockReturnValue([
      {
        parts: [
          {
            type: "tool",
            tool: "todowrite",
            state: {
              output: JSON.stringify([{ id: "t1", content: "todo", status: "pending", priority: "high" }]),
            },
          },
          {
            type: "tool",
            tool: "write",
            state: {
              input: {
                filePath: "src/a.ts",
              },
            },
          },
        ],
      },
    ])

    mocks.useMergedFileDiffs.mockReturnValue([
      {
        file: "src/a.ts",
        before: "",
        after: "",
        additions: 1,
        deletions: 0,
      },
    ])
  })

  it("files changed 与 TODOs 面板应互斥显示", () => {
    render(<FooterPanels sessionID="s1" />)

    const filesToggle = screen.getByRole("button", { name: /1\s*个文件变更/ })
    const todosToggle = screen.getByRole("button", { name: /0\s*\/\s*1\s*任务列表/ })

    expect(screen.queryByTestId("files-panel")).not.toBeInTheDocument()
    expect(screen.queryByTestId("todos-panel")).not.toBeInTheDocument()

    fireEvent.click(filesToggle)
    expect(screen.getByTestId("files-panel")).toBeInTheDocument()
    expect(screen.queryByTestId("todos-panel")).not.toBeInTheDocument()

    fireEvent.click(todosToggle)
    expect(screen.getByTestId("todos-panel")).toBeInTheDocument()
    expect(screen.queryByTestId("files-panel")).not.toBeInTheDocument()

    fireEvent.click(filesToggle)
    expect(screen.getByTestId("files-panel")).toBeInTheDocument()
    expect(screen.queryByTestId("todos-panel")).not.toBeInTheDocument()
  })

  it("passes current session diff status to FileChangesPanel", () => {
    mocks.sessionState.sessionDiff = {
      s1: [],
    }
    mocks.sessionState.sessionDiffStatus = {
      s1: {
        type: "failed",
        message: "刷新失败，将在空闲后重试",
      },
    }

    render(<FooterPanels sessionID="s1" />)

    fireEvent.click(screen.getByRole("button", { name: /1\s*个文件变更/ }))

    expect(mocks.fileChangesPanel).toHaveBeenCalledWith(
      expect.objectContaining({
        diffs: [],
        fallbackFiles: ["src/a.ts"],
        status: {
          type: "failed",
          message: "刷新失败，将在空闲后重试",
        },
      }),
    )
  })
})
