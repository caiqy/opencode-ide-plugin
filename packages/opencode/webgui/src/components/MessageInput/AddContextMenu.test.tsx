import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { AddContextMenu } from "./AddContextMenu"

describe("AddContextMenu", () => {
  it("默认渲染添加上下文按钮并处于收起状态", () => {
    render(<AddContextMenu onSelectFiles={vi.fn()} onSelectDirectory={vi.fn()} />)

    const button = screen.getByRole("button", { name: "添加上下文" })
    expect(button).toBeInTheDocument()
    expect(button).toHaveAttribute("aria-expanded", "false")
    expect(button).toHaveAttribute("aria-haspopup", "menu")
    expect(button).toHaveAttribute("title", "添加上下文")
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
  })

  it("点击后展开菜单，包含文件与文件夹选项", async () => {
    const user = userEvent.setup()
    render(<AddContextMenu onSelectFiles={vi.fn()} onSelectDirectory={vi.fn()} />)

    await user.click(screen.getByRole("button", { name: "添加上下文" }))

    const menu = screen.getByRole("menu", { name: "添加上下文" })
    expect(menu).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "文件" })).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "文件夹" })).toBeInTheDocument()
  })

  it("点击文件和文件夹分别调用对应回调并关闭菜单", async () => {
    const user = userEvent.setup()
    const onSelectFiles = vi.fn()
    const onSelectDirectory = vi.fn()

    const { rerender } = render(
      <AddContextMenu onSelectFiles={onSelectFiles} onSelectDirectory={onSelectDirectory} />,
    )

    // 点击文件
    await user.click(screen.getByRole("button", { name: "添加上下文" }))
    await user.click(screen.getByRole("menuitem", { name: "文件" }))
    expect(onSelectFiles).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()

    // 重新打开并点击文件夹
    rerender(<AddContextMenu onSelectFiles={onSelectFiles} onSelectDirectory={onSelectDirectory} />)
    await user.click(screen.getByRole("button", { name: "添加上下文" }))
    await user.click(screen.getByRole("menuitem", { name: "文件夹" }))
    expect(onSelectDirectory).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
  })

  it("支持通过 extraOptions 扩展新的上下文菜单项", async () => {
    const user = userEvent.setup()
    const onExtraClick = vi.fn()

    render(
      <AddContextMenu
        onSelectFiles={vi.fn()}
        onSelectDirectory={vi.fn()}
        extraOptions={[
          {
            id: "git-diff",
            label: "Git 改动",
            icon: <span>git</span>,
            onClick: onExtraClick,
          },
        ]}
      />,
    )

    await user.click(screen.getByRole("button", { name: "添加上下文" }))
    const extraItem = screen.getByRole("menuitem", { name: /Git 改动/ })
    expect(extraItem).toBeInTheDocument()

    await user.click(extraItem)
    expect(onExtraClick).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
  })

  it("按 Escape 键关闭菜单并恢复触发按钮焦点", async () => {
    const user = userEvent.setup()
    render(<AddContextMenu onSelectFiles={vi.fn()} onSelectDirectory={vi.fn()} />)

    const trigger = screen.getByRole("button", { name: "添加上下文" })
    await user.click(trigger)
    expect(screen.getByRole("menu")).toBeInTheDocument()

    await user.keyboard("{Escape}")
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it("option.onClick 发生异常时捕获且不破坏界面", async () => {
    const user = userEvent.setup()
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    render(
      <AddContextMenu
        onSelectFiles={() => {
          throw new Error("sync error")
        }}
        onSelectDirectory={vi.fn()}
      />,
    )

    await user.click(screen.getByRole("button", { name: "添加上下文" }))
    await user.click(screen.getByRole("menuitem", { name: "文件" }))
    expect(errorSpy).toHaveBeenCalled()
    expect(screen.queryByRole("menu")).not.toBeInTheDocument()

    errorSpy.mockRestore()
  })
})
