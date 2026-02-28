import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import type { ReactElement } from "react"
import { MarkdownRenderer } from "./MarkdownRenderer"
import { ThemeProvider } from "../state/ThemeContext"

function renderWithTheme(ui: ReactElement) {
  return render(<ThemeProvider>{ui}</ThemeProvider>)
}

describe("MarkdownRenderer", () => {
  it("为渲染容器提供长路径自动换行样式", () => {
    const { container } = renderWithTheme(<MarkdownRenderer>普通文本</MarkdownRenderer>)
    const root = container.querySelector(".markdown-content")

    expect(root).toBeTruthy()
    expect(root).toHaveClass("break-words")
    expect(root).toHaveClass("[overflow-wrap:anywhere]")
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

  it("muted tone 下代码块正文使用灰色文本", () => {
    renderWithTheme(<MarkdownRenderer tone="muted">{"```ts\nconst a = 1\n```"}</MarkdownRenderer>)

    const code = screen.getByText("const a = 1")
    const pre = code.closest("pre")
    expect(pre).toBeTruthy()
    expect(pre).toHaveClass("text-gray-600")
    expect(pre).toHaveClass("dark:text-gray-400")
  })
})
