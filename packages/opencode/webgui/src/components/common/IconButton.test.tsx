import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { IconButton } from "./IconButton"

const TestIcon = () => <svg data-testid="test-icon" />

describe("IconButton", () => {
  it("renders with default props", () => {
    render(<IconButton icon={<TestIcon />} aria-label="Test button" />)
    const button = screen.getByRole("button", { name: /test button/i })
    expect(button).toBeInTheDocument()
    expect(button).toHaveClass("modern-icon-button", "w-7", "h-7")
    expect(screen.getByTestId("test-icon")).toBeInTheDocument()
  })

  it("requires aria-label for accessibility", () => {
    render(<IconButton icon={<TestIcon />} aria-label="Required label" />)
    const button = screen.getByRole("button")
    expect(button).toHaveAttribute("aria-label", "Required label")
  })

  it("renders with small size", () => {
    render(<IconButton size="sm" icon={<TestIcon />} aria-label="Small button" />)
    const button = screen.getByRole("button")
    expect(button).toHaveClass("w-6", "h-6")
  })

  it("renders with large size", () => {
    render(<IconButton size="lg" icon={<TestIcon />} aria-label="Large button" />)
    const button = screen.getByRole("button")
    expect(button).toHaveClass("w-8", "h-8")
  })

  it("handles click events", async () => {
    const user = userEvent.setup()
    const handleClick = vi.fn()
    render(<IconButton icon={<TestIcon />} aria-label="Clickable" onClick={handleClick} />)
    const button = screen.getByRole("button")
    await user.click(button)
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it("can be disabled", async () => {
    const user = userEvent.setup()
    const handleClick = vi.fn()
    render(<IconButton icon={<TestIcon />} aria-label="Disabled" disabled onClick={handleClick} />)
    const button = screen.getByRole("button")
    expect(button).toBeDisabled()
    await user.click(button)
    expect(handleClick).not.toHaveBeenCalled()
  })

  it("applies custom className", () => {
    render(<IconButton icon={<TestIcon />} aria-label="Custom" className="custom-class" />)
    const button = screen.getByRole("button")
    expect(button).toHaveClass("custom-class")
  })

  it("passes through HTML button attributes", () => {
    render(
      <IconButton
        icon={<TestIcon />}
        aria-label="With attributes"
        type="submit"
        data-testid="icon-btn"
        title="Tooltip text"
      />,
    )
    const button = screen.getByTestId("icon-btn")
    expect(button).toHaveAttribute("type", "submit")
    expect(button).toHaveAttribute("title", "Tooltip text")
  })
})
