import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { ActionButtons } from "./ActionButtons"

describe("CompactHeader/ActionButtons", () => {
  it("按钮 tooltip 为中文", () => {
    render(
      <ActionButtons
        theme="light"
        toggleTheme={vi.fn()}
        onOpenCommandPalette={vi.fn()}
        onOpenSettings={vi.fn()}
        onNewSession={vi.fn()}
        onToggleHistory={vi.fn()}
        isCreatingSession={false}
        isShared={false}
        isSharing={false}
        onToggleShare={vi.fn()}
      />,
    )

    expect(screen.getByTitle("新建会话（Cmd/Ctrl+N）")).toBeInTheDocument()
    expect(screen.getByTitle("历史会话")).toBeInTheDocument()
    expect(screen.getByTitle("更多选项")).toBeInTheDocument()
  })

  it("菜单项文案为中文", async () => {
    const user = userEvent.setup()

    render(
      <ActionButtons
        theme="light"
        toggleTheme={vi.fn()}
        onOpenCommandPalette={vi.fn()}
        onOpenSettings={vi.fn()}
        onNewSession={vi.fn()}
        onToggleHistory={vi.fn()}
        isCreatingSession={false}
        isShared={false}
        isSharing={false}
        onToggleShare={vi.fn()}
      />,
    )

    await user.click(screen.getByTitle("更多选项"))

    expect(screen.getByText("深色模式")).toBeInTheDocument()
    expect(screen.getByText("命令面板")).toBeInTheDocument()
    expect(screen.getByText("设置")).toBeInTheDocument()
    expect(screen.getByText("分享会话")).toBeInTheDocument()
  })

  it("已分享会话时显示取消分享会话", async () => {
    const user = userEvent.setup()

    render(
      <ActionButtons
        theme="light"
        toggleTheme={vi.fn()}
        onOpenCommandPalette={vi.fn()}
        onOpenSettings={vi.fn()}
        onNewSession={vi.fn()}
        onToggleHistory={vi.fn()}
        isCreatingSession={false}
        isShared={true}
        isSharing={false}
        onToggleShare={vi.fn()}
      />,
    )

    await user.click(screen.getByTitle("更多选项"))
    expect(screen.getByText("取消分享会话")).toBeInTheDocument()
  })
})
