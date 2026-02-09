import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SettingsHeader } from "./SettingsHeader"

describe("SettingsHeader", () => {
  it("展示中文标题与关闭按钮", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<SettingsHeader onClose={onClose} />)

    expect(screen.getByText("设置")).toBeInTheDocument()

    const closeButton = screen.getByRole("button", { name: "关闭" })
    expect(closeButton).toHaveAttribute("title", "关闭")
    await user.click(closeButton)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
