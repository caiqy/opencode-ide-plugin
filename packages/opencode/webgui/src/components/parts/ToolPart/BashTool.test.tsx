import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { BashTool } from "./BashTool"

describe("BashTool", () => {
  it("bash 输出容器支持超长路径断行", () => {
    render(<BashTool command="pwd" output="C:\\Users\\alice\\very\\long\\project\\src\\feature\\index.ts" />)

    const pre = screen.getByText("$ pwd").closest("pre")
    expect(pre).toBeTruthy()
    expect(pre).toHaveClass("break-words")
    expect(pre).toHaveClass("[overflow-wrap:anywhere]")
  })
})
