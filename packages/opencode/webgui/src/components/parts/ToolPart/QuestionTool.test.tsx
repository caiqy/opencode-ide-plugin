import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { QuestionTool } from "./QuestionTool"

describe("QuestionTool", () => {
  it("已完成状态复用待回答问题卡片的配色体系与边框", () => {
    const { container } = render(
      <QuestionTool
        mode="completed"
        questions={
          [
            {
              header: "来源",
              question: "应该从哪个 Release 页面查询更新？",
              options: [
                { label: "当前项目自身的 Release", description: "与现有 VSIX 名称匹配的当前仓库 Release" },
                { label: "上游 opencode-ai/opencode", description: "查询上游仓库的 Release" },
              ],
            },
          ] as any
        }
        answers={[["当前项目自身的 Release"]]}
      />,
    )

    const root = container.firstElementChild as HTMLElement

    expect(screen.getByText("已完成")).toBeInTheDocument()
    expect(root).toHaveClass("border-blue-300", "bg-gray-50")
    expect(container.querySelector(".bg-blue-600")).toBeTruthy()
    expect(container.querySelector(".border-blue-500")).toBeTruthy()
    expect(container.querySelector(".bg-slate-950")).toBeNull()
  })

  it("已忽略状态也沿用问题卡片配色体系，但整体弱化", () => {
    const { container } = render(
      <QuestionTool
        mode="ignored"
        questions={
          [
            {
              header: "来源",
              question: "应该从哪个 Release 页面查询更新？",
              options: [{ label: "当前项目自身的 Release", description: "当前项目 repo 的 Release" }],
            },
          ] as any
        }
        answers={[[]]}
      />,
    )

    const root = container.firstElementChild as HTMLElement

    expect(screen.getByText("已忽略")).toBeInTheDocument()
    expect(root).toHaveClass("border-blue-300", "bg-gray-50")
    expect(root).toHaveClass("opacity-80")
    expect(container.querySelector(".bg-blue-50")).toBeTruthy()
    expect(container.querySelector(".bg-slate-950")).toBeNull()
  })
})
