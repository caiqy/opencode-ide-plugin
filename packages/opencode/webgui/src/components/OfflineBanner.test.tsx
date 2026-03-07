import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import { OfflineBanner } from "./OfflineBanner"

describe("OfflineBanner", () => {
  it("断线与错误状态文案为中文", () => {
    const { rerender } = render(<OfflineBanner connectionState={"disconnected" as any} />)
    expect(screen.getByText("已断开连接")).toBeInTheDocument()
    expect(screen.getByText("与服务器的连接已中断，正在重连…")).toBeInTheDocument()

    rerender(<OfflineBanner connectionState={"error" as any} />)
    expect(screen.getByText("连接错误")).toBeInTheDocument()
    expect(screen.getByText("连接 OpenCode 服务器失败，正在重试…")).toBeInTheDocument()
  })

  it("重试按钮文案为中文并可触发", () => {
    const onRetry = vi.fn()
    render(<OfflineBanner connectionState={"error" as any} onRetry={onRetry} />)

    fireEvent.click(screen.getByRole("button", { name: "立即重试" }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("connected 时不显示横幅", () => {
    const { container } = render(<OfflineBanner connectionState={"connected" as any} />)
    expect(container).toBeEmptyDOMElement()
  })
})
