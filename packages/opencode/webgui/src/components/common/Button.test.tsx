import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Button } from "./Button"

describe("Button", () => {
  it("renders with default props", () => {
    render(<Button>Click me</Button>)
    const button = screen.getByRole("button", { name: /click me/i })
    expect(button).toBeInTheDocument()
    expect(button).toHaveClass("modern-button", "modern-button-primary", "h-9", "px-3", "text-sm")
  })

  it("renders with custom variant", () => {
    render(<Button variant="secondary">Secondary Button</Button>)
    const button = screen.getByRole("button")
    expect(button).toHaveClass("modern-button-secondary")
  })

  it("renders with danger variant", () => {
    render(<Button variant="danger">Delete</Button>)
    const button = screen.getByRole("button")
    expect(button).toHaveClass("modern-button-danger")
  })

  it("renders with ghost variant", () => {
    render(<Button variant="ghost">Ghost Button</Button>)
    const button = screen.getByRole("button")
    expect(button).toHaveClass("modern-button-ghost")
  })

  it("renders with different sizes", () => {
    const { rerender } = render(<Button size="xs">Extra Small</Button>)
    let button = screen.getByRole("button")
    expect(button).toHaveClass("h-6", "px-2", "text-xs")

    rerender(<Button size="sm">Small</Button>)
    button = screen.getByRole("button")
    expect(button).toHaveClass("h-7", "px-2.5", "text-sm")

    rerender(<Button size="lg">Large</Button>)
    button = screen.getByRole("button")
    expect(button).toHaveClass("h-10", "px-4", "text-base")
  })

  it("shows loading state", () => {
    render(<Button loading>Submit</Button>)
    const button = screen.getByRole("button")
    expect(button).toBeDisabled()
    expect(screen.getByText("加载中…")).toBeInTheDocument()
    expect(button.querySelector("svg")).toBeInTheDocument()
  })

  it("is disabled when disabled prop is true", () => {
    render(<Button disabled>Disabled Button</Button>)
    const button = screen.getByRole("button")
    expect(button).toBeDisabled()
  })

  it("handles click events", async () => {
    const user = userEvent.setup()
    const handleClick = vi.fn()
    render(<Button onClick={handleClick}>Click me</Button>)
    const button = screen.getByRole("button")
    await user.click(button)
    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it("does not call onClick when disabled", async () => {
    const user = userEvent.setup()
    const handleClick = vi.fn()
    render(
      <Button disabled onClick={handleClick}>
        Disabled Button
      </Button>,
    )
    const button = screen.getByRole("button")
    await user.click(button)
    expect(handleClick).not.toHaveBeenCalled()
  })

  it("does not call onClick when loading", async () => {
    const user = userEvent.setup()
    const handleClick = vi.fn()
    render(
      <Button loading onClick={handleClick}>
        Loading Button
      </Button>,
    )
    const button = screen.getByRole("button")
    await user.click(button)
    expect(handleClick).not.toHaveBeenCalled()
  })

  it("applies custom className", () => {
    render(<Button className="custom-class">Custom</Button>)
    const button = screen.getByRole("button")
    expect(button).toHaveClass("custom-class")
  })

  it("passes through HTML button attributes", () => {
    render(
      <Button type="submit" data-testid="submit-btn" aria-label="Submit form">
        Submit
      </Button>,
    )
    const button = screen.getByTestId("submit-btn")
    expect(button).toHaveAttribute("type", "submit")
    expect(button).toHaveAttribute("aria-label", "Submit form")
  })
})
