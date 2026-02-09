import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { KeyboardShortcutsHelp } from "./KeyboardShortcutsHelp"

describe("KeyboardShortcutsHelp", () => {
  it("展示中文标题、分类与说明", () => {
    render(<KeyboardShortcutsHelp isOpen={true} onClose={vi.fn()} />)

    expect(screen.getByText("键盘快捷键")).toBeInTheDocument()

    expect(screen.getByText("常规")).toBeInTheDocument()
    expect(screen.getByText("消息")).toBeInTheDocument()
    expect(screen.getByText("导航")).toBeInTheDocument()

    expect(screen.getByText("打开命令面板")).toBeInTheDocument()
    expect(screen.getByText("发送消息")).toBeInTheDocument()
  })

  it("底部提示语为中文", () => {
    render(<KeyboardShortcutsHelp isOpen={true} onClose={vi.fn()} />)

    expect(screen.getByText("提示：")).toBeInTheDocument()

    const tip = screen.getByText("提示：").closest("p")
    expect(tip).toBeTruthy()
    expect(tip as HTMLElement).toHaveTextContent("随时按")
  })
})
