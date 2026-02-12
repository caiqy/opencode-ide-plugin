import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

const mocks = vi.hoisted(() => ({
  isOpen: vi.fn(),
  toggle: vi.fn(),
  setOpen: vi.fn(),
  getPermissionForCall: vi.fn(),
  respondPermission: vi.fn(),
}))

vi.mock("../../../state/MessagesContext", () => ({
  useMessages: () => ({
    getPermissionForCall: mocks.getPermissionForCall,
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
    mocks.respondPermission.mockResolvedValue(true)
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
})
