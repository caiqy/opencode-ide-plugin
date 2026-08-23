import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  return {
    closeSubtaskDrawer: vi.fn(),
    ensureSession: vi.fn<(sessionId: string) => Promise<void>>(),
    getMessagesBySession: vi.fn<(sessionId: string) => Array<any>>(),
    isSessionLoadError: vi.fn<(sessionId: string) => boolean>(),
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
      ensureSession: mocks.ensureSession,
      getMessagesBySession: mocks.getMessagesBySession,
      isSessionLoadError: mocks.isSessionLoadError,
    }),
  }
})

vi.mock("./SubtaskMessageList", () => {
  return {
    SubtaskMessageList: () => <div data-testid="subtask-message-list" />,
  }
})

import { SubtaskDrawer } from "./SubtaskDrawer"

describe("SubtaskDrawer", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.state.isOpen = true
    mocks.state.sessionId = "s-child"
    mocks.state.title = "demo"
    mocks.ensureSession.mockResolvedValue(undefined)
    mocks.isSessionLoadError.mockReturnValue(false)
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

    expect(screen.getByText("委派子任务：demo [ 已加载 2 个工具调用 / 执行命令 ]")).toBeInTheDocument()

    await waitFor(() => {
      expect(mocks.ensureSession).toHaveBeenCalledWith("s-child")
    })
  })

  it("首次打开且子会话仍在加载时显示加载态，避免先闪空内容", async () => {
    let done = () => {}
    mocks.getMessagesBySession.mockReturnValue([])
    mocks.ensureSession.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          done = resolve
        }),
    )

    render(<SubtaskDrawer />)

    expect(screen.getByTestId("subtask-drawer-loading")).toBeInTheDocument()
    expect(screen.queryByTestId("subtask-message-list")).not.toBeInTheDocument()

    done()

    await waitFor(() => {
      expect(screen.queryByTestId("subtask-drawer-loading")).not.toBeInTheDocument()
    })
  })

  it("冷启动加载时头部先显示加载文案，不先闪 0 个工具调用", () => {
    mocks.getMessagesBySession.mockReturnValue([])
    mocks.ensureSession.mockImplementation(() => new Promise<void>(() => {}))

    render(<SubtaskDrawer />)

    expect(screen.getByText("委派子任务：demo [ 正在加载子任务… ]")).toBeInTheDocument()
    expect(screen.queryByText("委派子任务：demo [ 已加载 0 个工具调用 / 思考中 ]")).not.toBeInTheDocument()
  })

  it("冷启动加载失败时显示失败态与重试入口，不伪装成成功加载", async () => {
    mocks.getMessagesBySession.mockReturnValue([])
    mocks.ensureSession.mockRejectedValue(new Error("boom"))
    mocks.isSessionLoadError.mockReturnValue(true)

    render(<SubtaskDrawer />)

    await waitFor(() => {
      expect(screen.getByText("子任务加载失败")).toBeInTheDocument()
    })
    expect(screen.queryByTestId("subtask-message-list")).not.toBeInTheDocument()
    expect(screen.queryByTestId("subtask-drawer-loading")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "重试加载" })).toBeInTheDocument()
  })

  it("拖拽过程中关闭抽屉也会恢复 body userSelect", () => {
    const view = render(<SubtaskDrawer />)
    const handle = screen.getByTestId("subtask-drawer-resize-handle")

    fireEvent.pointerDown(handle, { button: 0, clientX: 900 })
    expect(document.body.style.userSelect).toBe("none")

    mocks.state.isOpen = false
    view.rerender(<SubtaskDrawer />)

    expect(document.body.style.userSelect).toBe("")
  })

  it("没有进行中的工具调用且父 task 未完成时，显示当前为思考中", () => {
    mocks.getMessagesBySession.mockReturnValue([
      {
        info: { id: "m1", sessionID: "s-child", role: "assistant", time: { created: 1 } },
        parts: [{ id: "t1", type: "tool", tool: "read", state: { status: "completed" } }],
      },
    ])

    render(<SubtaskDrawer />)

    expect(screen.getByText("委派子任务：demo [ 已加载 1 个工具调用 / 思考中 ]")).toBeInTheDocument()
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

    expect(screen.getByText("委派子任务：demo [ 已加载 1 个工具调用 / 已完成 ]")).toBeInTheDocument()
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

  it("默认宽度应限制为主体内容最大宽度", () => {
    const original = window.innerWidth
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1200 })

    render(<SubtaskDrawer />)
    const dialog = screen.getByRole("dialog", { name: "子任务" })
    expect(dialog).toHaveStyle({ width: "860px" })

    Object.defineProperty(window, "innerWidth", { configurable: true, value: original })
  })

  it("达到最大宽度后左边缘向左拖拽不会继续变宽", () => {
    render(<SubtaskDrawer />)
    const handle = screen.getByTestId("subtask-drawer-resize-handle")
    const dialog = screen.getByRole("dialog", { name: "子任务" }) as HTMLElement
    const initial = parseFloat(dialog.style.width)

    fireEvent.pointerDown(handle, { button: 0, clientX: 900 })
    fireEvent.pointerMove(document, { clientX: 820 })
    fireEvent.pointerUp(document)

    expect(parseFloat(dialog.style.width)).toBe(initial)
  })

  it("左边缘向右拖拽后应变窄", () => {
    render(<SubtaskDrawer />)
    const handle = screen.getByTestId("subtask-drawer-resize-handle")
    const dialog = screen.getByRole("dialog", { name: "子任务" }) as HTMLElement
    const initial = parseFloat(dialog.style.width)

    fireEvent.pointerDown(handle, { button: 0, clientX: 900 })
    fireEvent.pointerMove(document, { clientX: 980 })
    fireEvent.pointerUp(document)

    expect(parseFloat(dialog.style.width)).toBeLessThan(initial)
  })

  it("宽度不应小于 360px", () => {
    render(<SubtaskDrawer />)
    const handle = screen.getByTestId("subtask-drawer-resize-handle")
    const dialog = screen.getByRole("dialog", { name: "子任务" })

    fireEvent.pointerDown(handle, { button: 0, clientX: 900 })
    fireEvent.pointerMove(document, { clientX: 5000 })
    fireEvent.pointerUp(document)

    expect(parseFloat((dialog as HTMLElement).style.width)).toBe(360)
  })

  it("宽度不应超过主体内容最大宽度", () => {
    const original = window.innerWidth
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 })

    render(<SubtaskDrawer />)
    const handle = screen.getByTestId("subtask-drawer-resize-handle")
    const dialog = screen.getByRole("dialog", { name: "子任务" })

    fireEvent.pointerDown(handle, { button: 0, clientX: 900 })
    fireEvent.pointerMove(document, { clientX: -2000 })
    fireEvent.pointerUp(document)

    expect(parseFloat((dialog as HTMLElement).style.width)).toBe(860)

    Object.defineProperty(window, "innerWidth", { configurable: true, value: original })
  })

  it("pointerup 后不应继续更新宽度", () => {
    render(<SubtaskDrawer />)
    const handle = screen.getByTestId("subtask-drawer-resize-handle")
    const dialog = screen.getByRole("dialog", { name: "子任务" })

    fireEvent.pointerDown(handle, { button: 0, clientX: 900 })
    fireEvent.pointerMove(document, { clientX: 850 })
    fireEvent.pointerUp(document)
    const locked = parseFloat((dialog as HTMLElement).style.width)

    fireEvent.pointerMove(document, { clientX: 750 })
    expect(parseFloat((dialog as HTMLElement).style.width)).toBe(locked)
  })
})
