import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  return {
    closeSubtaskDrawer: vi.fn(),
    loadSessionMessages: vi.fn<
      (sessionId: string) => Promise<void>
    >(),
    getMessagesBySession: vi.fn<(sessionId: string) => Array<any>>(),
    state: {
      isOpen: true,
      sessionId: "s-child",
      title: "demo",
      parent: null as any,
    },
  }
})

vi.mock("../../state/SubtaskDrawerContext", () => {
  return {
    useSubtaskDrawer: () => ({
      isOpen: mocks.state.isOpen,
      sessionId: mocks.state.sessionId,
      title: mocks.state.title,
      parent: mocks.state.parent,
      openSubtaskDrawer: vi.fn(),
      closeSubtaskDrawer: mocks.closeSubtaskDrawer,
    }),
  }
})

vi.mock("../../state/MessagesContext", () => {
  return {
    useMessages: () => ({
      loadSessionMessages: mocks.loadSessionMessages,
      getMessagesBySession: mocks.getMessagesBySession,
    }),
  }
})

vi.mock("./SubtaskMessageList", () => {
  return {
    SubtaskMessageList: () => null,
  }
})

import { SubtaskDrawer } from "./SubtaskDrawer"

describe("SubtaskDrawer", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.state.isOpen = true
    mocks.state.sessionId = "s-child"
    mocks.state.title = "demo"
    mocks.loadSessionMessages.mockResolvedValue(undefined)
    mocks.getMessagesBySession.mockReturnValue([
      {
        info: { id: "m1", sessionID: "s-child", role: "assistant", time: { created: 1 } },
        parts: [{ id: "t1", type: "tool", tool: "read", state: { status: "completed" } }],
      },
      {
        info: { id: "m2", sessionID: "s-child", role: "assistant", time: { created: 2 } },
        parts: [{ id: "t2", type: "tool", tool: "bash", state: { status: "running" } }],
      },
    ])
  })

  it("打开时应渲染标题，并触发加载子会话消息", async () => {
    render(<SubtaskDrawer />)

    expect(screen.getByText("委派子任务：demo [ 2 工具调用 / 执行命令 ]")).toBeInTheDocument()

    await waitFor(() => {
      expect(mocks.loadSessionMessages).toHaveBeenCalledWith("s-child")
    })
  })

  it("没有进行中的工具调用时，显示当前为空闲", () => {
    mocks.getMessagesBySession.mockReturnValue([
      {
        info: { id: "m1", sessionID: "s-child", role: "assistant", time: { created: 1 } },
        parts: [{ id: "t1", type: "tool", tool: "read", state: { status: "completed" } }],
      },
    ])

    render(<SubtaskDrawer />)

    expect(screen.getByText("委派子任务：demo [ 1 工具调用 / 空闲 ]")).toBeInTheDocument()
  })

  it("子任务完成后应显示已完成", () => {
    mocks.state.parent = { sessionId: "s-parent", messageId: "m-parent", partId: "p-task" } as any

    mocks.getMessagesBySession.mockImplementation((sessionId: string) => {
      if (sessionId === "s-parent") {
        return [
          {
            info: { id: "m-parent", sessionID: "s-parent", role: "assistant", time: { created: 1 } },
            parts: [{ id: "p-task", type: "tool", tool: "task", state: { status: "completed" } }],
          },
        ]
      }
      return [
        {
          info: { id: "m1", sessionID: "s-child", role: "assistant", time: { created: 1 } },
          parts: [{ id: "t1", type: "tool", tool: "read", state: { status: "completed" } }],
        },
      ]
    })

    render(<SubtaskDrawer />)

    expect(screen.getByText("委派子任务：demo [ 1 工具调用 / 已完成 ]")).toBeInTheDocument()
  })

  it("仅显示传入的 title；当 title 为空时不渲染默认标题文案", () => {
    mocks.state.title = null as any

    render(<SubtaskDrawer />)

    expect(screen.queryByText("子任务")).not.toBeInTheDocument()
  })

  it("点击 backdrop 应关闭抽屉", () => {
    render(<SubtaskDrawer />)
    fireEvent.click(screen.getByTestId("subtask-drawer-backdrop"))
    expect(mocks.closeSubtaskDrawer).toHaveBeenCalledTimes(1)
  })

  it("按 Escape 应关闭抽屉", () => {
    render(<SubtaskDrawer />)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(mocks.closeSubtaskDrawer).toHaveBeenCalledTimes(1)
  })

  it("关闭时不应渲染", () => {
    mocks.state.isOpen = false
    render(<SubtaskDrawer />)
    expect(screen.queryByTestId("subtask-drawer-backdrop")).not.toBeInTheDocument()
  })
})
