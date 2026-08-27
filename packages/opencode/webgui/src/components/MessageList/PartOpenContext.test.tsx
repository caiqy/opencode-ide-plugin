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
      <div data-testid="b1">{open.isOpen("b1") ? "open" : "closed"}</div>
      <div data-testid="b2">{open.isOpen("b2") ? "open" : "closed"}</div>
      <div data-testid="b3">{open.isOpen("b3") ? "open" : "closed"}</div>
      <div data-testid="task1">{open.isOpen("task1") ? "open" : "closed"}</div>
      <div data-testid="task2">{open.isOpen("task2") ? "open" : "closed"}</div>
      <div data-testid="task3">{open.isOpen("task3") ? "open" : "closed"}</div>
      <div data-testid="websearch1">{open.isOpen("websearch1") ? "open" : "closed"}</div>
      <div data-testid="mcp1">{open.isOpen("mcp1") ? "open" : "closed"}</div>
      <div data-testid="plugin1">{open.isOpen("plugin1") ? "open" : "closed"}</div>
      <button onClick={() => open.setOpen("r1", false)}>close-r1</button>
      <button onClick={() => open.setOpen("r1", true)}>open-r1</button>
      <button onClick={() => open.setOpen("r2", false)}>close-r2</button>
      <button onClick={() => open.setOpen("r2", true)}>open-r2</button>
      <button onClick={() => open.setOpen("b1", true)}>open-b1</button>
      <button onClick={() => open.setOpen("task1", true)}>open-task1</button>
    </div>
  )
}

describe("PartOpenProvider", () => {
  it("默认只展开最后一条 thinking，工具跟随 defaultExpanded", async () => {
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
      expect(screen.getByTestId("r1")).toHaveTextContent("closed")
      expect(screen.getByTestId("r2")).toHaveTextContent("open")
      expect(screen.getByTestId("t1")).toHaveTextContent("open")
    })

    // thinking 结束（添加 end 时间戳）不影响展开状态
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
      expect(screen.getByTestId("r1")).toHaveTextContent("closed")
      expect(screen.getByTestId("r2")).toHaveTextContent("open")
      expect(screen.getByTestId("t1")).toHaveTextContent("open")
    })
  })

  it("新 thinking 出现时自动折叠上一条，用户手动展开的保持", async () => {
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
      expect(screen.getByTestId("r1")).toHaveTextContent("closed")
      expect(screen.getByTestId("r2")).toHaveTextContent("open")
      expect(screen.getByTestId("t1")).toHaveTextContent("open")
    })

    // 用户手动展开 r1
    await user.click(screen.getByRole("button", { name: "open-r1" }))
    expect(screen.getByTestId("r1")).toHaveTextContent("open")
    expect(screen.getByTestId("r2")).toHaveTextContent("open")

    // 新 thinking r3 出现 → r2 自动折叠，r1 保持用户手动展开
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
      expect(screen.getByTestId("r1")).toHaveTextContent("open")
      expect(screen.getByTestId("r2")).toHaveTextContent("closed")
      expect(screen.getByTestId("r3")).toHaveTextContent("open")
      expect(screen.getByTestId("t1")).toHaveTextContent("open")
    })
  })

  it("用户手动折叠最后一条 thinking 后保持折叠", async () => {
    const user = userEvent.setup()

    render(
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
      expect(screen.getByTestId("r2")).toHaveTextContent("open")
    })

    // 用户手动折叠 r2（最后一条）
    await user.click(screen.getByRole("button", { name: "close-r2" }))
    expect(screen.getByTestId("r2")).toHaveTextContent("closed")
  })

  it("当 defaultExpanded=false 时，最后一条 thinking 仍然展开，工具默认折叠", async () => {
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
      expect(screen.getByTestId("r2")).toHaveTextContent("open")
      expect(screen.getByTestId("t1")).toHaveTextContent("closed")
    })

    // 用户手动展开 r1，保持展开
    await user.click(screen.getByRole("button", { name: "open-r1" }))
    expect(screen.getByTestId("r1")).toHaveTextContent("open")

    // 新 thinking r3 出现
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
      expect(screen.getByTestId("r3")).toHaveTextContent("open")
      expect(screen.getByTestId("t1")).toHaveTextContent("closed")
    })
  })

  it("bash 工具默认收起且新增时不改变用户手动展开状态", async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <PartOpenProvider
        items={[
          { type: "tool", id: "b1", tool: "bash", status: "completed" },
          { type: "tool", id: "b2", tool: "bash", status: "running" },
          { type: "tool", id: "t1", tool: "read", status: "completed" },
        ]}
      >
        <View />
      </PartOpenProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("b1")).toHaveTextContent("closed")
      expect(screen.getByTestId("b2")).toHaveTextContent("closed")
      expect(screen.getByTestId("t1")).toHaveTextContent("open")
    })

    // 用户手动展开 b1
    await user.click(screen.getByRole("button", { name: "open-b1" }))
    expect(screen.getByTestId("b1")).toHaveTextContent("open")

    // 新 bash b3 出现不应改变既有展开状态
    rerender(
      <PartOpenProvider
        items={[
          { type: "tool", id: "b1", tool: "bash", status: "completed" },
          { type: "tool", id: "b2", tool: "bash", status: "completed" },
          { type: "tool", id: "b3", tool: "bash", status: "running" },
          { type: "tool", id: "t1", tool: "read", status: "completed" },
        ]}
      >
        <View />
      </PartOpenProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("b1")).toHaveTextContent("open")
      expect(screen.getByTestId("b2")).toHaveTextContent("closed")
      expect(screen.getByTestId("b3")).toHaveTextContent("closed")
      expect(screen.getByTestId("t1")).toHaveTextContent("open")
    })
  })

  it("task 工具只展开最后一个，新增时自动折叠上一个且保留用户手动展开项", async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <PartOpenProvider
        items={[
          { type: "tool", id: "task1", tool: "task", status: "completed" },
          { type: "tool", id: "task2", tool: "task", status: "running" },
          { type: "tool", id: "t1", tool: "read", status: "completed" },
        ]}
      >
        <View />
      </PartOpenProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("task1")).toHaveTextContent("closed")
      expect(screen.getByTestId("task2")).toHaveTextContent("open")
      expect(screen.getByTestId("t1")).toHaveTextContent("open")
    })

    await user.click(screen.getByRole("button", { name: "open-task1" }))
    expect(screen.getByTestId("task1")).toHaveTextContent("open")

    rerender(
      <PartOpenProvider
        items={[
          { type: "tool", id: "task1", tool: "task", status: "completed" },
          { type: "tool", id: "task2", tool: "task", status: "completed" },
          { type: "tool", id: "task3", tool: "task", status: "running" },
          { type: "tool", id: "t1", tool: "read", status: "completed" },
        ]}
      >
        <View />
      </PartOpenProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("task1")).toHaveTextContent("open")
      expect(screen.getByTestId("task2")).toHaveTextContent("closed")
      expect(screen.getByTestId("task3")).toHaveTextContent("open")
      expect(screen.getByTestId("t1")).toHaveTextContent("open")
    })
  })

  it("websearch 和 MCP 工具默认收起", async () => {
    render(
      <PartOpenProvider
        items={[
          { type: "tool", id: "websearch1", tool: "websearch", status: "completed" },
          {
            type: "tool",
            id: "mcp1",
            tool: "github_create_issue",
            metadata: { source: "mcp" },
            status: "completed",
          },
          {
            type: "tool",
            id: "plugin1",
            tool: "github_create_issue",
            metadata: { source: "plugin" },
            status: "completed",
          },
        ]}
      >
        <View />
      </PartOpenProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("websearch1")).toHaveTextContent("closed")
      expect(screen.getByTestId("mcp1")).toHaveTextContent("closed")
      expect(screen.getByTestId("plugin1")).toHaveTextContent("open")
    })
  })

  it("MCP source 变化时重新计算默认展开状态", async () => {
    const { rerender } = render(
      <PartOpenProvider items={[{ type: "tool", id: "mcp1", tool: "github_create_issue", status: "running" }]}>
        <View />
      </PartOpenProvider>,
    )

    expect(screen.getByTestId("mcp1")).toHaveTextContent("open")

    rerender(
      <PartOpenProvider
        items={[
          {
            type: "tool",
            id: "mcp1",
            tool: "github_create_issue",
            metadata: { source: "mcp" },
            status: "running",
          },
        ]}
      >
        <View />
      </PartOpenProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId("mcp1")).toHaveTextContent("closed")
    })
  })
})
