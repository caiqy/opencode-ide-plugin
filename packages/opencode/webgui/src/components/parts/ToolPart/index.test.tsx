import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { fireEvent } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  isOpen: vi.fn(),
  toggle: vi.fn(),
  setOpen: vi.fn(),
  getPermissionForCall: vi.fn(),
  getMessagesBySession: vi.fn(),
  respondPermission: vi.fn(),
  openSubtaskDrawer: vi.fn(),
}))

vi.mock("../../../state/MessagesContext", () => ({
  useMessages: () => ({
    getPermissionForCall: mocks.getPermissionForCall,
    getMessagesBySession: mocks.getMessagesBySession,
    respondPermission: mocks.respondPermission,
  }),
}))

vi.mock("../../MessageList/PartOpenContext", () => ({
  usePartOpen: () => ({
    isOpen: mocks.isOpen,
    toggle: mocks.toggle,
    setOpen: mocks.setOpen,
  }),
}))

vi.mock("../../../state/SubtaskDrawerContext", () => ({
  useSubtaskDrawer: () => ({
    openSubtaskDrawer: mocks.openSubtaskDrawer,
  }),
}))

vi.mock("../../../hooks/useOpenFile", () => ({
  useOpenFile: () => vi.fn(),
}))

vi.mock("../../../state/ProjectContext", () => ({
  useProject: () => ({ worktree: null }),
}))

import { ToolPart } from "./index"

describe("ToolPart", () => {
  beforeEach(() => {
    mocks.isOpen.mockReturnValue(true)
    mocks.getPermissionForCall.mockReturnValue(undefined)
    mocks.getMessagesBySession.mockReturnValue([])
    mocks.respondPermission.mockResolvedValue(true)
    mocks.openSubtaskDrawer.mockReset()
  })

  it("apply_patch 使用 patchText 字段时，展开应显示补丁内容", () => {
    const part = {
      id: "p1",
      type: "tool",
      callID: "c1",
      tool: "apply_patch",
      state: {
        status: "completed",
        title: "Success. Updated the following files: M hello.txt",
        output: "Success. Updated the following files: M hello.txt",
        input: {
          patchText: "*** Begin Patch\n*** Add File: hello.txt\n+hello\n*** End Patch",
        },
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.getByText("+*** Begin Patch")).toBeInTheDocument()
    expect(screen.getByText("+*** Add File: hello.txt")).toBeInTheDocument()
    expect(screen.getByText("++hello")).toBeInTheDocument()
  })

  it("工具展开区域默认开启长路径自动折行", () => {
    const part = {
      id: "p2",
      type: "tool",
      callID: "c2",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "pwd" },
        output: "C:\\Users\\alice\\very\\long\\project\\src\\feature\\index.ts",
      },
    } as any

    const { container } = render(<ToolPart part={part} sessionID="s1" messageID="m1" />)
    const expanded = container.querySelector(".border-t")

    expect(expanded).toBeTruthy()
    expect(expanded).toHaveClass("break-words")
    expect(expanded).toHaveClass("[overflow-wrap:anywhere]")
  })

  it("task 工具在头部提供查看子任务入口", () => {
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

    const part = {
      id: "p3",
      type: "tool",
      callID: "c3",
      tool: "task",
      state: {
        status: "running",
        title: "Demo Task",
        input: { description: "Demo Task", subagent_type: "general", prompt: "do" },
        metadata: { sessionId: "s-child" },
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.getByText("委派子任务：Demo Task [ 2 工具调用 / 执行命令 ]")).toBeInTheDocument()

    const btn = screen.getByLabelText("查看子任务")
    fireEvent.click(btn)

    expect(mocks.openSubtaskDrawer).toHaveBeenCalledWith({
      sessionId: "s-child",
      title: "Demo Task",
      parent: { sessionId: "s1", messageId: "m1", partId: "p3" },
    })
  })

  it("子任务完成后头部显示已完成", () => {
    mocks.getMessagesBySession.mockReturnValue([
      {
        info: { id: "m1", sessionID: "s-child", role: "assistant", time: { created: 1 } },
        parts: [{ id: "t1", type: "tool", tool: "read", state: { status: "completed" } }],
      },
      {
        info: { id: "m2", sessionID: "s-child", role: "assistant", time: { created: 2 } },
        parts: [{ id: "t2", type: "tool", tool: "bash", state: { status: "completed" } }],
      },
    ])

    const part = {
      id: "p4",
      type: "tool",
      callID: "c4",
      tool: "task",
      state: {
        status: "completed",
        title: "Demo Task",
        input: { description: "Demo Task", subagent_type: "general", prompt: "done" },
        metadata: { sessionId: "s-child" },
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.getByText("委派子任务：Demo Task [ 2 工具调用 / 已完成 ]")).toBeInTheDocument()
  })

  it("read 文件输出包含 type 文本片段时仍显示行号范围", () => {
    const part = {
      id: "p5",
      type: "tool",
      callID: "c5",
      tool: "read",
      state: {
        status: "completed",
        input: { filePath: "/tmp/a.ts" },
        output:
          '<path>/tmp/a.ts</path>\n<type>file</type>\n<content>\n1: const x = "<type>directory</type>"\n2: export {}\n\n(End of file - total 2 lines)\n</content>',
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.getByText("查看：")).toBeInTheDocument()
    expect(screen.getByText("a.ts")).toBeInTheDocument()
    expect(screen.getByText("(1-2 行)")).toBeInTheDocument()
  })
})
