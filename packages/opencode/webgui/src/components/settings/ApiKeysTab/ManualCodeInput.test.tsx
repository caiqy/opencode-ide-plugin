import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import { ManualCodeInput } from "./ManualCodeInput"

describe("ManualCodeInput", () => {
  it("展示中文授权码输入提示与操作按钮", () => {
    render(<ManualCodeInput value="abc" onValueChange={vi.fn()} onSubmit={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByPlaceholderText("在此粘贴授权码")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "提交" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument()
  })
})
