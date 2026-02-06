import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { MessageStats } from "./MessageStats"

describe("MessageStats", () => {
  it("弹出的 token usage 面板在 dark 模式下应有正确的文本颜色类", async () => {
    const user = userEvent.setup()
    const { container } = render(
      <MessageStats
        tokens={{
          input: 1,
          output: 2,
          reasoning: 3,
          cache: { read: 4, write: 5 },
        }}
        cost={0.01}
      />,
    )

    await user.click(screen.getByRole("button", { name: "Show token usage" }))
    expect(screen.getByText("Total")).toBeInTheDocument()

    const popover = container.querySelector(".modern-card")
    expect(popover).toBeTruthy()
    expect(popover).toHaveClass("text-gray-900")
    expect(popover).toHaveClass("dark:text-gray-100")
  })
})
