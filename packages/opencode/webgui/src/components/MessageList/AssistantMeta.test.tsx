import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { AssistantMeta } from "./AssistantMeta"

describe("AssistantMeta", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 4, 5, 14, 23, 18))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("完整格式渲染：Agent · Model · Variant · Duration", () => {
    render(<AssistantMeta agent="code" modelName="Claude Sonnet 4" variant="high" durationMs={23000} />)
    expect(screen.getByTestId("assistant-meta")).toHaveTextContent("Code · Claude Sonnet 4 · high · 23s")
  })

  it("有 completedAt 时追加完整结束时间", () => {
    const completedAt = new Date(2026, 4, 5, 14, 23, 18).getTime()

    render(
      <AssistantMeta
        agent="code"
        modelName="Claude Sonnet 4"
        variant="high"
        durationMs={23000}
        completedAt={completedAt}
      />,
    )

    expect(screen.getByTestId("assistant-meta")).toHaveTextContent(
      "Code · Claude Sonnet 4 · high · 23s · 今天 14:23:18",
    )
  })

  it("completedAt 与 interrupted 可同时显示", () => {
    const completedAt = new Date(2026, 4, 5, 14, 23, 18).getTime()

    render(
      <AssistantMeta
        agent="code"
        modelName="Claude Sonnet 4"
        variant="high"
        durationMs={23000}
        completedAt={completedAt}
        interrupted
      />,
    )

    expect(screen.getByTestId("assistant-meta")).toHaveTextContent(
      "Code · Claude Sonnet 4 · high · 23s · 今天 14:23:18 · interrupted",
    )
  })

  it("非法 completedAt 时不显示结束时间", () => {
    render(
      <AssistantMeta
        agent="code"
        modelName="Claude Sonnet 4"
        variant="high"
        durationMs={23000}
        completedAt={Number.MAX_SAFE_INTEGER}
      />,
    )

    expect(screen.getByTestId("assistant-meta").textContent).toBe("Code · Claude Sonnet 4 · high · 23s")
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
