import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { ToastComponent } from "./Toast"

describe("Toast", () => {
  it("关闭按钮 aria-label 为中文", () => {
    render(<ToastComponent toast={{ id: "t1", variant: "info", message: "msg", duration: 0 }} onDismiss={vi.fn()} />)

    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument()
  })
})
