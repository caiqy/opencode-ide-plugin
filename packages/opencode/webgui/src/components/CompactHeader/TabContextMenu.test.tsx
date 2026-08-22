import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"

import { TabContextMenu } from "./TabContextMenu"

const props = () => ({
  x: 120,
  y: 240,
  sessionId: "s1",
  isShared: false,
  onClose: vi.fn(),
  onCloseTab: vi.fn(),
  onCloseOtherTabs: vi.fn(),
  onRename: vi.fn(),
  onDelete: vi.fn(),
  onToggleShare: vi.fn(),
  onOpenShareLink: vi.fn(),
})

describe("CompactHeader/TabContextMenu", () => {
  it("显示标签右键菜单并使用中文文案", () => {
    render(<TabContextMenu {...props()} />)

    expect(screen.getByRole("button", { name: "关闭标签" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "关闭其他标签" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "关闭右侧标签" })).toBeNull()
    expect(screen.queryByRole("button", { name: "重新生成标签名" })).toBeNull()
    expect(screen.getByRole("button", { name: "重命名" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "删除会话" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "分享会话" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "打开分享链接" })).toBeNull()
  })

  it("共享会话时显示取消分享与打开分享链接", () => {
    render(<TabContextMenu {...props()} isShared={true} />)

    expect(screen.getByRole("button", { name: "取消分享" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "打开分享链接" })).toBeInTheDocument()
  })

  it("点击菜单项时先执行动作并关闭菜单", () => {
    const p = props()
    render(<TabContextMenu {...p} />)

    fireEvent.click(screen.getByRole("button", { name: "关闭标签" }))

    expect(p.onCloseTab).toHaveBeenCalledTimes(1)
    expect(p.onClose).toHaveBeenCalledTimes(1)
  })

  it("点击外部区域时关闭菜单", () => {
    const p = props()
    render(<TabContextMenu {...p} />)

    fireEvent.mouseDown(document.body)

    expect(p.onClose).toHaveBeenCalledTimes(1)
  })

  it("按下 Escape 时关闭菜单", () => {
    const p = props()
    render(<TabContextMenu {...p} />)

    fireEvent.keyDown(document, { key: "Escape" })

    expect(p.onClose).toHaveBeenCalledTimes(1)
  })
})
