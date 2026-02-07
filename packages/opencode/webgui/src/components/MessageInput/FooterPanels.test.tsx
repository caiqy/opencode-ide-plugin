import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { FooterPanels } from "./FooterPanels"

const mocks = vi.hoisted(() => ({
  getMessagesBySession: vi.fn(),
  useMergedFileDiffs: vi.fn(),
}))

vi.mock("../../state/MessagesContext", () => ({
  useMessages: () => ({
    getMessagesBySession: mocks.getMessagesBySession,
  }),
}))

vi.mock("../../state/SessionContext", () => ({
  useSession: () => ({
    sessionDiff: {},
  }),
}))

vi.mock("../../hooks/useMergedFileDiffs", () => ({
  useMergedFileDiffs: (...args: unknown[]) => mocks.useMergedFileDiffs(...args),
}))

vi.mock("./TodosPanel", () => ({
  TodosList: () => <div data-testid="todos-panel">todos panel</div>,
}))

vi.mock("../FileChangesPanel", () => ({
  FileChangesPanel: () => <div data-testid="files-panel">files panel</div>,
}))

describe("FooterPanels", () => {
  beforeEach(() => {
    mocks.getMessagesBySession.mockReset()
    mocks.useMergedFileDiffs.mockReset()

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

    const filesToggle = screen.getByRole("button", { name: /1 file changed/i })
    const todosToggle = screen.getByRole("button", { name: /0\/1 TODOs/i })

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
})
