import { describe, it, expect } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PartOpenProvider, usePartOpen } from "./PartOpenContext"

function View() {
  const open = usePartOpen()

  return (
    <div>
      <div data-testid="r1">{open.isOpen("r1") ? "open" : "closed"}</div>
      <div data-testid="r2">{open.isOpen("r2") ? "open" : "closed"}</div>
      <div data-testid="r3">{open.isOpen("r3") ? "open" : "closed"}</div>
      <div data-testid="t1">{open.isOpen("t1") ? "open" : "closed"}</div>
      <button onClick={() => open.setOpen("r1", false)}>close-r1</button>
      <button onClick={() => open.setOpen("r1", true)}>open-r1</button>
    </div>
  )
}

describe("PartOpenProvider", () => {
  it("默认展开所有 thinking 和工具，并且不因 thinking 结束而自动折叠", async () => {
    const { rerender } = render(
      <PartOpenProvider
        items={[
          { type: "reasoning", id: "r1", text: "x" },
          { type: "reasoning", id: "r2", text: "y" },
          { type: "tool", id: "t1", tool: "read", status: "completed" },
        ]}
      >
        <View />
      </PartOpenProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("r1")).toHaveTextContent("open")
      expect(screen.getByTestId("r2")).toHaveTextContent("open")
      expect(screen.getByTestId("t1")).toHaveTextContent("open")
    })

    rerender(
      <PartOpenProvider
        items={[
          { type: "reasoning", id: "r1", text: "x", end: 123 },
          { type: "reasoning", id: "r2", text: "y", end: 456 },
          { type: "tool", id: "t1", tool: "read", status: "completed" },
        ]}
      >
        <View />
      </PartOpenProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("r1")).toHaveTextContent("open")
      expect(screen.getByTestId("r2")).toHaveTextContent("open")
      expect(screen.getByTestId("t1")).toHaveTextContent("open")
    })
  })

  it("用户手动折叠后保持折叠，新出现的项默认展开", async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <PartOpenProvider
        items={[
          { type: "reasoning", id: "r1", text: "x" },
          { type: "reasoning", id: "r2", text: "y" },
          { type: "tool", id: "t1", tool: "read", status: "completed" },
        ]}
      >
        <View />
      </PartOpenProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("r1")).toHaveTextContent("open")
      expect(screen.getByTestId("r2")).toHaveTextContent("open")
      expect(screen.getByTestId("t1")).toHaveTextContent("open")
    })

    await user.click(screen.getByRole("button", { name: "close-r1" }))
    expect(screen.getByTestId("r1")).toHaveTextContent("closed")
    expect(screen.getByTestId("r2")).toHaveTextContent("open")
    expect(screen.getByTestId("t1")).toHaveTextContent("open")

    rerender(
      <PartOpenProvider
        items={[
          { type: "reasoning", id: "r1", text: "x" },
          { type: "reasoning", id: "r2", text: "y" },
          { type: "reasoning", id: "r3", text: "z" },
          { type: "tool", id: "t1", tool: "read", status: "completed" },
        ]}
      >
        <View />
      </PartOpenProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("r1")).toHaveTextContent("closed")
      expect(screen.getByTestId("r2")).toHaveTextContent("open")
      expect(screen.getByTestId("r3")).toHaveTextContent("open")
      expect(screen.getByTestId("t1")).toHaveTextContent("open")
    })
  })

  it("当 defaultExpanded=false 时默认折叠，手动展开后保持展开", async () => {
    const user = userEvent.setup()

    const { rerender } = render(
      <PartOpenProvider
        defaultExpanded={false}
        items={[
          { type: "reasoning", id: "r1", text: "x" },
          { type: "reasoning", id: "r2", text: "y" },
          { type: "tool", id: "t1", tool: "read", status: "completed" },
        ]}
      >
        <View />
      </PartOpenProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("r1")).toHaveTextContent("closed")
      expect(screen.getByTestId("r2")).toHaveTextContent("closed")
      expect(screen.getByTestId("t1")).toHaveTextContent("closed")
    })

    await user.click(screen.getByRole("button", { name: "open-r1" }))
    expect(screen.getByTestId("r1")).toHaveTextContent("open")

    rerender(
      <PartOpenProvider
        defaultExpanded={false}
        items={[
          { type: "reasoning", id: "r1", text: "x" },
          { type: "reasoning", id: "r2", text: "y" },
          { type: "reasoning", id: "r3", text: "z" },
          { type: "tool", id: "t1", tool: "read", status: "completed" },
        ]}
      >
        <View />
      </PartOpenProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("r1")).toHaveTextContent("open")
      expect(screen.getByTestId("r2")).toHaveTextContent("closed")
      expect(screen.getByTestId("r3")).toHaveTextContent("closed")
      expect(screen.getByTestId("t1")).toHaveTextContent("closed")
    })
  })
})
