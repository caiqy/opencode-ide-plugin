import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ApprovalModeSelector } from "./ApprovalModeSelector"

const trigger = () => screen.getByTitle("选择审批模式")

describe("ApprovalModeSelector", () => {
  it("打开菜单时聚焦当前选中的项", async () => {
    const user = userEvent.setup()
    render(<ApprovalModeSelector value="automatic" onSelect={vi.fn()} />)

    await user.click(trigger())

    expect(screen.getByRole("menuitemradio", { name: /自动审批\s*Automatic/ })).toHaveFocus()
  })

  it("ArrowDown/ArrowUp 循环移动焦点", async () => {
    const user = userEvent.setup()
    render(<ApprovalModeSelector value="automatic" onSelect={vi.fn()} />)
    await user.click(trigger())

    const items = screen.getAllByRole("menuitemradio")
    await user.keyboard("{ArrowDown}")
    expect(items[2]).toHaveFocus()
    await user.keyboard("{ArrowDown}")
    expect(items[0]).toHaveFocus()
    await user.keyboard("{ArrowUp}")
    expect(items[2]).toHaveFocus()
  })

  it("Home 聚焦第一项，End 聚焦最后一项", async () => {
    const user = userEvent.setup()
    render(<ApprovalModeSelector value="manual" onSelect={vi.fn()} />)
    await user.click(trigger())

    const items = screen.getAllByRole("menuitemradio")
    await user.keyboard("{End}")
    expect(items[2]).toHaveFocus()
    await user.keyboard("{Home}")
    expect(items[0]).toHaveFocus()
  })

  it("Escape 关闭菜单并恢复 trigger 焦点", async () => {
    const user = userEvent.setup()
    render(<ApprovalModeSelector value="manual" onSelect={vi.fn()} />)
    await user.click(trigger())
    expect(screen.getByRole("menu")).toBeInTheDocument()

    await user.keyboard("{Escape}")

    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
  })

  it("点击选择后关闭菜单、调用 onSelect 并恢复 trigger 焦点", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<ApprovalModeSelector value="manual" onSelect={onSelect} />)
    await user.click(trigger())

    await user.click(screen.getByRole("menuitemradio", { name: /完全访问\s*Full access/ }))

    expect(onSelect).toHaveBeenCalledWith("full")
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
  })

  it("Enter 选择当前聚焦的菜单项", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<ApprovalModeSelector value="manual" onSelect={onSelect} />)
    await user.click(trigger())
    await user.keyboard("{End}{Enter}")

    expect(onSelect).toHaveBeenCalledWith("full")
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
  })

  it("Tab 关闭菜单并移到 trigger 后的控件", async () => {
    const user = userEvent.setup()
    render(
      <>
        <button type="button">Previous</button>
        <ApprovalModeSelector value="manual" onSelect={vi.fn()} />
        <button type="button">Next</button>
      </>,
    )
    await user.click(trigger())

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" })

    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
    await user.tab()
    expect(screen.getByRole("button", { name: "Next" })).toHaveFocus()
  })

  it("Shift+Tab 关闭菜单并移到 trigger 前的控件", async () => {
    const user = userEvent.setup()
    render(
      <>
        <button type="button">Previous</button>
        <ApprovalModeSelector value="manual" onSelect={vi.fn()} />
        <button type="button">Next</button>
      </>,
    )
    await user.click(trigger())

    fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab", shiftKey: true })

    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
    await user.tab({ shift: true })
    expect(screen.getByRole("button", { name: "Previous" })).toHaveFocus()
  })
})
