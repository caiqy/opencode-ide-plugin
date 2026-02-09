import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import { SessionItem } from "./SessionItem"

describe("CompactHeader/SessionItem", () => {
  it("操作按钮的 tooltip 为中文", () => {
    const { container } = render(
      <SessionItem
        session={{ id: "s1", title: null, share: { url: "https://example.com" }, time: { created: Date.now() } }}
        isActive={true}
        isEditing={false}
        isSelectMode={false}
        isSelected={false}
        selectedSessionIndex={0}
        currentIndex={0}
        editingTitle={""}
        editInputRef={{ current: null }}
        selectedSessionRef={{ current: null }}
        isSharing={false}
        onSelect={vi.fn()}
        onEditStart={vi.fn()}
        onEditSave={vi.fn()}
        onEditCancel={vi.fn()}
        onEditChange={vi.fn()}
        onDeleteStart={vi.fn()}
        onCheckboxChange={vi.fn()}
        onKeyDown={vi.fn()}
        onToggleShare={vi.fn()}
      />,
    )

    expect(screen.getByText("新建会话")).toBeInTheDocument()

    expect(container.querySelector('button[title="打开分享链接"]')).toBeTruthy()
    expect(container.querySelector('button[title="取消分享会话"]')).toBeTruthy()
    expect(container.querySelector('button[title="编辑标题"]')).toBeTruthy()
    expect(container.querySelector('button[title="删除会话"]')).toBeTruthy()
  })
})
