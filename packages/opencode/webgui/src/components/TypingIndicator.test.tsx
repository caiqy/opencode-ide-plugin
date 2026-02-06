import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { TypingIndicator } from "./TypingIndicator"

vi.mock("../state/SessionContext", () => ({
  useSession: () => ({
    currentStatus: { type: "idle", attempt: 0, message: "", next: Date.now() },
  }),
}))

describe("TypingIndicator", () => {
  it("显示 Generating 时应与底部保持更大间距", () => {
    render(<TypingIndicator visible={true} />)

    const text = screen.getByText("Generating")
    const button = text.closest("button")
    expect(button).toBeTruthy()
    const wrap = button?.parentElement

    expect(wrap).toHaveClass("mb-3")
  })
})
