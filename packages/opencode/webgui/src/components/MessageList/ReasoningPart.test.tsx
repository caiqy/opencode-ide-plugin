import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { PartOpenProvider } from "./PartOpenContext"
import { ReasoningPart } from "./ReasoningPart"

describe("ReasoningPart", () => {
  it("当 thinking 内容为空时不渲染可展开面板", () => {
    render(
      <PartOpenProvider items={[]}>
        <ReasoningPart
          part={{
            id: "r1",
            sessionID: "s1",
            messageID: "m1",
            type: "reasoning",
            text: "",
            time: { start: 1 },
          }}
          durationMs={1000}
        />
      </PartOpenProvider>,
    )

    expect(screen.getByText("Thought for 1s")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Thought for 1s" })).not.toBeInTheDocument()
  })
})
