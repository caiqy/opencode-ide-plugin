import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

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

describe("ToolPart streaming preview", () => {
  beforeEach(() => {
    mocks.isOpen.mockReturnValue(true)
    mocks.getPermissionForCall.mockReturnValue(undefined)
    mocks.getMessagesBySession.mockReturnValue([])
    mocks.ensureSession.mockResolvedValue([])
    mocks.isSessionLoaded.mockReturnValue(true)
    mocks.isSessionLoadError.mockReturnValue(false)
    mocks.respondPermission.mockResolvedValue(true)
    mocks.openSubtaskDrawer.mockReset()
    mocks.permissions = []
    mocks.getQuestionsBySession.mockReturnValue([])
    mocks.directory = null
    mocks.setOpen.mockReset()
  })

  it("pending write 工具的 header 显示已接收行数", () => {
    const part = {
      id: "prt_w1",
      type: "tool",
      callID: "call_1",
      tool: "write",
      state: {
        status: "pending",
        input: {},
        raw: '{"filePath":"/tmp/a.ts","content":"line1\\nline2\\nline3 unfinish',
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)
    expect(screen.getByText(/已接收\s*3\s*行/)).toBeInTheDocument()
  })

  it("pending write 在展开区显示 partial content", () => {
    const part = {
      id: "prt_w2",
      type: "tool",
      callID: "call_2",
      tool: "write",
      state: {
        status: "pending",
        input: {},
        raw: '{"filePath":"/tmp/a.ts","content":"hello\\nworld',
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)
    expect(screen.getByText(/\+hello/)).toBeInTheDocument()
  })

  it("pending edit 在展开区按 newString 走 WriteTool 预览", () => {
    const part = {
      id: "prt_e1",
      type: "tool",
      callID: "call_e1",
      tool: "edit",
      state: {
        status: "pending",
        input: {},
        raw: '{"filePath":"/tmp/a.ts","oldString":"old","newString":"new line 1\\nnew line 2',
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)
    expect(screen.getByText(/\+new line 1/)).toBeInTheDocument()
    expect(screen.getByText(/已接收\s*2\s*行/)).toBeInTheDocument()
  })

  it("pending apply_patch 在展开区显示 partial patchText", () => {
    const part = {
      id: "prt_p1",
      type: "tool",
      callID: "call_p1",
      tool: "apply_patch",
      state: {
        status: "pending",
        input: {},
        raw: '{"patchText":"*** Begin Patch\\n*** Add File: a.ts\\n+hello',
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)
    expect(screen.getByText(/\+\*\*\* Begin Patch/)).toBeInTheDocument()
  })

  it("pending 非三件套（read）不显示已接收行数", () => {
    const part = {
      id: "prt_r1",
      type: "tool",
      callID: "call_r1",
      tool: "read",
      state: {
        status: "pending",
        input: {},
        raw: '{"filePath":"/tmp/a.ts"}',
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)
    expect(screen.queryByText(/已接收/)).not.toBeInTheDocument()
  })

  it("completed write 工具不再显示已接收行数，沿用最终 content", () => {
    const part = {
      id: "prt_w3",
      type: "tool",
      callID: "call_3",
      tool: "write",
      state: {
        status: "completed",
        input: { filePath: "/tmp/a.ts", content: "done\nfinal" },
        output: "Wrote file successfully.",
        title: "a.ts",
        metadata: {},
        time: { start: 1, end: 2 },
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)
    expect(screen.queryByText(/已接收/)).not.toBeInTheDocument()
    expect(screen.getByText(/\+done/)).toBeInTheDocument()
  })

  it("pending 三件套且未展开时自动调用 setOpen(id, true)", () => {
    mocks.isOpen.mockReturnValue(false)

    const part = {
      id: "prt_auto1",
      type: "tool",
      callID: "call_auto1",
      tool: "write",
      state: {
        status: "pending",
        input: {},
        raw: '{"filePath":"/tmp/a.ts","content":"x',
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)
    expect(mocks.setOpen).toHaveBeenCalledWith("prt_auto1", true)
  })

  it("pending 非三件套（read）不会触发自动展开", () => {
    mocks.isOpen.mockReturnValue(false)

    const part = {
      id: "prt_auto2",
      type: "tool",
      callID: "call_auto2",
      tool: "read",
      state: {
        status: "pending",
        input: {},
        raw: '{"filePath":"/tmp/a.ts"}',
      },
    } as any

    render(<ToolPart part={part} sessionID="s1" messageID="m1" />)
    expect(mocks.setOpen).not.toHaveBeenCalled()
  })
})
