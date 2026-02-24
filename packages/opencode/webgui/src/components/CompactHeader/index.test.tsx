import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ConnectionState } from "../../lib/api/events"

type DropdownMock = {
  dropdownRef: { current: HTMLDivElement | null }
  toggleDropdown: ReturnType<typeof vi.fn>
  closeDropdown: ReturnType<typeof vi.fn>
  filteredSessions: unknown[]
  isDropdownOpen: boolean
  isSelectMode: boolean
  selectedSessions: Set<string>
  setSelectedSessions: ReturnType<typeof vi.fn>
  selectedSessionIndex: number
  searchQuery: string
  setSearchQuery: ReturnType<typeof vi.fn>
  searchInputRef: { current: HTMLInputElement | null }
  handleSearchKeyDown: ReturnType<typeof vi.fn>
  toggleSelectMode: ReturnType<typeof vi.fn>
  selectedSessionRef: { current: HTMLDivElement | null }
  sessionListRef: { current: HTMLDivElement | null }
  handleSessionCheckboxChange: ReturnType<typeof vi.fn>
  handleKeyDown: ReturnType<typeof vi.fn>
  setIsDropdownOpen: ReturnType<typeof vi.fn>
}

type ActionsMock = {
  editingSessionId: string | null
  editingTitle: string
  setEditingTitle: ReturnType<typeof vi.fn>
  deleteConfirm: string | null
  setDeleteConfirm: ReturnType<typeof vi.fn>
  isDeleting: boolean
  editInputRef: { current: HTMLInputElement | null }
  handleEditStart: ReturnType<typeof vi.fn>
  handleEditSave: ReturnType<typeof vi.fn>
  handleEditCancel: ReturnType<typeof vi.fn>
  handleDeleteStart: ReturnType<typeof vi.fn>
  handleBulkDeleteStart: ReturnType<typeof vi.fn>
  handleDeleteConfirm: ReturnType<typeof vi.fn>
  handleDeleteCancel: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => ({
  useTheme: vi.fn(),
  useSession: vi.fn(),
  useTabStore: vi.fn(),
  useSessionDropdown: vi.fn(),
  useSessionActions: vi.fn(),
  useToast: vi.fn(),
  sdkShare: vi.fn(),
  sdkUnshare: vi.fn(),
}))

vi.mock("../../state/ThemeContext", () => ({
  useTheme: (...args: unknown[]) => mocks.useTheme(...args),
}))

vi.mock("../../state/SessionContext", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../../state/SessionContext")
  return {
    ...actual,
    useSession: (...args: unknown[]) => mocks.useSession(...args),
  }
})

vi.mock("../../state/tabStore", () => ({
  useTabStore: (...args: unknown[]) => mocks.useTabStore(...args),
}))

vi.mock("./hooks/useSessionDropdown", () => ({
  useSessionDropdown: (...args: unknown[]) => mocks.useSessionDropdown(...args),
}))

vi.mock("./hooks/useSessionActions", () => ({
  useSessionActions: (...args: unknown[]) => mocks.useSessionActions(...args),
}))

vi.mock("../../state/ToastContext", () => ({
  useToast: (...args: unknown[]) => mocks.useToast(...args),
}))

vi.mock("../SettingsPanel", () => ({
  SettingsPanel: () => null,
}))

vi.mock("./StatusIndicator", () => ({
  StatusIndicator: () => null,
}))

vi.mock("./SessionDropdown", () => ({
  SessionDropdown: () => null,
}))

vi.mock("./TabBar", () => ({
  TabBar: () => null,
}))

vi.mock("../../lib/api/sdkClient", () => ({
  sdk: {
    session: {
      share: (...args: unknown[]) => mocks.sdkShare(...args),
      unshare: (...args: unknown[]) => mocks.sdkUnshare(...args),
    },
  },
}))

import { CompactHeader } from "./index"

function mockClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  })
  return { writeText }
}

function createBaseDropdownMock(): DropdownMock {
  return {
    dropdownRef: { current: null },
    toggleDropdown: vi.fn(),
    closeDropdown: vi.fn(),
    filteredSessions: [],
    isDropdownOpen: false,
    isSelectMode: false,
    selectedSessions: new Set(),
    setSelectedSessions: vi.fn(),
    selectedSessionIndex: 0,
    searchQuery: "",
    setSearchQuery: vi.fn(),
    searchInputRef: { current: null },
    handleSearchKeyDown: vi.fn(),
    toggleSelectMode: vi.fn(),
    selectedSessionRef: { current: null },
    sessionListRef: { current: null },
    handleSessionCheckboxChange: vi.fn(),
    handleKeyDown: vi.fn(),
    setIsDropdownOpen: vi.fn(),
  }
}

function createBaseActionsMock(): ActionsMock {
  return {
    editingSessionId: null,
    editingTitle: "",
    setEditingTitle: vi.fn(),
    deleteConfirm: null,
    setDeleteConfirm: vi.fn(),
    isDeleting: false,
    editInputRef: { current: null },
    handleEditStart: vi.fn(),
    handleEditSave: vi.fn(),
    handleEditCancel: vi.fn(),
    handleDeleteStart: vi.fn(),
    handleBulkDeleteStart: vi.fn(),
    handleDeleteConfirm: vi.fn(),
    handleDeleteCancel: vi.fn(),
  }
}

describe("CompactHeader", () => {
  beforeEach(() => {
    mocks.sdkShare.mockResolvedValue({ data: null })
    mocks.sdkUnshare.mockResolvedValue({ data: null })

    mocks.useTheme.mockReturnValue({ theme: "light", toggleTheme: vi.fn() })

    mocks.useSession.mockReturnValue({
      currentSession: { id: "s1", title: "测试会话" },
      setCurrentSession: vi.fn(),
      sessions: [],
      setSessions: vi.fn(),
      switchSession: vi.fn(),
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      isLoading: false,
    })

    mocks.useTabStore.mockReturnValue({
      openTabs: ["s1"],
      activeTab: "s1",
      loaded: true,
      openTab: vi.fn(),
      closeTab: vi.fn(),
      removeTab: vi.fn(),
      setActiveTab: vi.fn(),
      reorderTabs: vi.fn(),
      replaceTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeTabsToRight: vi.fn(),
    })

    mocks.useSessionDropdown.mockReturnValue(createBaseDropdownMock())
    mocks.useSessionActions.mockReturnValue(createBaseActionsMock())
    mocks.useToast.mockReturnValue({ showToast: vi.fn() })
  })

  it("删除确认弹窗文案为中文（批量删除）", () => {
    mocks.useSessionDropdown.mockReturnValue({ ...createBaseDropdownMock(), selectedSessions: new Set(["s1", "s2"]) })
    mocks.useSessionActions.mockReturnValue({ ...createBaseActionsMock(), deleteConfirm: "bulk" })

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    expect(screen.getByText("删除多个会话")).toBeInTheDocument()
    expect(screen.getByText("确定要删除所选的 2 个会话吗？此操作无法撤销。")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "删除" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument()
  })

  it("分享成功后 toast 文案为中文", async () => {
    const user = userEvent.setup()
    const { writeText } = mockClipboard()

    mocks.sdkShare.mockResolvedValue({
      data: { id: "s1", title: "测试会话", share: { url: "https://example.com/share" } },
    })

    const showToast = vi.fn()
    mocks.useToast.mockReturnValue({ showToast })

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await user.click(screen.getByTitle("更多选项"))
    await user.click(screen.getByText("分享会话"))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("https://example.com/share")
      expect(showToast).toHaveBeenCalledWith("分享链接已复制到剪贴板", { variant: "success" })
    })
  })

  it("removes open tabs when backing session is deleted", () => {
    const removeTab = vi.fn()
    const sessions = [{ id: "s1", title: "测试会话" }]
    let isLoading = true
    mocks.useSession.mockImplementation(() => ({
      currentSession: { id: "s1", title: "测试会话" },
      setCurrentSession: vi.fn(),
      sessions,
      setSessions: vi.fn(),
      switchSession: vi.fn(),
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      isLoading,
    }))
    mocks.useTabStore.mockReturnValue({
      openTabs: ["s1", "s2", "virtual-1"],
      activeTab: "s1",
      loaded: true,
      openTab: vi.fn(),
      closeTab: vi.fn(),
      removeTab,
      setActiveTab: vi.fn(),
      reorderTabs: vi.fn(),
      replaceTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeTabsToRight: vi.fn(),
    })

    const props = {
      connectionState: "connected" as ConnectionState,
      onNewSession: vi.fn(),
      isCreatingSession: false,
      onOpenCommandPalette: vi.fn(),
    }

    // First render with isLoading=true so sessionsEverLoaded becomes true
    const view = render(<CompactHeader {...props} />)
    expect(removeTab).not.toHaveBeenCalled()

    // Simulate loading complete — cleanup should now run and remove s2
    isLoading = false
    view.rerender(<CompactHeader {...props} />)

    expect(removeTab).toHaveBeenCalledWith("s2")
    expect(removeTab).not.toHaveBeenCalledWith("virtual-1")

    removeTab.mockClear()
    sessions.push({ id: "s2", title: "会话 2" })
    view.rerender(<CompactHeader {...props} />)

    expect(removeTab).not.toHaveBeenCalled()
  })

  it("cleans orphan tabs when openTabs changes even if sessions reference is unchanged", () => {
    const removeTab = vi.fn()
    const sessions = [{ id: "s1", title: "测试会话" }]
    let isLoading = true
    const state = {
      openTabs: ["s1"],
    }

    mocks.useSession.mockImplementation(() => ({
      currentSession: { id: "s1", title: "测试会话" },
      setCurrentSession: vi.fn(),
      sessions,
      setSessions: vi.fn(),
      switchSession: vi.fn(),
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      isLoading,
    }))

    mocks.useTabStore.mockImplementation(() => ({
      openTabs: state.openTabs,
      activeTab: "s1",
      loaded: true,
      openTab: vi.fn(),
      closeTab: vi.fn(),
      removeTab,
      setActiveTab: vi.fn(),
      reorderTabs: vi.fn(),
      replaceTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeTabsToRight: vi.fn(),
    }))

    const props = {
      connectionState: "connected" as ConnectionState,
      onNewSession: vi.fn(),
      isCreatingSession: false,
      onOpenCommandPalette: vi.fn(),
    }

    const view = render(<CompactHeader {...props} />)
    expect(removeTab).not.toHaveBeenCalled()

    isLoading = false
    view.rerender(<CompactHeader {...props} />)
    expect(removeTab).not.toHaveBeenCalled()

    state.openTabs = ["s1", "s2"]
    view.rerender(<CompactHeader {...props} />)

    expect(removeTab).toHaveBeenCalledWith("s2")
  })

  it("adds left gap between tab area and right status/actions area", () => {
    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    const right = screen.getByTestId("compact-header-right")
    expect(right.className).toContain("ml-2")
  })
})
