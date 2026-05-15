import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ImagePreview } from "./ImagePreview"

describe("ImagePreview", () => {
  it("src 变化时重置失败状态并显示新图片", () => {
    const { rerender } = render(<ImagePreview src="missing-a.png" alt="预览图" />)

    fireEvent.error(screen.getByRole("img", { name: "预览图" }))
    expect(screen.getByText("图片预览不可用")).toBeInTheDocument()

    rerender(<ImagePreview src="ok-b.png" alt="预览图" />)

    expect(screen.queryByText("图片预览不可用")).not.toBeInTheDocument()
    expect(screen.getByRole("img", { name: "预览图" }).getAttribute("src")).toBe("ok-b.png")
  })

  it("无 alt 时使用文件名作为可访问名称和预览标题", () => {
    render(<ImagePreview src="https://example.com/images/plain.png" alt="" />)

    fireEvent.click(screen.getByRole("button", { name: "查看图片：plain.png" }))

    expect(screen.getByRole("dialog", { name: "plain.png" })).toBeInTheDocument()
  })

  it("src 变化时关闭已打开的预览层", () => {
    const { rerender } = render(<ImagePreview src="a.png" alt="预览图" />)

    fireEvent.click(screen.getByRole("button", { name: "查看图片：预览图" }))
    expect(screen.getByRole("dialog", { name: "预览图" })).toBeInTheDocument()

    rerender(<ImagePreview src="b.png" alt="预览图" />)

    expect(screen.queryByRole("dialog", { name: "预览图" })).not.toBeInTheDocument()
  })
})
