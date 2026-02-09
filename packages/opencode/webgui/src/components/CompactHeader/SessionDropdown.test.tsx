import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"

import { SessionDropdown } from "./SessionDropdown"

describe("CompactHeader/SessionDropdown", () => {
  it("搜索框 placeholder 与多选按钮提示为中文", () => {
    render(
      <SessionDropdown
        sessions={[]}
        currentSessionId={undefined}
        filteredSessions={[]}
        isDropdownOpen={true}
        isSelectMode={false}
        selectedSessions={new Set()}
        selectedSessionIndex={0}
        searchQuery={""}
        editingSessionId={null}
        editingTitle={""}
        searchInputRef={{ current: null }}
        editInputRef={{ current: null }}
        selectedSessionRef={{ current: null }}
        sessionListRef={{ current: null }}
        sharingSessionId={null}
        onSearchChange={vi.fn()}
        onSearchKeyDown={vi.fn()}
        onToggleSelectMode={vi.fn()}
        onSessionSelect={vi.fn()}
        onEditStart={vi.fn()}
        onEditSave={vi.fn()}
        onEditCancel={vi.fn()}
        onEditChange={vi.fn()}
        onDeleteStart={vi.fn()}
        onBulkDeleteStart={vi.fn()}
        onCheckboxChange={vi.fn()}
        onKeyDown={vi.fn()}
        onToggleShare={vi.fn()}
      />,
    )

    expect(screen.getByPlaceholderText("搜索会话…")).toBeInTheDocument()
    expect(screen.getByTitle("选择多个会话")).toBeInTheDocument()
  })

  it("多选模式下批量删除按钮文案为中文", () => {
    render(
      <SessionDropdown
        sessions={[]}
        currentSessionId={undefined}
        filteredSessions={[]}
        isDropdownOpen={true}
        isSelectMode={true}
        selectedSessions={new Set(["s1", "s2"])}
        selectedSessionIndex={0}
        searchQuery={""}
        editingSessionId={null}
        editingTitle={""}
        searchInputRef={{ current: null }}
        editInputRef={{ current: null }}
        selectedSessionRef={{ current: null }}
        sessionListRef={{ current: null }}
        sharingSessionId={null}
        onSearchChange={vi.fn()}
        onSearchKeyDown={vi.fn()}
        onToggleSelectMode={vi.fn()}
        onSessionSelect={vi.fn()}
        onEditStart={vi.fn()}
        onEditSave={vi.fn()}
        onEditCancel={vi.fn()}
        onEditChange={vi.fn()}
        onDeleteStart={vi.fn()}
        onBulkDeleteStart={vi.fn()}
        onCheckboxChange={vi.fn()}
        onKeyDown={vi.fn()}
        onToggleShare={vi.fn()}
      />,
    )

    expect(screen.getByRole("button", { name: "删除 2 个会话" })).toBeInTheDocument()
  })
})
