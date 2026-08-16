import { describe, it, expect, beforeEach, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { FooterPanels } from "./FooterPanels"

const mocks = vi.hoisted(() => ({
  getMessagesBySession: vi.fn(),
}))

vi.mock("../../state/MessagesContext", () => ({
  useMessages: () => ({
    getMessagesBySession: mocks.getMessagesBySession,
  }),
}))

vi.mock("./TodosPanel", () => ({
  TodosList: () => <div data-testid="todos-panel">todos panel</div>,
}))

describe("FooterPanels", () => {
  beforeEach(() => {
    mocks.getMessagesBySession.mockReset()

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
  })

  it("仅显示任务摘要并切换展开内容", () => {
    render(<FooterPanels sessionID="s1" />)

    const toggle = screen.getByRole("button", { name: /待办事项\s*\(\s*0\s*\/\s*1\s*\)/ })
    const panel = toggle.parentElement
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(panel).toHaveClass("border-b", "bg-white", "dark:bg-[rgb(30,30,30)]")
    expect(screen.queryByTestId("files-panel")).not.toBeInTheDocument()
    expect(screen.queryByTestId("todos-panel")).not.toBeInTheDocument()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    const todosPanel = screen.getByTestId("todos-panel")
    expect(todosPanel).toBeInTheDocument()
    expect(toggle.compareDocumentPosition(todosPanel)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it("没有任务时不显示面板，即使会话包含文件工具调用", () => {
    mocks.getMessagesBySession.mockReturnValue([
      { parts: [{ type: "tool", tool: "write", state: { input: { filePath: "src/a.ts" } } }] },
    ])

    const { container } = render(<FooterPanels sessionID="s1" />)
    expect(container).toBeEmptyDOMElement()
  })
})
