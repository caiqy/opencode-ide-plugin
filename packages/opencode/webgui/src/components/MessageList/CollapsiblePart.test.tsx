import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CollapsiblePart } from "./CollapsiblePart"

describe("CollapsiblePart", () => {
  it("支持受控展开状态", async () => {
    const user = userEvent.setup()
    const onExpandedChange = vi.fn()

    render(
      <CollapsiblePart
        trigger={<span>Thinking</span>}
        content={<div>details</div>}
        expanded={false}
        onExpandedChange={onExpandedChange}
      />,
    )

    expect(screen.queryByText("details")).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Thinking" }))
    expect(onExpandedChange).toHaveBeenCalledWith(true)
    expect(screen.queryByText("details")).not.toBeInTheDocument()
  })

  it("未受控时点击可切换展开", async () => {
    const user = userEvent.setup()

    render(<CollapsiblePart trigger={<span>Tool</span>} content={<div>output</div>} />)

    expect(screen.queryByText("output")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Tool" }))
    expect(screen.getByText("output")).toBeInTheDocument()
  })
})
