import { describe, it, expect } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { PartOpenProvider, usePartOpen } from "./PartOpenContext"

function View() {
  const open = usePartOpen()
  return (
    <div>
      <div data-testid="open">{open.open ? `${open.open.type}:${open.open.id}` : "none"}</div>
      <button onClick={() => open.openManual({ type: "tool", id: "t1" })}>open-tool</button>
      <button onClick={() => open.openManual(null)}>close</button>
    </div>
  )
}

describe("PartOpenProvider", () => {
  it("自动展开最新的 thinking，并在结束瞬间自动关闭一次", async () => {
    const { rerender } = render(
      <PartOpenProvider
        items={[
          { type: "reasoning", id: "r1", text: "x" },
          { type: "tool", id: "x1", tool: "read", status: "completed" },
        ]}
      >
        <View />
      </PartOpenProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("open")).toHaveTextContent("reasoning:r1")
    })

    rerender(
      <PartOpenProvider
        items={[
          { type: "reasoning", id: "r1", text: "x", end: 123 },
          { type: "tool", id: "x1", tool: "read", status: "completed" },
        ]}
      >
        <View />
      </PartOpenProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("open")).toHaveTextContent("none")
    })
  })

  it("用户手动展开后不会被新的 thinking 强制跳转", async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <PartOpenProvider items={[{ type: "reasoning", id: "r1", text: "x" }]}>
        <View />
      </PartOpenProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("open")).toHaveTextContent("reasoning:r1")
    })

    await user.click(screen.getByRole("button", { name: "open-tool" }))
    expect(screen.getByTestId("open")).toHaveTextContent("tool:t1")

    rerender(
      <PartOpenProvider items={[{ type: "reasoning", id: "r2", text: "x" }]}>
        <View />
      </PartOpenProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("open")).toHaveTextContent("tool:t1")
    })
  })

  it("仅自动展开 bash（pending/running），并且不会在完成后自动关闭", async () => {
    const { rerender } = render(
      <PartOpenProvider items={[{ type: "tool", id: "b1", tool: "bash", status: "running" }]}>
        <View />
      </PartOpenProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("open")).toHaveTextContent("tool:b1")
    })

    rerender(
      <PartOpenProvider items={[{ type: "tool", id: "b1", tool: "bash", status: "completed" }]}>
        <View />
      </PartOpenProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("open")).toHaveTextContent("tool:b1")
    })
  })
})
