import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { ToolImageAttachments } from "./ToolImageAttachments"

describe("ToolImageAttachments", () => {
  it("前置非图片附件不导致图片编号跳号", () => {
    render(
      <ToolImageAttachments
        attachments={[
          {
            id: "text-1",
            mime: "text/plain",
            filename: "note.txt",
            url: "data:text/plain;base64,QQ==",
          },
          {
            id: "image-1",
            mime: "image/png",
            url: "data:image/png;base64,AA==",
          },
        ]}
      />,
    )

    expect(screen.getByText("Image #1")).toBeInTheDocument()
    expect(screen.getByText("generated-image-1.png")).toBeInTheDocument()
  })

  it("无图片或空 url 时不渲染内容", () => {
    const { container, rerender } = render(
      <ToolImageAttachments
        attachments={[
          {
            id: "text-1",
            mime: "text/plain",
            filename: "note.txt",
            url: "data:text/plain;base64,QQ==",
          },
          {
            id: "image-empty",
            mime: "image/png",
            filename: "empty.png",
            url: "",
          },
        ]}
      />,
    )

    expect(container.firstChild).toBeNull()

    rerender(
      <ToolImageAttachments
        attachments={[
          {
            id: "text-2",
            mime: "text/plain",
            filename: "readme.txt",
            url: "data:text/plain;base64,Qg==",
          },
        ]}
      />,
    )

    expect(container.firstChild).toBeNull()
  })

  it("无 filename 的 jpeg 附件使用 jpg 后缀", () => {
    render(
      <ToolImageAttachments
        attachments={[
          {
            id: "image-jpeg",
            mime: "image/jpeg",
            url: "data:image/jpeg;base64,AA==",
          },
        ]}
      />,
    )

    expect(screen.getByText("generated-image-1.jpg")).toBeInTheDocument()
  })

  it("图片卡片仅分别展示编号和文件名", () => {
    render(
      <ToolImageAttachments
        attachments={[
          {
            id: "image-1",
            mime: "image/png",
            filename: "preview.png",
            url: "data:image/png;base64,AA==",
          },
        ]}
      />,
    )

    expect(screen.getByText("Image #1")).toBeInTheDocument()
    expect(screen.getByText("preview.png")).toBeInTheDocument()
    expect(screen.queryByText("Image #1 preview.png")).not.toBeInTheDocument()
  })

  it("点击缩略图打开 ImageOverlay", () => {
    render(
      <ToolImageAttachments
        attachments={[
          {
            id: "image-1",
            mime: "image/png",
            filename: "preview.png",
            url: "data:image/png;base64,AA==",
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole("button"))

    expect(screen.getByLabelText("关闭")).toBeInTheDocument()
    expect(screen.queryByText("Image #1 - preview.png")).not.toBeInTheDocument()
    expect(screen.getAllByRole("img", { name: "preview.png" })).toHaveLength(2)
  })
})
