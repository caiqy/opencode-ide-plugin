import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { Modal, ModalHeader, ModalBody, ModalFooter } from "./Modal"

describe("Modal", () => {
  it("renders when isOpen is true", () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()}>
        <div>Modal content</div>
      </Modal>,
    )
    expect(screen.getByText("Modal content")).toBeInTheDocument()
  })

  it("does not render when isOpen is false", () => {
    render(
      <Modal isOpen={false} onClose={vi.fn()}>
        <div>Modal content</div>
      </Modal>,
    )
    expect(screen.queryByText("Modal content")).not.toBeInTheDocument()
  })

  it("renders with different sizes", () => {
    const { rerender, container } = render(
      <Modal isOpen={true} onClose={vi.fn()} size="sm">
        <div>Content</div>
      </Modal>,
    )
    expect(container.querySelector(".max-w-sm")).toBeInTheDocument()

    rerender(
      <Modal isOpen={true} onClose={vi.fn()} size="lg">
        <div>Content</div>
      </Modal>,
    )
    expect(container.querySelector(".max-w-lg")).toBeInTheDocument()
  })

  it("calls onClose when Escape is pressed", async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()
    render(
      <Modal isOpen={true} onClose={handleClose}>
        <div>Content</div>
      </Modal>,
    )
    await user.keyboard("{Escape}")
    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it("does not call onClose on Escape when closeOnEscape is false", async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()
    render(
      <Modal isOpen={true} onClose={handleClose} closeOnEscape={false}>
        <div>Content</div>
      </Modal>,
    )
    await user.keyboard("{Escape}")
    expect(handleClose).not.toHaveBeenCalled()
  })

  it("calls onClose when backdrop is clicked", async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()
    const { container } = render(
      <Modal isOpen={true} onClose={handleClose}>
        <div>Content</div>
      </Modal>,
    )
    const backdrop = container.querySelector(".fixed.inset-0")
    if (backdrop) {
      await user.click(backdrop)
      expect(handleClose).toHaveBeenCalledTimes(1)
    }
  })

  it("does not call onClose on backdrop click when closeOnBackdropClick is false", async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()
    const { container } = render(
      <Modal isOpen={true} onClose={handleClose} closeOnBackdropClick={false}>
        <div>Content</div>
      </Modal>,
    )
    const backdrop = container.querySelector(".fixed.inset-0")
    if (backdrop) {
      await user.click(backdrop)
      expect(handleClose).not.toHaveBeenCalled()
    }
  })

  it("does not call onClose when modal content is clicked", async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()
    render(
      <Modal isOpen={true} onClose={handleClose}>
        <div>Content</div>
      </Modal>,
    )
    await user.click(screen.getByText("Content"))
    expect(handleClose).not.toHaveBeenCalled()
  })
})

describe("ModalHeader", () => {
  it("renders children", () => {
    render(<ModalHeader>Header Title</ModalHeader>)
    expect(screen.getByText("Header Title")).toBeInTheDocument()
  })

  it("renders close button when onClose is provided", () => {
    render(<ModalHeader onClose={vi.fn()}>Header</ModalHeader>)
    const closeButton = screen.getByRole("button", { name: "关闭" })
    expect(closeButton).toBeInTheDocument()
  })

  it("does not render close button when onClose is not provided", () => {
    render(<ModalHeader>Header</ModalHeader>)
    expect(screen.queryByRole("button", { name: "关闭" })).not.toBeInTheDocument()
  })

  it("calls onClose when close button is clicked", async () => {
    const user = userEvent.setup()
    const handleClose = vi.fn()
    render(<ModalHeader onClose={handleClose}>Header</ModalHeader>)
    const closeButton = screen.getByRole("button", { name: "关闭" })
    await user.click(closeButton)
    expect(handleClose).toHaveBeenCalledTimes(1)
  })

  it("applies custom className", () => {
    const { container } = render(<ModalHeader className="custom-class">Header</ModalHeader>)
    expect(container.querySelector(".custom-class")).toBeInTheDocument()
  })
})

describe("ModalBody", () => {
  it("renders children", () => {
    render(<ModalBody>Body content</ModalBody>)
    expect(screen.getByText("Body content")).toBeInTheDocument()
  })

  it("applies custom className", () => {
    const { container } = render(<ModalBody className="custom-body">Body</ModalBody>)
    expect(container.querySelector(".custom-body")).toBeInTheDocument()
  })
})

describe("ModalFooter", () => {
  it("renders children", () => {
    render(<ModalFooter>Footer content</ModalFooter>)
    expect(screen.getByText("Footer content")).toBeInTheDocument()
  })

  it("applies custom className", () => {
    const { container } = render(<ModalFooter className="custom-footer">Footer</ModalFooter>)
    expect(container.querySelector(".custom-footer")).toBeInTheDocument()
  })
})

describe("Modal with subcomponents", () => {
  it("renders complete modal with all subcomponents", () => {
    const handleClose = vi.fn()
    render(
      <Modal isOpen={true} onClose={handleClose}>
        <ModalHeader onClose={handleClose}>Modal Title</ModalHeader>
        <ModalBody>Modal body content</ModalBody>
        <ModalFooter>
          <button>Cancel</button>
          <button>Submit</button>
        </ModalFooter>
      </Modal>,
    )

    expect(screen.getByText("Modal Title")).toBeInTheDocument()
    expect(screen.getByText("Modal body content")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /submit/i })).toBeInTheDocument()
  })
})
