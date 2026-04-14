import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { fireEvent } from "@testing-library/react"
import { waitFor } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  isOpen: vi.fn(),
  toggle: vi.fn(),
  setOpen: vi.fn(),
  getPermissionForCall: vi.fn(),
  getMessagesBySession: vi.fn(),
  respondPermission: vi.fn(),
  openSubtaskDrawer: vi.fn(),
  permissions: [] as Array<{ id: string; sessionID: string; tool?: { messageID: string; callID: string } }>,
  getQuestionsBySession: vi.fn<(sessionID: string) => Array<any>>(),
}))

vi.mock("../../../state/MessagesContext", () => ({
  useMessages: () => ({
    getPermissionForCall: mocks.getPermissionForCall,
    getMessagesBySession: mocks.getMessagesBySession,
    respondPermission: mocks.respondPermission,
    permissions: mocks.permissions,
    getQuestionsBySession: mocks.getQuestionsBySession,
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
    mocks.permissions = []
    mocks.getQuestionsBySession.mockReturnValue([])
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

  it("工具卡片使用圆角边框，并移除根节点外边距由父层统一控间距", () => {
    const part = {
      id: "p-spacing",
      type: "tool",
      callID: "c-spacing",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "pwd" },
        output: "ok",
      },
    } as any

    const { container } = render(<ToolPart part={part} sessionID="s1" messageID="m1" />)
    const root = container.firstElementChild

    expect(root).toHaveClass("rounded-lg")
    expect(root).not.toHaveClass("my-1")
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

    expect(screen.getByText("委派子任务 (general)：Demo Task [ 2 工具调用 / 执行命令 ]")).toBeInTheDocument()

    const btn = screen.getByLabelText("查看子任务")
    fireEvent.click(btn)

    expect(mocks.openSubtaskDrawer).toHaveBeenCalledWith({
      sessionId: "s-child",
      title: "Demo Task",
      subagentType: "general",
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

    expect(screen.getByText("委派子任务 (general)：Demo Task [ 2 工具调用 / 已完成 ]")).toBeInTheDocument()
  })

  it("task 工具仅渲染 task_result 标签内 Markdown", () => {
    const part = {
      id: "p10",
      type: "tool",
      callID: "c10",
      tool: "task",
      state: {
        status: "completed",
        output: "task_id: s1\n<task_result># 标题\n- a</task_result>",
      },
      parsed: {
        task_result: {
          hasTag: true,
          hasContent: true,
          text: "# 标题\n- a",
        },
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.getByText("标题")).toBeInTheDocument()
    expect(screen.getByText("a")).toBeInTheDocument()
    expect(screen.queryByText(/task_id:/)).not.toBeInTheDocument()
  })

  it("task 在 parsed 缺失时使用 output 兜底解析", () => {
    const part = {
      id: "p13",
      type: "tool",
      callID: "c13",
      tool: "task",
      state: {
        status: "completed",
        output: "task_id: x\n<task_result>fallback</task_result>",
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.getByText("fallback")).toBeInTheDocument()
    expect(screen.queryByText(/task_id:/)).not.toBeInTheDocument()
    expect(screen.queryByText("无可展示内容")).not.toBeInTheDocument()
  })

  it("task_result 缺失或空内容时显示空状态", () => {
    const part = {
      id: "p11",
      type: "tool",
      callID: "c11",
      tool: "task",
      state: {
        status: "completed",
        output: "task_id: s1",
      },
      parsed: {
        task_result: {
          hasTag: false,
          hasContent: false,
          text: "",
        },
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.getByText("无可展示内容")).toBeInTheDocument()
    expect(screen.queryByText(/task_id:/)).not.toBeInTheDocument()
  })

  it("task 处于 running/pending 时不展示空状态", () => {
    const part = {
      id: "p12",
      type: "tool",
      callID: "c12",
      tool: "task",
      state: {
        status: "running",
      },
      parsed: {
        task_result: {
          hasTag: false,
          hasContent: false,
          text: "",
        },
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.queryByText("无可展示内容")).not.toBeInTheDocument()
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

  it("header-only 工具在有权限请求时也显示授权栏", () => {
    mocks.getPermissionForCall.mockReturnValue({
      id: "perm-header",
      permission: "glob",
      metadata: {},
    })

    const part = {
      id: "p6",
      type: "tool",
      callID: "c6",
      tool: "glob",
      state: {
        status: "running",
        input: { pattern: "**/*.ts" },
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.getByText("执行该工具需要授权")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "本次允许" })).toBeInTheDocument()
  })

  it("权限操作按钮触发 respondPermission", async () => {
    const makePart = (id: string, callID: string) =>
      ({
        id,
        type: "tool",
        callID,
        tool: "glob",
        state: {
          status: "running",
          input: { pattern: "**/*anthropic*.ts" },
        },
      }) as any

    mocks.getPermissionForCall.mockReturnValue({ id: "perm-once", permission: "glob", metadata: {} })
    const view = render(<ToolPart part={makePart("p7", "c7")} sessionID="s1" messageID="m1" />)

    fireEvent.click(screen.getByRole("button", { name: "本次允许" }))
    await waitFor(() => expect(mocks.respondPermission).toHaveBeenCalledWith("perm-once", "once"))

    mocks.getPermissionForCall.mockReturnValue({ id: "perm-always", permission: "glob", metadata: {} })
    view.rerender(<ToolPart part={makePart("p8", "c8")} sessionID="s1" messageID="m1" />)
    fireEvent.click(screen.getByRole("button", { name: "始终允许" }))
    await waitFor(() => expect(mocks.respondPermission).toHaveBeenCalledWith("perm-always", "always"))

    mocks.getPermissionForCall.mockReturnValue({ id: "perm-reject", permission: "glob", metadata: {} })
    view.rerender(<ToolPart part={makePart("p9", "c9")} sessionID="s1" messageID="m1" />)
    fireEvent.click(screen.getByRole("button", { name: "拒绝" }))
    await waitFor(() => expect(mocks.respondPermission).toHaveBeenCalledWith("perm-reject", "reject"))
  })

  it("子任务有待处理授权时，工具行显示等待授权状态", () => {
    mocks.permissions = [{ id: "perm-1", sessionID: "s-child", tool: { messageID: "m-sub", callID: "c-sub" } }]
    mocks.getMessagesBySession.mockReturnValue([
      {
        info: { id: "m1", sessionID: "s-child", role: "assistant", time: { created: 1 } },
        parts: [{ id: "t1", type: "tool", tool: "bash", state: { status: "running" } }],
      },
    ])

    const part = {
      id: "p-blocked-perm",
      type: "tool",
      callID: "c-blocked-perm",
      tool: "task",
      state: {
        status: "running",
        title: "Execute Commands",
        input: { description: "Execute Commands", subagent_type: "general", prompt: "run" },
        metadata: { sessionId: "s-child" },
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.getByText(/⚠ 等待授权/)).toBeInTheDocument()
    expect(screen.getByText(/点击查看/)).toBeInTheDocument()
  })

  it("子任务有待回答问题时，工具行显示等待回答状态", () => {
    mocks.getQuestionsBySession.mockImplementation((sid: string) =>
      sid === "s-child" ? [{ id: "q1", sessionID: "s-child" }] : [],
    )
    mocks.getMessagesBySession.mockReturnValue([
      {
        info: { id: "m1", sessionID: "s-child", role: "assistant", time: { created: 1 } },
        parts: [{ id: "t1", type: "tool", tool: "read", state: { status: "completed" } }],
      },
    ])

    const part = {
      id: "p-blocked-q",
      type: "tool",
      callID: "c-blocked-q",
      tool: "task",
      state: {
        status: "running",
        title: "Explore Codebase",
        input: { description: "Explore Codebase", subagent_type: "explore", prompt: "look" },
        metadata: { sessionId: "s-child" },
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.getByText(/❓ 等待回答/)).toBeInTheDocument()
    expect(screen.getByText(/点击查看/)).toBeInTheDocument()
  })

  it("阻塞状态下点击工具行整行打开子任务弹层", () => {
    mocks.permissions = [{ id: "perm-2", sessionID: "s-child", tool: { messageID: "m-sub", callID: "c-sub" } }]
    mocks.getMessagesBySession.mockReturnValue([])

    const part = {
      id: "p-click-blocked",
      type: "tool",
      callID: "c-click-blocked",
      tool: "task",
      state: {
        status: "running",
        title: "My Task",
        input: { description: "My Task", subagent_type: "general", prompt: "go" },
        metadata: { sessionId: "s-child" },
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    // The ToolHeader renders as a button role when expandable, find it
    // The header text should contain the blocked message
    const header = screen.getByText(/⚠ 等待授权/).closest('[role="button"]')
    expect(header).toBeTruthy()
    fireEvent.click(header!)

    expect(mocks.openSubtaskDrawer).toHaveBeenCalledWith({
      sessionId: "s-child",
      title: "My Task",
      subagentType: "general",
      parent: { sessionId: "s1", messageId: "m1", partId: "p-click-blocked" },
    })
  })

  it("授权完成后工具行恢复正常运行状态", () => {
    mocks.permissions = [{ id: "perm-3", sessionID: "s-child", tool: { messageID: "m-sub", callID: "c-sub" } }]
    mocks.getMessagesBySession.mockReturnValue([
      {
        info: { id: "m1", sessionID: "s-child", role: "assistant", time: { created: 1 } },
        parts: [{ id: "t1", type: "tool", tool: "bash", state: { status: "running" } }],
      },
    ])

    const part = {
      id: "p-recover",
      type: "tool",
      callID: "c-recover",
      tool: "task",
      state: {
        status: "running",
        title: "My Task",
        input: { description: "My Task", subagent_type: "general", prompt: "go" },
        metadata: { sessionId: "s-child" },
      },
    } as any

    const view = render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.getByText(/⚠ 等待授权/)).toBeInTheDocument()

    // Simulate permission cleared
    mocks.permissions = []
    view.rerender(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.queryByText(/⚠ 等待授权/)).not.toBeInTheDocument()
    expect(screen.getByText(/1 工具调用/)).toBeInTheDocument()
  })
})
