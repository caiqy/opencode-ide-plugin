import { act, render, screen, waitFor } from "@testing-library/react"
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
  sdkSessionGet: vi.fn(),
  sdkSetPinned: vi.fn(),
  sessionDropdown: vi.fn(),
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
  StatusIndicator: (props: { open?: boolean; onToggle?: () => void }) => (
    <button type="button" title="状态点" aria-expanded={props.open ?? false} onClick={props.onToggle}>
      状态点
    </button>
  ),
}))

vi.mock("./StatusPopover", () => ({
  StatusPopover: (props: { open: boolean; onClose: () => void }) =>
    props.open ? (
      <div role="dialog" aria-label="状态面板">
        <span>状态弹层</span>
        <button type="button" onClick={props.onClose}>
          关闭状态弹层
        </button>
      </div>
    ) : null,
}))

vi.mock("./SessionDropdown", () => ({
  SessionDropdown: (props: unknown) => {
    mocks.sessionDropdown(props)
    return null
  },
}))

vi.mock("../../state/UpdateContext", () => ({
  useUpdate: () => ({
    isChecking: false,
    checkForUpdates: vi.fn(),
    confirmOpen: false,
    confirmVersion: null,
    confirmInstall: vi.fn(),
    cancelInstallConfirm: vi.fn(),
    dismissed: false,
    dismissUpdate: vi.fn(),
  }),
}))

vi.mock("../../lib/api/sdkClient", () => ({
  setSessionPinned: (...args: unknown[]) => mocks.sdkSetPinned(...args),
  sdk: {
    session: {
      get: (...args: unknown[]) => mocks.sdkSessionGet(...args),
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
    mocks.sdkSessionGet.mockReset()
    mocks.sdkSessionGet.mockResolvedValue({ data: null, error: { status: 404 } })
    mocks.sdkSetPinned.mockResolvedValue({ data: null })
    mocks.sessionDropdown.mockReset()
    mocks.useTheme.mockReturnValue({ theme: "light", toggleTheme: vi.fn() })
    mocks.useSessionDropdown.mockReturnValue(baseDropdown())
    mocks.useSessionActions.mockReturnValue(baseActions())
    mocks.useToast.mockReturnValue({ showToast: vi.fn() })
  })

  it("透传分页状态给 SessionDropdown", () => {
    const loadMoreSessions = vi.fn()

    mocks.useSession.mockReturnValue({
      currentSession: { id: "s1", title: "会话 1" },
      setCurrentSession: vi.fn(),
      sessions: [{ id: "s1", title: "会话 1" }],
      setSessions: vi.fn(),
      switchSession: vi.fn(),
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      hasMore: true,
      isLoadingMore: false,
      loadMoreSessions,
      isLoading: true,
      isSessionIdle: vi.fn(() => true),
      isSessionReasoning: vi.fn(() => false),
    })

    mocks.useTabStore.mockReturnValue({
      openTabs: ["s1"],
      activeTab: "s1",
      loaded: true,
      openTab: vi.fn(),
      closeTab: vi.fn(),
      removeTab: vi.fn(),
      activateTab: vi.fn(),
      reorderTabs: vi.fn(),
      replaceTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeTabsToRight: vi.fn(),
      pruneTabs: vi.fn(),
    })

    render(<CompactHeader {...props()} />)

    expect(mocks.sessionDropdown).toHaveBeenCalled()
    expect(mocks.sessionDropdown.mock.calls.at(-1)?.[0]).toMatchObject({
      hasMore: true,
      isLoadingMore: false,
      onLoadMore: loadMoreSessions,
    })
  })

  it("钉住成功后只更新仍存在会话的钉住状态，失败时保留状态并提示", async () => {
    const setSessions = vi.fn()
    const loadSessions = vi.fn().mockResolvedValue(undefined)
    const showToast = vi.fn()
    const sessions = [
      { id: "recent", title: "recent", time: { created: 2, updated: 200 } },
      { id: "old", title: "old", time: { created: 1, updated: 100 } },
    ]
    mocks.sdkSetPinned.mockResolvedValueOnce({
      data: { ...sessions[1], metadata: { "opencode.session.pinned": true } },
      error: null,
    })
    mocks.useToast.mockReturnValue({ showToast })
    mocks.useSession.mockReturnValue({
      currentSession: sessions[0],
      setCurrentSession: vi.fn(),
      sessions,
      setSessions,
      switchSession: vi.fn(),
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      hasMore: false,
      isLoadingMore: false,
      loadSessions,
      loadMoreSessions: vi.fn(),
      isLoading: false,
      isSessionIdle: vi.fn(() => true),
      isSessionReasoning: vi.fn(() => false),
    })
    mocks.useTabStore.mockReturnValue({
      openTabs: ["recent"],
      activeTab: "recent",
      loaded: true,
      openTab: vi.fn(),
      closeTab: vi.fn(),
      removeTab: vi.fn(),
      activateTab: vi.fn(),
      reorderTabs: vi.fn(),
      replaceTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeTabsToRight: vi.fn(),
      pruneTabs: vi.fn(),
    })

    render(<CompactHeader {...props()} />)
    const dropdown = () =>
      mocks.sessionDropdown.mock.calls.at(-1)![0] as {
        onTogglePin: (id: string, event: { stopPropagation: () => void }) => Promise<void>
      }
    await act(async () => {
      await dropdown().onTogglePin("old", { stopPropagation: vi.fn() })
    })

    expect(mocks.sdkSetPinned).toHaveBeenCalledWith({ path: { id: "old" }, body: { pinned: true } })
    const update = setSessions.mock.calls[0][0] as (value: typeof sessions) => typeof sessions
    const updated = update([
      sessions[0],
      {
        ...sessions[1],
        title: "renamed",
        metadata: { keep: true, "opencode.session.pinned": true },
      },
    ] as typeof sessions)
    expect(updated.map((item) => item.id)).toEqual(["old", "recent"])
    expect(updated[0]).toMatchObject({
      title: "renamed",
      metadata: { keep: true, "opencode.session.pinned": true },
    })
    expect(update([sessions[0]])).toEqual([sessions[0]])
    expect(loadSessions).toHaveBeenCalledOnce()
    expect(showToast).not.toHaveBeenCalled()

    mocks.sdkSetPinned.mockResolvedValueOnce({ data: null, error: { message: "failed" } })
    await act(async () => {
      await dropdown().onTogglePin("old", { stopPropagation: vi.fn() })
    })
    expect(setSessions).toHaveBeenCalledOnce()
    expect(showToast).toHaveBeenCalledWith("钉住会话失败", { variant: "error" })
  })

  it("activates a tab and switches session when user clicks another tab", async () => {
    const openTab = vi.fn()
    const activateTab = vi.fn()
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
      openTab,
      closeTab: vi.fn(),
      removeTab: vi.fn(),
      activateTab,
      reorderTabs: vi.fn(),
      replaceTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeTabsToRight: vi.fn(),
    })

    const user = userEvent.setup()
    render(<CompactHeader {...props()} />)

    await user.click(screen.getByTitle("会话 2"))

    expect(activateTab).toHaveBeenCalledWith("s2")
    expect(openTab).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(switchSession).toHaveBeenCalledWith("s2")
    })
  })

  it("rolls back active tab and shows toast when switching session fails", async () => {
    const openTab = vi.fn()
    const activateTab = vi.fn()
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
      openTab,
      closeTab: vi.fn(),
      removeTab: vi.fn(),
      activateTab,
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
    expect(openTab).not.toHaveBeenCalled()
    expect(activateTab).toHaveBeenCalledWith("s2")
    expect(activateTab).toHaveBeenCalledWith("s1")
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
    const removeTab = vi.fn((id: string) => {
      const openTabs = state.openTabs.filter((tab) => tab !== id)
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
      removeTab,
      activateTab: vi.fn(),
      reorderTabs: vi.fn(),
      replaceTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeTabsToRight: vi.fn(),
      pruneTabs: vi.fn(),
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
      expect(removeTab).toHaveBeenCalledWith("s1")
    })

    view.rerender(<CompactHeader {...props()} onNewSession={onNewSession} />)
    done()

    await waitFor(() => {
      expect(switchSession).toHaveBeenCalledWith("s2")
    })

    expect(onNewSession).not.toHaveBeenCalled()
  })

  it("分页未加载完整时，仍会恢复分页窗口外的 active tab，且不会过早 prune", async () => {
    const switchSession = vi.fn().mockResolvedValue(undefined)
    const pruneTabs = vi.fn()
    let isLoading = true
    let loaded = false

    mocks.useSession.mockImplementation(() => ({
      currentSession: null,
      setCurrentSession: vi.fn(),
      sessions: [{ id: "s-new", title: "会话 new" }],
      setSessions: vi.fn(),
      switchSession,
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      hasMore: true,
      isLoadingMore: false,
      loadMoreSessions: vi.fn(),
      isLoading,
      isSessionIdle: vi.fn(() => true),
      isSessionReasoning: vi.fn(() => false),
    }))

    mocks.useTabStore.mockImplementation(() => ({
      openTabs: loaded ? ["s-old"] : [],
      activeTab: loaded ? "s-old" : "",
      loaded,
      openTab: vi.fn(),
      closeTab: vi.fn(),
      removeTab: vi.fn(),
      activateTab: vi.fn(),
      reorderTabs: vi.fn(),
      replaceTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeTabsToRight: vi.fn(),
      pruneTabs,
    }))

    const view = render(<CompactHeader {...props()} />)

    isLoading = false
    loaded = true
    view.rerender(<CompactHeader {...props()} />)

    await waitFor(() => {
      expect(switchSession).toHaveBeenCalledWith("s-old")
    })
    expect(pruneTabs).not.toHaveBeenCalled()
  })
})
