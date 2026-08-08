import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { PartOpenProvider } from "./PartOpenContext"
import { ReasoningPart } from "./ReasoningPart"

describe("ReasoningPart", () => {
  it("当 thinking 内容仅包含 HTML 注释时不渲染可展开面板", () => {
    render(
      <PartOpenProvider items={[]}>
        <ReasoningPart
          part={{
            id: "r1",
            sessionID: "s1",
            messageID: "m1",
            type: "reasoning",
            text: "\\<!-- hidden -->",
            time: { start: 1 },
          }}
          durationMs={1000}
        />
      </PartOpenProvider>,
    )

    expect(screen.getByText("思考了 1 秒")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "思考了 1 秒" })).not.toBeInTheDocument()
  })

  it("隐藏 HTML 注释并保留相邻推理内容", () => {
    render(
      <PartOpenProvider items={[]}>
        <ReasoningPart
          part={{
            id: "r2",
            sessionID: "s1",
            messageID: "m1",
            type: "reasoning",
            text: "Before\n\n<!-- hidden\ncomment -->\n\nAfter",
            time: { start: 1 },
          }}
          durationMs={1000}
        />
      </PartOpenProvider>,
    )

    expect(screen.getByText("Before")).toBeInTheDocument()
    expect(screen.getByText("After")).toBeInTheDocument()
    expect(screen.queryByText(/hidden|comment/)).not.toBeInTheDocument()
  })

  it("流式注释闭合前保持隐藏并在闭合后显示正文", () => {
    const part = {
      id: "r3",
      sessionID: "s1",
      messageID: "m1",
      type: "reasoning" as const,
      text: "\\<!-- hidden",
      time: { start: 1 },
    }
    const view = render(
      <PartOpenProvider items={[]}>
        <ReasoningPart part={part} durationMs={1000} />
      </PartOpenProvider>,
    )

    expect(screen.queryByRole("button", { name: "思考了 1 秒" })).not.toBeInTheDocument()
    expect(screen.queryByText(/hidden/)).not.toBeInTheDocument()

    view.rerender(
      <PartOpenProvider items={[]}>
        <ReasoningPart part={{ ...part, text: "\\<!-- hidden -->After" }} durationMs={1000} />
      </PartOpenProvider>,
    )

    expect(screen.getByText("After")).toBeInTheDocument()
    expect(screen.queryByText(/hidden/)).not.toBeInTheDocument()
  })

  it("shows interrupted instead of thinking for an unfinished idle part", () => {
    render(
      <PartOpenProvider items={[]}>
        <ReasoningPart
          part={{ id: "r4", sessionID: "s1", messageID: "m1", type: "reasoning", text: "partial" }}
          interrupted
        />
      </PartOpenProvider>,
    )

    expect(screen.getByText("思考已中断")).toBeInTheDocument()
    expect(screen.queryByText("思考中…")).not.toBeInTheDocument()
  })
})
