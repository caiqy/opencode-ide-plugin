import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import type { ReactElement } from "react"
import { MarkdownRenderer } from "./MarkdownRenderer"
import { ThemeProvider } from "../state/ThemeContext"
import { getGeneratedImageUrl } from "../lib/fileUtils"
import { ideBridge } from "../lib/ideBridge"

const project = vi.hoisted(() => ({
  directory: null as string | null,
  worktree: null as string | null,
}))

vi.mock("../state/ProjectContext", () => ({
  useProject: () => ({
    directory: project.directory,
    worktree: project.worktree,
  }),
  useProjectOptional: () => ({
    directory: project.directory,
    worktree: project.worktree,
  }),
}))

function renderWithTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

describe("MarkdownRenderer", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    project.directory = null
    project.worktree = null
    window.getSelection()?.removeAllRanges()
  })

  it("为渲染容器提供长路径自动换行样式", () => {
    const { container } = renderWithTheme(<MarkdownRenderer>普通文本</MarkdownRenderer>)
    const root = container.querySelector(".markdown-content")

    expect(root).toBeTruthy()
    expect(root).toHaveClass("break-words")
    expect(root).toHaveClass("[overflow-wrap:anywhere]")
  })

  it("相同复杂 Markdown 重渲染时保留正文 DOM 节点", () => {
    const markdown = [
      "1. 合并到 `opencode/dev`，保持本地。",
      "2. 检查 `packages/opencode/webgui/src/components/MarkdownRenderer.tsx`。",
    ].join("\n")
    const view = renderWithTheme(<MarkdownRenderer>{markdown}</MarkdownRenderer>)
    const code = screen.getByText("opencode/dev")
    const item = code.closest("li")
    const start = item?.firstChild
    const end = code.firstChild

    expect(item).toBeTruthy()
    expect(start).toBeTruthy()
    expect(end).toBeTruthy()

    const range = document.createRange()
    range.setStart(start!, 0)
    range.setEnd(end!, end!.textContent?.length ?? 0)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    const selected = selection.toString()

    expect(selected).toContain("opencode/dev")
    expect(selection.anchorNode).toBe(start)
    expect(selection.anchorOffset).toBe(0)
    expect(selection.focusNode).toBe(end)
    expect(selection.focusOffset).toBe(end!.textContent?.length ?? 0)

    view.rerender(
      <ThemeProvider>
        <MarkdownRenderer>{markdown}</MarkdownRenderer>
      </ThemeProvider>,
    )

    const activeRange = selection.getRangeAt(0)
    expect(activeRange.startContainer).toBe(start)
    expect(activeRange.startOffset).toBe(0)
    expect(activeRange.endContainer).toBe(end)
    expect(activeRange.endOffset).toBe(end!.textContent?.length ?? 0)
    expect(screen.getByText("opencode/dev")).toBe(code)
    expect(code.closest("li")).toBe(item)
    expect(code.isConnected).toBe(true)
    expect(range.startContainer.isConnected).toBe(true)
    expect(range.endContainer.isConnected).toBe(true)
    expect(selection.toString()).toBe(selected)
    expect(selection.anchorNode).toBe(start)
    expect(selection.anchorOffset).toBe(0)
    expect(selection.focusNode).toBe(end)
    expect(selection.focusOffset).toBe(end!.textContent?.length ?? 0)
    selection.removeAllRanges()
  })

  it("正文变化时更新变更文本并保留未变行内代码节点", () => {
    const view = renderWithTheme(<MarkdownRenderer>{"1. 保持 `stable`。\n2. 旧内容。"}</MarkdownRenderer>)
    const code = screen.getByText("stable")

    view.rerender(
      <ThemeProvider>
        <MarkdownRenderer>{"1. 保持 `stable`。\n2. 新内容。"}</MarkdownRenderer>
      </ThemeProvider>,
    )

    expect(screen.getByText("stable")).toBe(code)
    expect(screen.getByText("新内容。")).toBeInTheDocument()
    expect(screen.queryByText("旧内容。")).toBeNull()
  })

  it("inline 变化时使用 inline Markdown 结构", () => {
    const view = renderWithTheme(<MarkdownRenderer>文本</MarkdownRenderer>)

    view.rerender(
      <ThemeProvider>
        <MarkdownRenderer inline>文本</MarkdownRenderer>
      </ThemeProvider>,
    )

    const root = view.container.querySelector(".markdown-content")
    expect(root?.tagName).toBe("SPAN")
    expect(root?.firstElementChild?.tagName).toBe("SPAN")
  })

  it("项目目录变化时使用新目录解析 generated image", () => {
    project.directory = "D:\\project-a"
    const view = renderWithTheme(<MarkdownRenderer>{"![生成图](.opencode/generated-images/demo.png)"}</MarkdownRenderer>)

    expect(screen.getByRole("img", { name: "生成图" }).getAttribute("src")).toBe(
      getGeneratedImageUrl(".opencode/generated-images/demo.png", project.directory),
    )

    project.directory = "D:\\project-b"
    view.rerender(
      <ThemeProvider>
        <MarkdownRenderer>{"![生成图](.opencode/generated-images/demo.png)"}</MarkdownRenderer>
      </ThemeProvider>,
    )

    expect(screen.getByRole("img", { name: "生成图" }).getAttribute("src")).toBe(
      getGeneratedImageUrl(".opencode/generated-images/demo.png", project.directory),
    )
  })

  it("tone 变化时更新 Markdown 样式", () => {
    const view = renderWithTheme(<MarkdownRenderer>主题文本</MarkdownRenderer>)

    view.rerender(
      <ThemeProvider>
        <MarkdownRenderer tone="muted">主题文本</MarkdownRenderer>
      </ThemeProvider>,
    )

    const paragraph = screen.getByText("主题文本")
    expect(paragraph).toHaveClass("text-gray-600")
    expect(paragraph).toHaveClass("dark:text-gray-400")
    expect(paragraph).not.toHaveClass("text-gray-900")
  })

  it("内联 code 路径支持断行", () => {
    renderWithTheme(
      <MarkdownRenderer>{"路径：`C:\\Users\\alice\\very\\long\\project\\src\\feature\\index.ts`"}</MarkdownRenderer>,
    )

    const inlineCode = screen.getByText("C:\\Users\\alice\\very\\long\\project\\src\\feature\\index.ts")
    expect(inlineCode.tagName.toLowerCase()).toBe("code")
    expect(inlineCode).toHaveClass("break-all")
    expect(inlineCode).toHaveClass("whitespace-pre-wrap")
    expect(inlineCode).toHaveClass("inline")
  })

  it("默认 tone 保持正文高对比颜色", () => {
    renderWithTheme(<MarkdownRenderer>默认颜色文本</MarkdownRenderer>)

    const paragraph = screen.getByText("默认颜色文本")
    expect(paragraph.tagName.toLowerCase()).toBe("p")
    expect(paragraph).toHaveClass("text-gray-900")
    expect(paragraph).toHaveClass("dark:text-gray-100")
  })

  it("muted tone 使用灰色文本", () => {
    renderWithTheme(<MarkdownRenderer tone="muted">灰色文本</MarkdownRenderer>)

    const paragraph = screen.getByText("灰色文本")
    expect(paragraph.tagName.toLowerCase()).toBe("p")
    expect(paragraph).toHaveClass("text-gray-600")
    expect(paragraph).toHaveClass("dark:text-gray-400")
    expect(paragraph).not.toHaveClass("text-gray-900")
  })

  it("muted tone 下 inline code 使用继承色而不是固定白色", () => {
    renderWithTheme(<MarkdownRenderer tone="muted">{"包含 `MarkdownRenderer` 片段"}</MarkdownRenderer>)

    const inlineCode = screen.getByText("MarkdownRenderer")
    expect(inlineCode.tagName.toLowerCase()).toBe("code")
    expect(inlineCode).toHaveClass("text-inherit")
    expect(inlineCode).not.toHaveClass("text-gray-900")
    expect(inlineCode).not.toHaveClass("dark:text-gray-100")
  })

  it("muted tone 下链接尽量使用灰色而不是蓝色", () => {
    renderWithTheme(<MarkdownRenderer tone="muted">{"[OpenCode](https://example.com)"}</MarkdownRenderer>)

    const link = screen.getByRole("link", { name: "OpenCode" })
    expect(link).toHaveClass("text-gray-600")
    expect(link).toHaveClass("dark:text-gray-400")
    expect(link).not.toHaveClass("text-blue-600")
    expect(link).not.toHaveClass("dark:text-blue-400")
  })

  it.each(["D:/repo/README.md", String.raw`D:\repo\opencode.vsix`])("本地文件链接交给 IDE 打开：%s", (path) => {
    const request = vi.spyOn(ideBridge, "request").mockResolvedValue({ type: "reply" })
    renderWithTheme(<MarkdownRenderer>{`[打开文件](${path})`}</MarkdownRenderer>)

    fireEvent.click(screen.getByText("打开文件"))

    expect(request).toHaveBeenCalledWith("openFile", { path })
  })

  it("相对文件行号使用项目目录并交给 IDE 打开", () => {
    project.directory = "D:\\repo"
    const request = vi.spyOn(ideBridge, "request").mockResolvedValue({ type: "reply" })
    renderWithTheme(<MarkdownRenderer>{"[README](README.md:10)"}</MarkdownRenderer>)

    fireEvent.click(screen.getByText("README"))

    expect(request).toHaveBeenCalledWith("openFile", { path: "D:\\repo/README.md:10" })
  })

  it("file URL 保留编码后交给 IDE 打开", () => {
    const request = vi.spyOn(ideBridge, "request").mockResolvedValue({ type: "reply" })
    const path = "file:///D:/repo/a%23b.md"
    renderWithTheme(<MarkdownRenderer>{`[编码文件](${path})`}</MarkdownRenderer>)

    fireEvent.click(screen.getByText("编码文件"))

    expect(request).toHaveBeenCalledWith("openFile", { path })
  })

  it("muted tone 下代码块正文使用灰色文本", () => {
    renderWithTheme(<MarkdownRenderer tone="muted">{"```ts\nconst a = 1\n```"}</MarkdownRenderer>)

    const code = screen.getByText("const a = 1")
    const pre = code.closest("pre")
    expect(pre).toBeTruthy()
    expect(pre).toHaveClass("text-gray-600")
    expect(pre).toHaveClass("dark:text-gray-400")
  })

  it("generated-images Markdown 图片使用专用图片路由", () => {
    renderWithTheme(<MarkdownRenderer>{"![生成图](.opencode/generated-images/demo.png)"}</MarkdownRenderer>)

    const image = screen.getByRole("img", { name: "生成图" })

    expect(image.getAttribute("src")).toBe(getGeneratedImageUrl(".opencode/generated-images/demo.png", null))
  })

  it("generated-images Markdown 图片携带当前目录上下文", () => {
    project.directory = "D:\\repo with space"
    project.worktree = "D:\\repo"

    renderWithTheme(<MarkdownRenderer>{"![生成图](.opencode/generated-images/demo.png)"}</MarkdownRenderer>)

    expect(screen.getByRole("img", { name: "生成图" }).getAttribute("src")).toBe(
      getGeneratedImageUrl(".opencode/generated-images/demo.png", project.directory),
    )
  })

  it("generated-images Markdown 图片在目录未就绪时使用 worktree 兜底", () => {
    project.worktree = "D:\\repo"

    renderWithTheme(<MarkdownRenderer>{"![生成图](.opencode/generated-images/demo.png)"}</MarkdownRenderer>)

    expect(screen.getByRole("img", { name: "生成图" }).getAttribute("src")).toBe(
      getGeneratedImageUrl(".opencode/generated-images/demo.png", project.worktree),
    )
  })

  it("inline generated-images Markdown 图片也使用 worktree 兜底", () => {
    project.worktree = "D:\\repo"

    renderWithTheme(<MarkdownRenderer inline>{"![生成图](.opencode/generated-images/demo.png)"}</MarkdownRenderer>)

    expect(screen.getByRole("img", { name: "生成图" }).getAttribute("src")).toBe(
      getGeneratedImageUrl(".opencode/generated-images/demo.png", project.worktree),
    )
  })

  it("generated-images Markdown 图片兼容点斜杠与反斜杠路径", () => {
    renderWithTheme(<MarkdownRenderer>{"![生成图](.\\.opencode\\generated-images\\demo.png)"}</MarkdownRenderer>)

    expect(screen.getByRole("img", { name: "生成图" }).getAttribute("src")).toBe(
      getGeneratedImageUrl(".opencode/generated-images/demo.png", null),
    )
  })

  it("generated-images Markdown 图片兼容编码反斜杠路径", () => {
    renderWithTheme(<MarkdownRenderer>{"![生成图](.opencode%5Cgenerated-images%5Cdemo.png)"}</MarkdownRenderer>)

    expect(screen.getByRole("img", { name: "生成图" }).getAttribute("src")).toBe(
      getGeneratedImageUrl(".opencode/generated-images/demo.png", null),
    )
  })

  it("网络 Markdown 图片保持原始地址", () => {
    renderWithTheme(<MarkdownRenderer>{"![远程图](https://example.com/image.png)"}</MarkdownRenderer>)

    expect(screen.getByRole("img", { name: "远程图" }).getAttribute("src")).toBe("https://example.com/image.png")
  })

  it("普通绝对和相对 Markdown 图片保持原始地址", () => {
    renderWithTheme(<MarkdownRenderer>{"![绝对图](/assets/a.png)\n![相对图](./assets/b.png)"}</MarkdownRenderer>)

    expect(screen.getByRole("img", { name: "绝对图" }).getAttribute("src")).toBe("/assets/a.png")
    expect(screen.getByRole("img", { name: "相对图" }).getAttribute("src")).toBe("./assets/b.png")
  })

  it("data 与 blob Markdown 图片保持原始地址", () => {
    const data = "data:image/png;base64,AA=="
    const blob = "blob:https://example.com/preview-id"

    renderWithTheme(<MarkdownRenderer>{`![Data 图](${data})\n![Blob 图](${blob})`}</MarkdownRenderer>)

    expect(screen.getByRole("img", { name: "Data 图" }).getAttribute("src")).toBe(data)
    expect(screen.getByRole("img", { name: "Blob 图" }).getAttribute("src")).toBe(blob)
  })

  it("非 base64 的 data image Markdown 图片保持原始地址", () => {
    const svg = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E"

    renderWithTheme(<MarkdownRenderer>{`![SVG 图](${svg})`}</MarkdownRenderer>)

    expect(screen.getByRole("img", { name: "SVG 图" }).getAttribute("src")).toBe(svg)
  })

  it("无 alt 的 Markdown 图片使用文件名作为可访问名称", () => {
    renderWithTheme(<MarkdownRenderer>{"![](.opencode/generated-images/demo.png)"}</MarkdownRenderer>)

    expect(screen.getByRole("button", { name: "查看图片：demo.png" })).toBeInTheDocument()
  })

  it("无 alt 的链接包裹 Markdown 图片使用文件名作为链接名称", () => {
    renderWithTheme(
      <MarkdownRenderer>{"[![](.opencode/generated-images/demo.png)](https://example.com)"}</MarkdownRenderer>,
    )

    const link = screen.getByRole("link", { name: "demo.png" })

    expect(link.querySelector("button")).toBeNull()
    expect(link.querySelector("img")?.getAttribute("alt")).toBe("demo.png")
  })

  it("Markdown 图片加载失败时显示稳定占位", () => {
    renderWithTheme(<MarkdownRenderer>{"![坏图](.opencode/generated-images/missing.png)"}</MarkdownRenderer>)

    fireEvent.error(screen.getByRole("img", { name: "坏图" }))

    expect(screen.getByText("图片预览不可用")).toBeInTheDocument()
    expect(screen.queryByRole("img", { name: "坏图" })).not.toBeInTheDocument()
    expect(screen.getByText("图片预览不可用")).toHaveClass("min-h-20")
  })

  it("Markdown 图片预览弹窗渲染到 markdown 容器外", () => {
    const { container } = renderWithTheme(
      <MarkdownRenderer>{"![生成图](.opencode/generated-images/demo.png)"}</MarkdownRenderer>,
    )

    fireEvent.click(screen.getByRole("button", { name: "查看图片：生成图" }))

    const root = container.querySelector(".markdown-content")
    const dialog = screen.getByRole("dialog")

    expect(root?.contains(dialog)).toBe(false)
  })

  it("链接包裹 Markdown 图片时不产生交互元素嵌套", () => {
    renderWithTheme(
      <MarkdownRenderer>{"[![生成图](.opencode/generated-images/demo.png)](https://example.com)"}</MarkdownRenderer>,
    )

    const link = screen.getByRole("link", { name: "生成图" })

    expect(link.querySelector("button")).toBeNull()
    expect(link.querySelector("img")?.getAttribute("src")).toBe(
      getGeneratedImageUrl(".opencode/generated-images/demo.png", null),
    )
  })
})
