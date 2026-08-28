import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ConfirmModal } from "./ConfirmModal"

describe("ConfirmModal", () => {
  it("默认按钮文案为中文，并可触发回调", async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const onConfirm = vi.fn()

    render(<ConfirmModal isOpen={true} onClose={onClose} onConfirm={onConfirm} title="标题" message="内容" />)

    expect(screen.getByRole("dialog", { name: "标题" })).toHaveAttribute("aria-modal", "true")

    await user.click(screen.getByRole("button", { name: "取消" }))
    expect(onClose).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole("button", { name: "确认" }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
})
