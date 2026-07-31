import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

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
        pinningSessionId={null}
        hasMore={false}
        isLoadingMore={false}
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
        onLoadMore={vi.fn()}
        onToggleShare={vi.fn()}
        onTogglePin={vi.fn()}
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
        pinningSessionId={null}
        hasMore={false}
        isLoadingMore={false}
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
        onLoadMore={vi.fn()}
        onToggleShare={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    )

    expect(screen.getByRole("button", { name: "删除 2 个会话" })).toBeInTheDocument()
  })

  it("hasMore 时显示加载更多按钮并触发回调", async () => {
    const onLoadMore = vi.fn()
    const user = userEvent.setup()

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
        pinningSessionId={null}
        hasMore={true}
        isLoadingMore={false}
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
        onLoadMore={onLoadMore}
        onToggleShare={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    )

    await user.click(screen.getByRole("button", { name: "加载更多" }))

    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it("加载更多时按钮禁用并显示加载态", () => {
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
        pinningSessionId={null}
        hasMore={true}
        isLoadingMore={true}
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
        onLoadMore={vi.fn()}
        onToggleShare={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    )

    expect(screen.getByRole("button", { name: "加载中…" })).toBeDisabled()
  })
})
