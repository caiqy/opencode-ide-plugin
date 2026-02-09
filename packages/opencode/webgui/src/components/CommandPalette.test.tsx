import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CommandPalette } from "./CommandPalette"

describe("CommandPalette", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    })
  })

  it("展示中文搜索框与分组标题", () => {
    render(
      <CommandPalette
        isOpen
        onClose={vi.fn()}
        sessions={[{ id: "s1", title: "测试会话" } as any]}
        onNewSession={vi.fn()}
        onSwitchSession={vi.fn()}
        onOpenSettings={vi.fn()}
        onShowHelp={vi.fn()}
      />,
    )

    expect(screen.getByPlaceholderText("输入命令或搜索会话…")).toBeInTheDocument()
    expect(screen.getByText("操作")).toBeInTheDocument()
    expect(screen.getByText("最近会话")).toBeInTheDocument()
    expect(screen.getByText("新建会话")).toBeInTheDocument()
  })

  it("无匹配结果时展示中文提示", async () => {
    const user = userEvent.setup()

    render(
      <CommandPalette
        isOpen
        onClose={vi.fn()}
        sessions={[{ id: "s1", title: "测试会话" } as any]}
        onNewSession={vi.fn()}
        onSwitchSession={vi.fn()}
        onOpenSettings={vi.fn()}
        onShowHelp={vi.fn()}
      />,
    )

    const input = screen.getByPlaceholderText("输入命令或搜索会话…")
    await user.type(input, "xyz")

    expect(screen.getByText("未找到与“xyz”匹配的结果")).toBeInTheDocument()
  })

  it("页脚导航提示为中文", () => {
    render(
      <CommandPalette
        isOpen
        onClose={vi.fn()}
        sessions={[]}
        onNewSession={vi.fn()}
        onSwitchSession={vi.fn()}
        onOpenSettings={vi.fn()}
        onShowHelp={vi.fn()}
      />,
    )

    const footer = screen.getByText("↑↓").closest("div")
    expect(footer).toBeTruthy()
    expect(footer as HTMLElement).toHaveTextContent("移动")
    expect(footer as HTMLElement).toHaveTextContent("选择")
    expect(footer as HTMLElement).toHaveTextContent("关闭")
  })
})
