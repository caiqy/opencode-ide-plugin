import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ConnectionState } from "../../lib/api/events"

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

vi.mock("../../lib/api/sdkClient", () => ({
  sdk: {
    session: {
      share: (...args: unknown[]) => mocks.sdkShare(...args),
      unshare: (...args: unknown[]) => mocks.sdkUnshare(...args),
    },
  },
}))

import { CompactHeader } from "./index"

function baseDropdown() {
  return {
    dropdownRef: { current: null },
    toggleDropdown: vi.fn(),
    closeDropdown: vi.fn(),
    filteredSessions: [],
    isDropdownOpen: false,
    isSelectMode: false,
    selectedSessions: new Set<string>(),
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

function baseActions() {
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

function props() {
  return {
    connectionState: "connected" as ConnectionState,
    onNewSession: vi.fn(),
    isCreatingSession: false,
    onOpenCommandPalette: vi.fn(),
  }
}

describe("CompactHeader integration with real TabBar", () => {
  beforeEach(() => {
    mocks.sdkShare.mockResolvedValue({ data: null })
    mocks.sdkUnshare.mockResolvedValue({ data: null })
    mocks.useTheme.mockReturnValue({ theme: "light", toggleTheme: vi.fn() })
    mocks.useSessionDropdown.mockReturnValue(baseDropdown())
    mocks.useSessionActions.mockReturnValue(baseActions())
    mocks.useToast.mockReturnValue({ showToast: vi.fn() })
  })

  it("activates a tab and switches session when user clicks another tab", async () => {
    const setActiveTab = vi.fn()
    const switchSession = vi.fn().mockResolvedValue(undefined)

    mocks.useSession.mockReturnValue({
      currentSession: { id: "s1", title: "会话 1" },
      setCurrentSession: vi.fn(),
      sessions: [
        { id: "s1", title: "会话 1" },
        { id: "s2", title: "会话 2" },
      ],
      setSessions: vi.fn(),
      switchSession,
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      isLoading: false,
      isSessionIdle: vi.fn(() => true),
      isSessionReasoning: vi.fn(() => false),
    })

    mocks.useTabStore.mockReturnValue({
      openTabs: ["s1", "s2"],
      activeTab: "s1",
      loaded: true,
      openTab: vi.fn(),
      closeTab: vi.fn(),
      removeTab: vi.fn(),
      setActiveTab,
      reorderTabs: vi.fn(),
      replaceTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeTabsToRight: vi.fn(),
    })

    const user = userEvent.setup()
    render(<CompactHeader {...props()} />)

    await user.click(screen.getByTitle("会话 2"))

    expect(setActiveTab).toHaveBeenCalledWith("s2")
    await waitFor(() => {
      expect(switchSession).toHaveBeenCalledWith("s2")
    })
  })

  it("rolls back active tab and shows toast when switching session fails", async () => {
    const setActiveTab = vi.fn()
    const switchSession = vi.fn().mockRejectedValue(new Error("boom"))
    const showToast = vi.fn()

    mocks.useToast.mockReturnValue({ showToast })
    mocks.useSession.mockReturnValue({
      currentSession: { id: "s1", title: "会话 1" },
      setCurrentSession: vi.fn(),
      sessions: [
        { id: "s1", title: "会话 1" },
        { id: "s2", title: "会话 2" },
      ],
      setSessions: vi.fn(),
      switchSession,
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      isLoading: false,
      isSessionIdle: vi.fn(() => true),
      isSessionReasoning: vi.fn(() => false),
    })

    mocks.useTabStore.mockReturnValue({
      openTabs: ["s1", "s2"],
      activeTab: "s1",
      loaded: true,
      openTab: vi.fn(),
      closeTab: vi.fn(),
      removeTab: vi.fn(),
      setActiveTab,
      reorderTabs: vi.fn(),
      replaceTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeTabsToRight: vi.fn(),
    })

    const user = userEvent.setup()
    render(<CompactHeader {...props()} />)

    await user.click(screen.getByTitle("会话 2"))

    await waitFor(() => {
      expect(switchSession).toHaveBeenCalledWith("s2")
    })
    expect(setActiveTab).toHaveBeenCalledWith("s2")
    expect(setActiveTab).toHaveBeenCalledWith("s1")
    expect(showToast).toHaveBeenCalledWith("切换会话失败", { variant: "error" })
  })

  it("删除当前会话后会清理标签并切换到下一个标签", async () => {
    let done = () => {}
    const switchSession = vi.fn((id: string) => {
      if (id === "s1") {
        return new Promise<void>((resolve) => {
          done = resolve
        })
      }
      return Promise.resolve()
    })
    const onNewSession = vi.fn()
    let isLoading = true
    const state = {
      sessions: [
        { id: "s1", title: "会话 1" },
        { id: "s2", title: "会话 2" },
      ],
      currentSession: null as { id: string; title: string } | null,
      openTabs: ["s1", "s2"],
      activeTab: "s1",
    }
    const pruneTabs = vi.fn((validIds: Set<string>) => {
      const openTabs = state.openTabs.filter((id) => validIds.has(id))
      state.openTabs = openTabs
      state.activeTab = openTabs.includes(state.activeTab) ? state.activeTab : openTabs[openTabs.length - 1] || ""
    })

    mocks.useSession.mockImplementation(() => ({
      currentSession: state.currentSession,
      setCurrentSession: vi.fn(),
      sessions: state.sessions,
      setSessions: vi.fn(),
      switchSession,
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      isLoading,
      isSessionIdle: vi.fn(() => true),
      isSessionReasoning: vi.fn(() => false),
    }))

    mocks.useTabStore.mockImplementation(() => ({
      openTabs: state.openTabs,
      activeTab: state.activeTab,
      loaded: true,
      openTab: vi.fn(),
      closeTab: vi.fn(),
      removeTab: vi.fn(),
      setActiveTab: vi.fn(),
      reorderTabs: vi.fn(),
      replaceTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeTabsToRight: vi.fn(),
      pruneTabs,
    }))

    const view = render(<CompactHeader {...props()} onNewSession={onNewSession} />)

    await waitFor(() => {
      expect(switchSession).toHaveBeenCalledWith("s1")
    })

    isLoading = false
    view.rerender(<CompactHeader {...props()} onNewSession={onNewSession} />)

    state.sessions = [{ id: "s2", title: "会话 2" }]
    view.rerender(<CompactHeader {...props()} onNewSession={onNewSession} />)

    await waitFor(() => {
      expect(pruneTabs).toHaveBeenCalledWith(new Set(["s2"]))
    })

    view.rerender(<CompactHeader {...props()} onNewSession={onNewSession} />)
    done()

    await waitFor(() => {
      expect(switchSession).toHaveBeenCalledWith("s2")
    })

    expect(onNewSession).not.toHaveBeenCalled()
  })
})
