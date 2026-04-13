import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { AssistantMeta } from "./AssistantMeta"

describe("AssistantMeta", () => {
  it("完整格式渲染：Agent · Model · Variant · Duration", () => {
    render(<AssistantMeta agent="code" modelName="Claude Sonnet 4" variant="high" durationMs={23000} />)
    expect(screen.getByTestId("assistant-meta")).toHaveTextContent("Code · Claude Sonnet 4 · high · 23s")
  })

  it("无 variant 时省略", () => {
    render(<AssistantMeta agent="code" modelName="Claude Sonnet 4" durationMs={23000} />)
    expect(screen.getByTestId("assistant-meta")).toHaveTextContent("Code · Claude Sonnet 4 · 23s")
  })

  it("中断时显示 interrupted", () => {
    render(<AssistantMeta agent="code" modelName="Claude Sonnet 4" variant="high" durationMs={23000} interrupted />)
    expect(screen.getByTestId("assistant-meta")).toHaveTextContent("Code · Claude Sonnet 4 · high · 23s · interrupted")
  })

  it("分钟级 duration 格式化", () => {
    render(<AssistantMeta agent="code" modelName="GPT-4o" durationMs={133000} />)
    expect(screen.getByTestId("assistant-meta")).toHaveTextContent("Code · GPT-4o · 2m 13s")
  })

  it("无 duration 时省略", () => {
    render(<AssistantMeta agent="code" modelName="Claude Sonnet 4" />)
    expect(screen.getByTestId("assistant-meta")).toHaveTextContent("Code · Claude Sonnet 4")
  })

  it("所有字段为空时不渲染", () => {
    const { container } = render(<AssistantMeta agent="" modelName="" />)
    expect(container.querySelector("[data-testid='assistant-meta']")).toBeNull()
  })
})
