import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { beforeEach } from "vitest"
import { getGeneratedImageUrl } from "../../../lib/fileUtils"
import { ToolImageAttachments } from "./ToolImageAttachments"

const project = vi.hoisted(() => ({
  directory: null as string | null,
}))

vi.mock("../../../state/ProjectContext", () => ({
  useProject: () => ({
    directory: project.directory,
    worktree: project.directory,
  }),
}))

describe("ToolImageAttachments", () => {
  beforeEach(() => {
    project.directory = null
  })

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

  it("relativePath + directory 时使用带实例上下文的专用图片路由并显示引用路径", () => {
    const relativePath = ".opencode/generated-images/foo bar.png"
    project.directory = "/repo/subdir"

    render(
      <ToolImageAttachments
        attachments={[
          {
            id: "image-1",
            mime: "image/png",
            filename: "preview.png",
            relativePath,
            url: "data:image/png;base64,AA==",
          },
        ]}
      />,
    )

    const image = screen.getByRole("img", { name: "preview.png" })

    expect(image.getAttribute("src")).toBe(getGeneratedImageUrl(relativePath, project.directory))
    expect(screen.getByText(relativePath)).toBeInTheDocument()
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

  it("预览打开时继续使用 relativePath 生成的图片路由", () => {
    const relativePath = ".opencode/generated-images/nested/preview 1.png"
    project.directory = "/repo/subdir"

    render(
      <ToolImageAttachments
        attachments={[
          {
            id: "image-1",
            mime: "image/png",
            filename: "preview.png",
            relativePath,
            url: "data:image/png;base64,AA==",
          },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole("button"))

    expect(screen.getAllByRole("img", { name: "preview.png" }).map((image) => image.getAttribute("src"))).toEqual([
      getGeneratedImageUrl(relativePath, project.directory),
      getGeneratedImageUrl(relativePath, project.directory),
    ])
  })

  it("relativePath 图片加载失败时显示预览不可用且不影响引用路径展示", () => {
    const relativePath = ".opencode/generated-images/missing-preview.png"

    render(
      <ToolImageAttachments
        attachments={[
          {
            id: "image-1",
            mime: "image/png",
            filename: "preview.png",
            relativePath,
            url: "data:image/png;base64,AA==",
          },
        ]}
      />,
    )

    fireEvent.error(screen.getByRole("img", { name: "preview.png" }))

    expect(screen.getByText("预览不可用")).toBeInTheDocument()
    expect(screen.queryByRole("img", { name: "preview.png" })).not.toBeInTheDocument()
    expect(screen.getByText(relativePath)).toBeInTheDocument()
  })

  it("旧 data URL 图片附件仍可正常显示", () => {
    const url = "data:image/png;base64,AA=="

    render(
      <ToolImageAttachments
        attachments={[
          {
            id: "image-1",
            mime: "image/png",
            filename: "preview.png",
            url,
          },
        ]}
      />,
    )

    expect(screen.getByRole("img", { name: "preview.png" }).getAttribute("src")).toBe(url)
  })
})
