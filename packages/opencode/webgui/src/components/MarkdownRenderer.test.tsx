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
})
