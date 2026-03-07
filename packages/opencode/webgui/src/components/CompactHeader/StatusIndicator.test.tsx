import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ConnectionState } from "../../lib/api/events"

import { StatusIndicator } from "./StatusIndicator"

describe("CompactHeader/StatusIndicator", () => {
  it("未接入弹层时保持纯展示状态点", () => {
    render(<StatusIndicator connectionState={"connected" as ConnectionState} />)
    expect(screen.queryByRole("button", { name: "连接状态：已连接" })).not.toBeInTheDocument()
    expect(screen.getByTitle("已连接")).toBeInTheDocument()
    expect(screen.getByLabelText("连接状态：已连接")).toBeInTheDocument()
  })

  it("连接中状态的 tooltip 为中文", () => {
    render(
      <StatusIndicator
        connectionState={"connecting" as ConnectionState}
        open={false}
        onToggle={vi.fn()}
        controls="status-popover"
      />,
    )
    expect(screen.getByTitle("连接中…")).toBeInTheDocument()
  })

  it("状态点作为弹层触发器", async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(<StatusIndicator connectionState={"connected" as ConnectionState} open={true} onToggle={onToggle} />)

    const btn = screen.getByRole("button", { name: "连接状态：已连接" })
    expect(btn).toHaveAttribute("aria-haspopup", "dialog")
    expect(btn).toHaveAttribute("aria-expanded", "true")
    expect(btn).toHaveAttribute("aria-controls", "status-popover")

    fireEvent.click(btn)
    expect(onToggle).toHaveBeenCalledTimes(1)

    await user.tab()
    await user.keyboard("{Enter}")
    expect(onToggle).toHaveBeenCalledTimes(2)

    await user.keyboard(" ")
    expect(onToggle).toHaveBeenCalledTimes(3)
  })

  it("错误状态保留红点脉冲样式", () => {
    render(<StatusIndicator connectionState={"error" as ConnectionState} />)
    const dot = screen.getByLabelText("连接状态：连接错误").querySelector("span")
    expect(dot).toHaveClass("bg-red-500")
    expect(dot).toHaveClass("animate-pulse")
  })
})
