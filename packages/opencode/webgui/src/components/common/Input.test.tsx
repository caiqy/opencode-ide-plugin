import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Input } from "./Input"
import { createRef } from "react"

const TestIcon = () => <svg data-testid="test-icon" />

describe("Input", () => {
  it("renders with default props", () => {
    render(<Input />)
    const input = screen.getByRole("textbox")
    expect(input).toBeInTheDocument()
    expect(input).toHaveClass("modern-input", "h-9", "px-3", "text-sm")
  })

  it("renders with label", () => {
    render(<Input label="Username" />)
    expect(screen.getByLabelText("Username")).toBeInTheDocument()
    expect(screen.getByText("Username")).toBeInTheDocument()
  })

  it("renders with error message", () => {
    render(<Input label="Email" error="Invalid email address" />)
    const input = screen.getByRole("textbox")
    expect(screen.getByText("Invalid email address")).toBeInTheDocument()
    expect(input).toHaveAttribute("aria-invalid", "true")
  })

  it("renders with helper text", () => {
    render(<Input label="Password" helperText="Must be at least 8 characters" />)
    expect(screen.getByText("Must be at least 8 characters")).toBeInTheDocument()
  })

  it("does not show helper text when error is present", () => {
    render(<Input label="Field" error="Error message" helperText="Helper text" />)
    expect(screen.getByText("Error message")).toBeInTheDocument()
    expect(screen.queryByText("Helper text")).not.toBeInTheDocument()
  })

  it("renders with different sizes", () => {
    const { rerender } = render(<Input inputSize="sm" />)
    let input = screen.getByRole("textbox")
    expect(input).toHaveClass("h-7", "px-2", "text-xs")

    rerender(<Input inputSize="lg" />)
    input = screen.getByRole("textbox")
    expect(input).toHaveClass("h-10", "px-4", "text-base")
  })

  it("renders with left icon", () => {
    render(<Input leftIcon={<TestIcon />} />)
    expect(screen.getByTestId("test-icon")).toBeInTheDocument()
    expect(screen.getByRole("textbox")).toHaveClass("pl-10")
  })

  it("renders with right icon", () => {
    render(<Input rightIcon={<TestIcon />} />)
    expect(screen.getByTestId("test-icon")).toBeInTheDocument()
    expect(screen.getByRole("textbox")).toHaveClass("pr-10")
  })

  it("handles user input", async () => {
    const user = userEvent.setup()
    render(<Input />)
    const input = screen.getByRole("textbox")
    await user.type(input, "Hello World")
    expect(input).toHaveValue("Hello World")
  })

  it("calls onChange handler", async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(<Input onChange={handleChange} />)
    const input = screen.getByRole("textbox")
    await user.type(input, "test")
    expect(handleChange).toHaveBeenCalled()
  })

  it("can be disabled", () => {
    render(<Input disabled />)
    const input = screen.getByRole("textbox")
    expect(input).toBeDisabled()
    expect(input).toHaveClass("cursor-not-allowed", "opacity-60")
  })

  it("forwards ref correctly", () => {
    const ref = createRef<HTMLInputElement>()
    render(<Input ref={ref} />)
    expect(ref.current).toBeInstanceOf(HTMLInputElement)
  })

  it("applies custom className", () => {
    render(<Input className="custom-class" />)
    const input = screen.getByRole("textbox")
    expect(input).toHaveClass("custom-class")
  })

  it("passes through HTML input attributes", () => {
    render(<Input type="email" placeholder="Enter email" data-testid="email-input" />)
    const input = screen.getByTestId("email-input")
    expect(input).toHaveAttribute("type", "email")
    expect(input).toHaveAttribute("placeholder", "Enter email")
  })

  it("generates unique id when not provided", () => {
    const { container } = render(<Input label="Field 1" />)
    const input1 = container.querySelector("input")
    const id1 = input1?.id

    const { container: container2 } = render(<Input label="Field 2" />)
    const input2 = container2.querySelector("input")
    const id2 = input2?.id

    expect(id1).toBeDefined()
    expect(id2).toBeDefined()
    expect(id1).not.toBe(id2)
  })

  it("uses provided id", () => {
    render(<Input id="custom-id" label="Custom" />)
    const input = screen.getByRole("textbox")
    expect(input).toHaveAttribute("id", "custom-id")
  })

  it("associates error with input via aria-describedby", () => {
    render(<Input error="Error message" />)
    const input = screen.getByRole("textbox")
    const errorId = input.getAttribute("aria-describedby")
    expect(errorId).toBeTruthy()
    expect(document.getElementById(errorId!)).toHaveTextContent("Error message")
  })

  it("associates helper text with input via aria-describedby", () => {
    render(<Input helperText="Helper text" />)
    const input = screen.getByRole("textbox")
    const helperId = input.getAttribute("aria-describedby")
    expect(helperId).toBeTruthy()
    expect(document.getElementById(helperId!)).toHaveTextContent("Helper text")
  })
})
