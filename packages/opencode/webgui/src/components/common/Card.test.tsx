import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Card, CardHeader, CardBody, CardFooter } from "./Card"

describe("Card", () => {
  it("renders children", () => {
    render(<Card>Card content</Card>)
    expect(screen.getByText("Card content")).toBeInTheDocument()
  })

  it("renders with default padding", () => {
    const { container } = render(<Card>Content</Card>)
    const card = container.querySelector(".modern-card")
    expect(card).toHaveClass("p-4")
  })

  it("renders with no padding", () => {
    const { container } = render(<Card padding="none">Content</Card>)
    const card = container.querySelector(".modern-card")
    expect(card).not.toHaveClass("p-4")
  })

  it("renders with large padding", () => {
    const { container } = render(<Card padding="lg">Content</Card>)
    const card = container.querySelector(".modern-card")
    expect(card).toHaveClass("p-6")
  })

  it("applies hoverable styles", () => {
    const { container } = render(<Card hoverable>Content</Card>)
    const card = container.querySelector(".modern-card")
    expect(card).toHaveClass("hover:shadow-md", "cursor-pointer", "transition-shadow")
  })

  it("applies custom className", () => {
    const { container } = render(<Card className="custom-class">Content</Card>)
    const card = container.querySelector(".custom-class")
    expect(card).toBeInTheDocument()
  })

  it("handles click events when onClick is provided", async () => {
    const user = userEvent.setup()
    const handleClick = vi.fn()
    const { container } = render(<Card onClick={handleClick}>Clickable card</Card>)
    const card = container.querySelector(".modern-card")
    if (card) {
      await user.click(card)
      expect(handleClick).toHaveBeenCalledTimes(1)
    }
  })
})

describe("CardHeader", () => {
  it("renders children", () => {
    render(<CardHeader>Header content</CardHeader>)
    expect(screen.getByText("Header content")).toBeInTheDocument()
  })

  it("applies custom className", () => {
    const { container } = render(<CardHeader className="custom-header">Header</CardHeader>)
    expect(container.querySelector(".custom-header")).toBeInTheDocument()
  })
})

describe("CardBody", () => {
  it("renders children", () => {
    render(<CardBody>Body content</CardBody>)
    expect(screen.getByText("Body content")).toBeInTheDocument()
  })

  it("applies custom className", () => {
    const { container } = render(<CardBody className="custom-body">Body</CardBody>)
    expect(container.querySelector(".custom-body")).toBeInTheDocument()
  })
})

describe("CardFooter", () => {
  it("renders children", () => {
    render(<CardFooter>Footer content</CardFooter>)
    expect(screen.getByText("Footer content")).toBeInTheDocument()
  })

  it("applies custom className", () => {
    const { container } = render(<CardFooter className="custom-footer">Footer</CardFooter>)
    expect(container.querySelector(".custom-footer")).toBeInTheDocument()
  })
})

describe("Card with subcomponents", () => {
  it("renders complete card structure", () => {
    render(
      <Card>
        <CardHeader>Card Title</CardHeader>
        <CardBody>Card body content</CardBody>
        <CardFooter>Card footer actions</CardFooter>
      </Card>,
    )

    expect(screen.getByText("Card Title")).toBeInTheDocument()
    expect(screen.getByText("Card body content")).toBeInTheDocument()
    expect(screen.getByText("Card footer actions")).toBeInTheDocument()
  })
})
