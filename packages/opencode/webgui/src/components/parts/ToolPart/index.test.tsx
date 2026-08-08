import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { fireEvent } from "@testing-library/react"
import { waitFor } from "@testing-library/react"
import { getGeneratedImageUrl } from "../../../lib/fileUtils"

const mocks = vi.hoisted(() => ({
  isOpen: vi.fn(),
  toggle: vi.fn(),
  setOpen: vi.fn(),
  getPermissionForCall: vi.fn(),
  getMessagesBySession: vi.fn(),
  ensureSession: vi.fn(),
  isSessionLoaded: vi.fn(),
  isSessionLoadError: vi.fn(),
  respondPermission: vi.fn(),
  openSubtaskDrawer: vi.fn(),
  permissions: [] as Array<{ id: string; sessionID: string; tool?: { messageID: string; callID: string } }>,
  getQuestionsBySession: vi.fn<(sessionID: string) => Array<any>>(),
  directory: null as string | null,
}))

vi.mock("../../../state/MessagesContext", () => ({
  useMessages: () => ({
    getPermissionForCall: mocks.getPermissionForCall,
    getMessagesBySession: mocks.getMessagesBySession,
    ensureSession: mocks.ensureSession,
    isSessionLoaded: mocks.isSessionLoaded,
    isSessionLoadError: mocks.isSessionLoadError,
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
  useProject: () => ({ worktree: mocks.directory, directory: mocks.directory }),
  useProjectOptional: () => ({ worktree: mocks.directory, directory: mocks.directory }),
}))

import { ToolPart } from "./index"

describe("ToolPart", () => {
  beforeEach(() => {
    mocks.isOpen.mockReturnValue(true)
    mocks.getPermissionForCall.mockReturnValue(undefined)
    mocks.getMessagesBySession.mockReturnValue([])
    mocks.ensureSession.mockResolvedValue([])
    mocks.isSessionLoaded.mockReturnValue(true)
    mocks.isSessionLoadError.mockReturnValue(false)
    mocks.respondPermission.mockResolvedValue(true)
    mocks.toggle.mockReset()
    mocks.openSubtaskDrawer.mockReset()
    mocks.permissions = []
    mocks.getQuestionsBySession.mockReturnValue([])
    mocks.directory = null
  })

  it("renders a stale running tool as interrupted without animation", () => {
    const { container } = render(
      <ToolPart
        sessionID="s1"
        messageID="m1"
        interrupted
        part={{
          id: "t-interrupted",
          type: "tool",
          callID: "c-interrupted",
          tool: "bash",
          state: { status: "running", input: { command: "sleep 10" } },
        }}
      />,
    )

    expect(screen.getByText("已中断")).toBeInTheDocument()
    expect(container.querySelector(".animate-pulse, .animate-spin")).toBeNull()
  })

  it("interrupted task does not show live subtask progress", () => {
    mocks.getMessagesBySession.mockReturnValue([
      {
        info: { id: "m-child", sessionID: "s-child", role: "assistant", time: { created: 1 } },
        parts: [{ id: "t-child", type: "tool", tool: "bash", state: { status: "running" } }],
      },
    ])

    render(
      <ToolPart
        sessionID="s1"
        messageID="m1"
        interrupted
        part={{
          id: "t-interrupted-task",
          type: "tool",
          callID: "c-interrupted-task",
          tool: "task",
          state: {
            status: "running",
            title: "Interrupted task",
            input: { description: "Interrupted task", subagent_type: "general" },
            metadata: { sessionId: "s-child" },
          },
        }}
      />,
    )

    expect(screen.getByText("已中断")).toBeInTheDocument()
    expect(screen.queryByText(/思考中|执行命令/)).not.toBeInTheDocument()
  })

  it("hides a stale permission request for an interrupted tool", () => {
    mocks.getPermissionForCall.mockReturnValue({ id: "perm-interrupted", permission: "glob", metadata: {} })

    const { container } = render(
      <ToolPart
        sessionID="s1"
        messageID="m1"
        interrupted
        part={{
          id: "t-interrupted-permission",
          type: "tool",
          callID: "c-interrupted-permission",
          tool: "glob",
          state: { status: "running", input: { pattern: "**/*.ts" } },
        }}
      />,
    )

    expect(screen.getByText("已中断")).toBeInTheDocument()
    expect(screen.queryByText("执行该工具需要授权")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "本次允许" })).not.toBeInTheDocument()
    expect(container.querySelector(".animate-pulse, .animate-spin")).toBeNull()
  })

  it("interrupted blocked tasks use the static interruption state", () => {
    mocks.permissions = [{ id: "perm-interrupted", sessionID: "s-permission" }]
    mocks.getQuestionsBySession.mockImplementation((sessionID) =>
      sessionID === "s-question" ? [{ id: "q-interrupted", sessionID }] : [],
    )

    const { container } = render(
      <>
        <ToolPart
          sessionID="s1"
          messageID="m1"
          interrupted
          part={{
            id: "t-interrupted-permission",
            type: "tool",
            callID: "c-interrupted-permission",
            tool: "task",
            state: {
              status: "running",
              input: { description: "Permission task", subagent_type: "general" },
              metadata: { sessionId: "s-permission" },
            },
          }}
        />
        <ToolPart
          sessionID="s1"
          messageID="m1"
          interrupted
          part={{
            id: "t-interrupted-question",
            type: "tool",
            callID: "c-interrupted-question",
            tool: "task",
            state: {
              status: "running",
              input: { description: "Question task", subagent_type: "general" },
              metadata: { sessionId: "s-question" },
            },
          }}
        />
      </>,
    )

    expect(screen.getAllByText("已中断")).toHaveLength(2)
    expect(container.querySelector(".animate-pulse, .animate-spin")).toBeNull()
    expect(screen.queryByText(/等待授权|等待回答/)).not.toBeInTheDocument()

    for (const label of screen.getAllByText("已中断")) {
      const header = label.closest('[role="button"]')
      expect(header).toBeTruthy()
      fireEvent.click(header!)
    }
    expect(mocks.openSubtaskDrawer).not.toHaveBeenCalled()
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

  it("completed 工具接入图片附件网格，relativePath 图片显示专用路由和引用路径", () => {
    const relativePath = ".opencode/generated-images/preview-1.png"
    mocks.directory = "/repo/subdir"

    const part = {
      id: "p-image-attachments",
      type: "tool",
      callID: "c-image-attachments",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "generate-images" },
        output: "done",
        attachments: [
          {
            id: "text-1",
            type: "file",
            mime: "text/plain",
            filename: "note.txt",
            url: "data:text/plain;base64,QQ==",
          },
          {
            id: "image-1",
            type: "file",
            mime: "image/png",
            filename: "preview-1.png",
            relativePath,
            url: "data:image/png;base64,AA==",
          },
          {
            id: "image-2",
            type: "file",
            mime: "image/jpeg",
            filename: "preview-2.jpg",
            url: "data:image/jpeg;base64,AA==",
          },
        ],
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.getByText("Image #1")).toBeInTheDocument()
    expect(screen.getByText("Image #2")).toBeInTheDocument()
    expect(screen.getByText(relativePath)).toBeInTheDocument()
    expect(screen.queryByText("Image #3")).not.toBeInTheDocument()
    expect(screen.queryByText("note.txt")).not.toBeInTheDocument()
    expect(screen.getByRole("img", { name: "preview-1.png" }).getAttribute("src")).toBe(
      getGeneratedImageUrl(relativePath, mocks.directory),
    )
  })

  it("image_generation 工具头部显示中文，且结果区不重复展示 title", () => {
    const part = {
      id: "p-image-generation",
      type: "tool",
      callID: "c-image-generation",
      tool: "image_generation",
      state: {
        status: "completed",
        title: "image_generation",
        output: "已生成 1 张图片：",
        attachments: [
          {
            id: "image-1",
            type: "file",
            mime: "image/png",
            filename: "generated-image-1.png",
            url: "data:image/png;base64,AA==",
          },
        ],
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.getByText("模型内置生图")).toBeInTheDocument()
    expect(screen.queryByText("模型内置生图：image_generation")).not.toBeInTheDocument()
    expect(screen.getByText("已生成 1 张图片：")).toBeInTheDocument()
    expect(screen.queryByText("Image #1 generated-image-1.png")).not.toBeInTheDocument()
    expect(screen.getByText("Image #1")).toBeInTheDocument()
    expect(screen.getByText("generated-image-1.png")).toBeInTheDocument()
  })

  it("可展开工具收起时不显示图片附件", () => {
    mocks.isOpen.mockReturnValue(false)

    const part = {
      id: "p-image-collapsed",
      type: "tool",
      callID: "c-image-collapsed",
      tool: "bash",
      state: {
        status: "completed",
        input: { command: "generate-images" },
        output: "done",
        attachments: [
          {
            id: "image-1",
            type: "file",
            mime: "image/png",
            filename: "preview-1.png",
            url: "data:image/png;base64,AA==",
          },
        ],
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.queryByText("Image #1")).not.toBeInTheDocument()
  })

  it("header-only 工具完成后即使 isOpen=false 也显示图片附件", () => {
    mocks.isOpen.mockReturnValue(false)

    const part = {
      id: "p-image-header-only",
      type: "tool",
      callID: "c-image-header-only",
      tool: "webfetch",
      state: {
        status: "completed",
        attachments: [
          {
            id: "image-1",
            type: "file",
            mime: "image/png",
            filename: "preview-1.png",
            url: "data:image/png;base64,AA==",
          },
        ],
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.getByText("Image #1")).toBeInTheDocument()
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

  it("task 子会话冷启动时默认显示 0 工具调用/思考中，并主动触发加载", async () => {
    mocks.isSessionLoaded.mockReturnValue(false)
    mocks.getMessagesBySession.mockReturnValue([])

    const part = {
      id: "p3-loading",
      type: "tool",
      callID: "c3-loading",
      tool: "task",
      state: {
        status: "running",
        title: "Demo Task",
        input: { description: "Demo Task", subagent_type: "general", prompt: "do" },
        metadata: { sessionId: "s-child" },
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.getByText("委派子任务 (general)：Demo Task [ 0 工具调用 / 思考中 ]")).toBeInTheDocument()
    expect(screen.queryByText("委派子任务 (general)：Demo Task [ 正在加载子任务… ]")).not.toBeInTheDocument()

    await waitFor(() => {
      expect(mocks.ensureSession).toHaveBeenCalledWith("s-child")
    })
  })

  it("task 子会话预加载失败时头部仍显示 0 工具调用/思考中", async () => {
    mocks.isSessionLoaded.mockReturnValue(false)
    mocks.isSessionLoadError.mockReturnValue(true)
    mocks.getMessagesBySession.mockReturnValue([])

    const part = {
      id: "p3-load-error",
      type: "tool",
      callID: "c3-load-error",
      tool: "task",
      state: {
        status: "running",
        title: "Demo Task",
        input: { description: "Demo Task", subagent_type: "general", prompt: "do" },
        metadata: { sessionId: "s-child" },
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.getByText("委派子任务 (general)：Demo Task [ 0 工具调用 / 思考中 ]")).toBeInTheDocument()
    expect(screen.queryByText("委派子任务 (general)：Demo Task [ 子任务加载失败 ]")).not.toBeInTheDocument()
    expect(screen.queryByText("委派子任务 (general)：Demo Task [ 正在加载子任务… ]")).not.toBeInTheDocument()

    await waitFor(() => {
      expect(mocks.ensureSession).toHaveBeenCalledWith("s-child")
    })
  })

  it("task 子会话消息到达后头部立即更新工具调用数，不需要切换会话", () => {
    mocks.isSessionLoaded.mockReturnValue(false)
    mocks.getMessagesBySession.mockReturnValue([])

    const part = {
      id: "p3-update",
      type: "tool",
      callID: "c3-update",
      tool: "task",
      state: {
        status: "running",
        title: "Demo Task",
        input: { description: "Demo Task", subagent_type: "general", prompt: "do" },
        metadata: { sessionId: "s-child" },
      },
    } as any

    const view = render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.getByText("委派子任务 (general)：Demo Task [ 0 工具调用 / 思考中 ]")).toBeInTheDocument()

    mocks.isSessionLoaded.mockReturnValue(true)
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

    view.rerender(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.getByText("委派子任务 (general)：Demo Task [ 2 工具调用 / 执行命令 ]")).toBeInTheDocument()
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

  it("子任务无进行中工具且未完成时头部显示思考中", () => {
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
      id: "p-thinking",
      type: "tool",
      callID: "c-thinking",
      tool: "task",
      state: {
        status: "running",
        title: "Demo Task",
        input: { description: "Demo Task", subagent_type: "general", prompt: "wait" },
        metadata: { sessionId: "s-child" },
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.getByText("委派子任务 (general)：Demo Task [ 2 工具调用 / 思考中 ]")).toBeInTheDocument()
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

  it("question 完成后显示已完成头部和完整只读内容，并可切换问题", () => {
    const part = {
      id: "p-question-completed",
      type: "tool",
      callID: "c-question-completed",
      tool: "question",
      state: {
        status: "completed",
        input: {
          questions: [
            {
              header: "路径",
              question: "要把哪些文件一起提交？",
              options: [
                { label: "只提交相关文件", description: "只处理本次需求范围" },
                { label: "连同版本号一起", description: "把旧提交一起带上" },
              ],
            },
            {
              header: "提交",
              question: "是否继续 push 当前分支？",
              options: [
                { label: "继续 push", description: "把当前分支推送到远端" },
                { label: "先暂停", description: "稍后再处理" },
              ],
            },
          ],
        },
        metadata: {
          answers: [["只提交相关文件"], ["继续 push"]],
        },
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.getByText("提问：已完成 2/2")).toBeInTheDocument()
    expect(screen.getByText("要把哪些文件一起提交？")).toBeInTheDocument()
    expect(screen.getByText("只处理本次需求范围")).toBeInTheDocument()
    expect(screen.getByText("已完成 · 当前为只读")).toBeInTheDocument()

    fireEvent.click(screen.getByRole("button", { name: /提交/ }))

    expect(screen.getByText("是否继续 push 当前分支？")).toBeInTheDocument()
    expect(screen.getByText("把当前分支推送到远端")).toBeInTheDocument()
  })

  it("question 忽略后显示已忽略头部和完整只读内容，而不是错误态", () => {
    const part = {
      id: "p-question-dismissed",
      type: "tool",
      callID: "c-question-dismissed",
      tool: "question",
      state: {
        status: "error",
        error: "question Dismissed: user dismissed this question",
        input: {
          questions: [
            {
              header: "范围",
              question: "无关文件要不要一起处理？",
              options: [
                { label: "不处理", description: "只关注当前需求" },
                { label: "一起处理", description: "顺手整理无关改动" },
              ],
            },
          ],
        },
        metadata: {
          answers: [[]],
        },
      },
    } as any

    const { container } = render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.getByText("提问：已忽略 0/1")).toBeInTheDocument()
    expect(screen.getByText("无关文件要不要一起处理？")).toBeInTheDocument()
    expect(screen.getByText("只关注当前需求")).toBeInTheDocument()
    expect(screen.getByText("已忽略 · 当前为只读")).toBeInTheDocument()
    expect(screen.queryByText("question Dismissed: user dismissed this question")).not.toBeInTheDocument()
    expect(container.firstElementChild).not.toHaveClass("border-red-300")
  })

  it("question 在已完成状态下不提供二次折叠，且即使 isOpen=false 也展示完整内容", () => {
    mocks.isOpen.mockReturnValue(false)

    const part = {
      id: "p-question-fixed-open",
      type: "tool",
      callID: "c-question-fixed-open",
      tool: "question",
      state: {
        status: "completed",
        input: {
          questions: [
            {
              header: "来源",
              question: "应该从哪个 GitHub Release 页面查询更新？",
              options: [{ label: "当前项目自身的 Release", description: "当前项目 repo 的 Release" }],
            },
          ],
        },
        metadata: {
          answers: [["当前项目自身的 Release"]],
        },
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)

    expect(screen.getByText("提问：已完成 1/1")).toBeInTheDocument()
    expect(screen.getByText("应该从哪个 GitHub Release 页面查询更新？")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /提问：已完成 1\/1/i })).not.toBeInTheDocument()
    expect(mocks.toggle).not.toHaveBeenCalled()
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
