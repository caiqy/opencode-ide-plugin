import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"

import { EmptyState } from "./EmptyState"

describe("EmptyState", () => {
  it("空状态文案为中文", () => {
    render(<EmptyState />)
    expect(screen.getByText("暂无消息")).toBeInTheDocument()
    expect(screen.getByText("发送一条消息开始对话")).toBeInTheDocument()
  })
})
