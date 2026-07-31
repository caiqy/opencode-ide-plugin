import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen } from "@testing-library/react"
import type { Session } from "@opencode-ai/sdk/client"

import { SessionItem } from "./SessionItem"

describe("CompactHeader/SessionItem", () => {
  it("操作按钮的 tooltip 为中文", () => {
    const onTogglePin = vi.fn()
    const { container } = render(
      <SessionItem
        session={
          {
            id: "s1",
            projectID: "project",
            directory: "/workspace",
            title: "",
            version: "test",
            share: { url: "https://example.com" },
            metadata: { "opencode.session.pinned": true },
            time: { created: Date.now(), updated: Date.now() },
          } satisfies Session & { metadata: Record<string, unknown> }
        }
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
        isPinning={false}
        onSelect={vi.fn()}
        onEditStart={vi.fn()}
        onEditSave={vi.fn()}
        onEditCancel={vi.fn()}
        onEditChange={vi.fn()}
        onDeleteStart={vi.fn()}
        onCheckboxChange={vi.fn()}
        onKeyDown={vi.fn()}
        onToggleShare={vi.fn()}
        onTogglePin={onTogglePin}
      />,
    )

    expect(screen.getByText("新建会话")).toBeInTheDocument()

    expect(container.querySelector('button[title="打开分享链接"]')).toBeTruthy()
    expect(screen.getByLabelText("已钉住")).toBeInTheDocument()
    fireEvent.click(screen.getByRole("button", { name: "取消钉住" }))
    expect(onTogglePin).toHaveBeenCalledOnce()
    expect(container.querySelector('button[title="取消分享会话"]')).toBeTruthy()
    expect(container.querySelector('button[title="编辑标题"]')).toBeTruthy()
    expect(container.querySelector('button[title="删除会话"]')).toBeTruthy()
  })
})
