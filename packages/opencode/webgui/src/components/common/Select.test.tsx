import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Select } from "./Select"
import { createRef } from "react"

const TestIcon = () => <svg data-testid="test-icon" />

const mockOptions = [
  { value: "option1", label: "Option 1" },
  { value: "option2", label: "Option 2" },
  { value: "option3", label: "Option 3" },
]

describe("Select", () => {
  it("renders with options", () => {
    render(<Select options={mockOptions} />)
    const select = screen.getByRole("combobox")
    expect(select).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Option 1" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Option 2" })).toBeInTheDocument()
    expect(screen.getByRole("option", { name: "Option 3" })).toBeInTheDocument()
  })

  it("renders with label", () => {
    render(<Select label="Choose option" options={mockOptions} />)
    expect(screen.getByLabelText("Choose option")).toBeInTheDocument()
  })

  it("renders with placeholder", () => {
    render(<Select options={mockOptions} placeholder="Select an option" />)
    expect(screen.getByRole("option", { name: "Select an option" })).toBeInTheDocument()
  })

  it("renders with error message", () => {
    render(<Select options={mockOptions} error="This field is required" />)
    const select = screen.getByRole("combobox")
    expect(screen.getByText("This field is required")).toBeInTheDocument()
    expect(select).toHaveAttribute("aria-invalid", "true")
  })

  it("renders with helper text", () => {
    render(<Select options={mockOptions} helperText="Choose your preferred option" />)
    expect(screen.getByText("Choose your preferred option")).toBeInTheDocument()
  })

  it("does not show helper text when error is present", () => {
    render(<Select options={mockOptions} error="Error message" helperText="Helper text" />)
    expect(screen.getByText("Error message")).toBeInTheDocument()
    expect(screen.queryByText("Helper text")).not.toBeInTheDocument()
  })

  it("renders with different sizes", () => {
    const { rerender } = render(<Select options={mockOptions} selectSize="sm" />)
    let select = screen.getByRole("combobox")
    expect(select).toHaveClass("h-7", "px-2", "text-xs")

    rerender(<Select options={mockOptions} selectSize="lg" />)
    select = screen.getByRole("combobox")
    expect(select).toHaveClass("h-10", "px-4", "text-base")
  })

  it("renders with left icon", () => {
    render(<Select options={mockOptions} leftIcon={<TestIcon />} />)
    expect(screen.getByTestId("test-icon")).toBeInTheDocument()
    expect(screen.getByRole("combobox")).toHaveClass("pl-10")
  })

  it("handles option selection", async () => {
    const user = userEvent.setup()
    render(<Select options={mockOptions} />)
    const select = screen.getByRole("combobox")
    await user.selectOptions(select, "option2")
    expect(select).toHaveValue("option2")
  })

  it("calls onChange handler", async () => {
    const user = userEvent.setup()
    const handleChange = vi.fn()
    render(<Select options={mockOptions} onChange={handleChange} />)
    const select = screen.getByRole("combobox")
    await user.selectOptions(select, "option1")
    expect(handleChange).toHaveBeenCalled()
  })

  it("can be disabled", () => {
    render(<Select options={mockOptions} disabled />)
    const select = screen.getByRole("combobox")
    expect(select).toBeDisabled()
    expect(select).toHaveClass("cursor-not-allowed", "opacity-60")
  })

  it("renders disabled options", () => {
    const optionsWithDisabled = [
      { value: "option1", label: "Option 1" },
      { value: "option2", label: "Option 2", disabled: true },
    ]
    render(<Select options={optionsWithDisabled} />)
    const option2 = screen.getByRole("option", { name: "Option 2" })
    expect(option2).toHaveAttribute("disabled")
  })

  it("forwards ref correctly", () => {
    const ref = createRef<HTMLSelectElement>()
    render(<Select options={mockOptions} ref={ref} />)
    expect(ref.current).toBeInstanceOf(HTMLSelectElement)
  })

  it("applies custom className", () => {
    render(<Select options={mockOptions} className="custom-class" />)
    const select = screen.getByRole("combobox")
    expect(select).toHaveClass("custom-class")
  })

  it("passes through HTML select attributes", () => {
    render(<Select options={mockOptions} data-testid="select-input" name="test-select" />)
    const select = screen.getByTestId("select-input")
    expect(select).toHaveAttribute("name", "test-select")
  })

  it("generates unique id when not provided", () => {
    const { container } = render(<Select label="Field 1" options={mockOptions} />)
    const select1 = container.querySelector("select")
    const id1 = select1?.id

    const { container: container2 } = render(<Select label="Field 2" options={mockOptions} />)
    const select2 = container2.querySelector("select")
    const id2 = select2?.id

    expect(id1).toBeDefined()
    expect(id2).toBeDefined()
    expect(id1).not.toBe(id2)
  })

  it("uses provided id", () => {
    render(<Select options={mockOptions} id="custom-id" />)
    const select = screen.getByRole("combobox")
    expect(select).toHaveAttribute("id", "custom-id")
  })

  it("associates error with select via aria-describedby", () => {
    render(<Select options={mockOptions} error="Error message" />)
    const select = screen.getByRole("combobox")
    const errorId = select.getAttribute("aria-describedby")
    expect(errorId).toBeTruthy()
    expect(document.getElementById(errorId!)).toHaveTextContent("Error message")
  })

  it("renders dropdown arrow icon", () => {
    const { container } = render(<Select options={mockOptions} />)
    const arrow = container.querySelector("svg")
    expect(arrow).toBeInTheDocument()
  })
})
