import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"
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
  useUpdate: vi.fn(),
  useSessionDropdown: vi.fn(),
  useSessionActions: vi.fn(),
  useToast: vi.fn(),
  sdkShare: vi.fn(),
  sdkUnshare: vi.fn(),
  sdkSessionGet: vi.fn(),
  sdkSetPinned: vi.fn(),
  sdkPathGet: vi.fn(),
  flushScopedStateWrites: vi.fn(),
  ideBridgeRequest: vi.fn(),
  ideBridgeRestartMode: "window" as "window" | "ide" | null,
  ideBridgeInstalled: true,
  tabBarProps: null as null | {
    onClose: (id: string) => void
    onCloseOtherTabs: (id: string) => void
    onRename: (id: string, title: string) => void
    onDelete: (id: string) => void
    onToggleShare: (id: string) => void
  },
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

vi.mock("../../state/UpdateContext", () => ({
  useUpdate: (...args: unknown[]) => mocks.useUpdate(...args),
}))

vi.mock("../../state/scopedStorage", () => ({
  flushScopedStateWrites: (...args: unknown[]) => mocks.flushScopedStateWrites(...args),
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
  SessionDropdown: () => null,
}))

vi.mock("./TabBar", () => ({
  TabBar: (props: {
    onClose: (id: string) => void
    onCloseOtherTabs: (id: string) => void
    onRename: (id: string, title: string) => void
    onDelete: (id: string) => void
    onToggleShare: (id: string) => void
  }) => {
    mocks.tabBarProps = props
    return null
  },
}))

vi.mock("../../lib/api/sdkClient", () => ({
  setSessionPinned: (...args: unknown[]) => mocks.sdkSetPinned(...args),
  sdk: {
    path: {
      get: (...args: unknown[]) => mocks.sdkPathGet(...args),
    },
    session: {
      get: (...args: unknown[]) => mocks.sdkSessionGet(...args),
      share: (...args: unknown[]) => mocks.sdkShare(...args),
      unshare: (...args: unknown[]) => mocks.sdkUnshare(...args),
    },
  },
}))

vi.mock("../../lib/ideBridge", () => ({
  ideBridge: {
    request: (...args: unknown[]) => mocks.ideBridgeRequest(...args),
    isInstalled: () => mocks.ideBridgeInstalled,
    get restartMode() {
      return mocks.ideBridgeRestartMode
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
    Reflect.set(globalThis, "__APP_VERSION__", "test")
    mocks.tabBarProps = null
    mocks.sdkShare.mockResolvedValue({ data: null })
    mocks.sdkUnshare.mockResolvedValue({ data: null })
    mocks.sdkSessionGet.mockReset()
    mocks.sdkSessionGet.mockResolvedValue({ data: null, error: { status: 404 } })
    mocks.sdkSetPinned.mockResolvedValue({ data: null })
    mocks.sdkPathGet.mockResolvedValue({ data: { configFile: "/real/opencode.json" }, error: null })
    mocks.flushScopedStateWrites.mockClear()
    mocks.flushScopedStateWrites.mockResolvedValue(undefined)
    mocks.ideBridgeRequest.mockClear()
    mocks.ideBridgeRequest.mockResolvedValue({ ok: true })
    mocks.ideBridgeRestartMode = "window"

    mocks.useTheme.mockReturnValue({ theme: "light", toggleTheme: vi.fn() })

    mocks.useSession.mockReturnValue({
      currentSession: { id: "s1", title: "测试会话" },
      setCurrentSession: vi.fn(),
      sessions: [],
      setSessions: vi.fn(),
      switchSession: vi.fn(),
      regenerateSessionTitle: vi.fn(),
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
      activateTab: vi.fn(),
      reorderTabs: vi.fn(),
      replaceTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeTabsToRight: vi.fn(),
      pruneTabs: vi.fn(),
    })

    mocks.useUpdate.mockReturnValue({
      isChecking: false,
      checkForUpdates: vi.fn(),
      confirmOpen: false,
      confirmVersion: null,
      confirmInstall: vi.fn(),
      cancelInstallConfirm: vi.fn(),
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

  it("删除成功后立即关闭对应标签，删除失败时保留标签", async () => {
    const deleteSession = vi.fn().mockResolvedValue(true)
    const closeTab = vi.fn()
    mocks.useSession.mockReturnValue({
      currentSession: { id: "s1", title: "测试会话" },
      setCurrentSession: vi.fn(),
      sessions: [],
      setSessions: vi.fn(),
      switchSession: vi.fn(),
      regenerateSessionTitle: vi.fn(),
      updateSessionTitle: vi.fn(),
      deleteSession,
      isLoading: false,
    })
    mocks.useTabStore.mockReturnValue({
      openTabs: ["s1", "s2", "s3"],
      activeTab: "s1",
      loaded: true,
      openTab: vi.fn(),
      closeTab,
      removeTab: vi.fn(),
      activateTab: vi.fn(),
      reorderTabs: vi.fn(),
      replaceTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeTabsToRight: vi.fn(),
      pruneTabs: vi.fn(),
    })

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    const input = mocks.useSessionActions.mock.lastCall?.[0] as
      | { deleteSession: (sessionId: string) => Promise<boolean> }
      | undefined
    if (!input) throw new Error("session actions input not captured")

    await expect(input.deleteSession("s2")).resolves.toBe(true)
    expect(deleteSession).toHaveBeenCalledWith("s2")
    expect(closeTab).toHaveBeenCalledWith("s2")

    deleteSession.mockResolvedValue(false)
    await expect(input.deleteSession("s3")).resolves.toBe(false)
    expect(closeTab).not.toHaveBeenCalledWith("s3")
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

  it("将标签重命名回调接线到会话标题更新", () => {
    const updateSessionTitle = vi.fn().mockResolvedValue(true)
    mocks.useSession.mockReturnValue({
      currentSession: { id: "s1", title: "测试会话" },
      setCurrentSession: vi.fn(),
      sessions: [],
      setSessions: vi.fn(),
      switchSession: vi.fn(),
      updateSessionTitle,
      deleteSession: vi.fn(),
      isLoading: false,
    })

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    if (!mocks.tabBarProps) throw new Error("tab bar props not captured")
    mocks.tabBarProps.onRename("s2", "新标题")

    expect(updateSessionTitle).toHaveBeenCalledWith("s2", "新标题")
  })

  it("将标签删除回调接线到删除确认", () => {
    const setDeleteConfirm = vi.fn()
    mocks.useSessionActions.mockReturnValue({ ...createBaseActionsMock(), setDeleteConfirm })

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    if (!mocks.tabBarProps) throw new Error("tab bar props not captured")
    mocks.tabBarProps.onDelete("s2")

    expect(setDeleteConfirm).toHaveBeenCalledWith("s2")
  })

  it("将标签分享回调接线到会话分享", async () => {
    const setSessions = vi.fn()
    const setCurrentSession = vi.fn()
    const { writeText } = mockClipboard()
    mocks.sdkShare.mockResolvedValue({
      data: { id: "s2", title: "会话 2", share: { url: "https://example.com/share" } },
    })
    mocks.useSession.mockReturnValue({
      currentSession: { id: "s1", title: "测试会话" },
      setCurrentSession,
      sessions: [{ id: "s2", title: "会话 2" }],
      setSessions,
      switchSession: vi.fn(),
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      isLoading: false,
    })

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    if (!mocks.tabBarProps) throw new Error("tab bar props not captured")
    act(() => {
      mocks.tabBarProps?.onToggleShare("s2")
    })

    await waitFor(() => {
      expect(mocks.sdkShare).toHaveBeenCalledWith({ path: { id: "s2" } })
      expect(writeText).toHaveBeenCalledWith("https://example.com/share")
    })
    expect(setSessions).toHaveBeenCalledWith([{ id: "s2", title: "会话 2", share: { url: "https://example.com/share" } }])
  })

  it("优先显示 IDE 扩展版本号", async () => {
    const user = userEvent.setup()
    mocks.ideBridgeRequest.mockImplementation(async (type: string) => {
      if (type === "getExtensionVersion") {
        return { result: { version: "26.4.1503" } }
      }
      return { ok: true }
    })

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await user.click(screen.getByTitle("更多选项"))

    await waitFor(() => {
      expect(screen.getByText("v26.4.1503")).toBeInTheDocument()
    })
  })

  it("拿不到 IDE 扩展版本时回退显示 WebGUI 版本号", async () => {
    const user = userEvent.setup()
    mocks.ideBridgeRequest.mockImplementation(async (type: string) => {
      if (type === "getExtensionVersion") {
        throw new Error("bridge unavailable")
      }
      return { ok: true }
    })

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await user.click(screen.getByTitle("更多选项"))

    await waitFor(() => {
      expect(screen.getByText("vtest")).toBeInTheDocument()
    })
  })

  it("removes open tabs when backing session is deleted", async () => {
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
      activateTab: vi.fn(),
      reorderTabs: vi.fn(),
      replaceTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeTabsToRight: vi.fn(),
      pruneTabs: vi.fn(),
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

    // Simulate loading complete — cleanup should now run and remove missing sessions
    isLoading = false
    view.rerender(<CompactHeader {...props} />)

    await waitFor(() => {
      expect(removeTab).toHaveBeenCalledWith("s2")
      expect(removeTab).toHaveBeenCalledWith("virtual-1")
    })

    removeTab.mockClear()
    sessions.push({ id: "s2", title: "会话 2" })
    view.rerender(<CompactHeader {...props} />)

    // sessions reference is unchanged (mutation), so useEffect deps don't trigger
    expect(removeTab).not.toHaveBeenCalled()
  })

  it("cleans orphan tabs when openTabs changes even if sessions reference is unchanged", async () => {
    const removeTab = vi.fn()
    const sessions = [{ id: "s1", title: "测试会话" }]
    let isLoading = true
    const state = { openTabs: ["s1"] }

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
      activateTab: vi.fn(),
      reorderTabs: vi.fn(),
      replaceTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeTabsToRight: vi.fn(),
      pruneTabs: vi.fn(),
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
    await waitFor(() => expect(removeTab).toHaveBeenCalledWith("s2"))
  })

  it("缺失会话清理会保留 currentSession", async () => {
    const removeTab = vi.fn()
    let isLoading = true

    mocks.useSession.mockImplementation(() => ({
      currentSession: { id: "s-current", title: "当前会话" },
      setCurrentSession: vi.fn(),
      sessions: [{ id: "s1", title: "会话 1" }],
      setSessions: vi.fn(),
      switchSession: vi.fn(),
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      isLoading,
    }))
    mocks.useTabStore.mockReturnValue({
      openTabs: ["s-current", "s1", "orphan"],
      activeTab: "s-current",
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
    })

    const props = {
      connectionState: "connected" as ConnectionState,
      onNewSession: vi.fn(),
      isCreatingSession: false,
      onOpenCommandPalette: vi.fn(),
    }
    const view = render(<CompactHeader {...props} />)
    isLoading = false
    view.rerender(<CompactHeader {...props} />)

    await waitFor(() => expect(removeTab).toHaveBeenCalledWith("orphan"))
    expect(mocks.sdkSessionGet).toHaveBeenCalledOnce()
    expect(mocks.sdkSessionGet).toHaveBeenCalledWith({ path: { id: "orphan" } })
  })

  it("后台 New session 存在时保留列表外有效或暂时无法确认的普通标签", async () => {
    const removeTab = vi.fn()
    let isLoading = true
    mocks.sdkSessionGet
      .mockResolvedValueOnce({ data: { id: "s-old-1" }, error: null })
      .mockRejectedValueOnce(new Error("offline"))

    mocks.useSession.mockImplementation(() => ({
      currentSession: { id: "s-current", title: "当前会话" },
      setCurrentSession: vi.fn(),
      sessions: [
        { id: "s-draft", title: "New session" },
        { id: "s-current", title: "当前会话" },
      ],
      setSessions: vi.fn(),
      switchSession: vi.fn(),
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      isLoading,
    }))
    mocks.useTabStore.mockReturnValue({
      openTabs: ["s-old-1", "s-draft", "s-current", "s-old-2"],
      activeTab: "s-current",
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
    })

    const props = {
      connectionState: "connected" as ConnectionState,
      onNewSession: vi.fn(),
      isCreatingSession: false,
      onOpenCommandPalette: vi.fn(),
    }
    const view = render(<CompactHeader {...props} />)
    isLoading = false
    view.rerender(<CompactHeader {...props} />)

    await waitFor(() => expect(mocks.sdkSessionGet).toHaveBeenCalledTimes(2))
    await act(async () => {})
    expect(removeTab).not.toHaveBeenCalled()
  })

  it("缺失会话查询期间新打开的标签不会被旧结果修剪", async () => {
    let isLoading = true
    let resolveGet!: (value: { data: null; error: { status: number } }) => void
    const request = new Promise<{ data: null; error: { status: number } }>((resolve) => {
      resolveGet = resolve
    })
    const state = { openTabs: ["s-current", "s-missing"], activeTab: "s-current" }
    const pruneTabs = vi.fn((validIds: Set<string>) => {
      state.openTabs = state.openTabs.filter((id) => validIds.has(id))
    })
    const removeTab = vi.fn((id: string) => {
      state.openTabs = state.openTabs.filter((tab) => tab !== id)
    })
    mocks.sdkSessionGet.mockReturnValue(request)
    mocks.useSession.mockImplementation(() => ({
      currentSession: { id: "s-current", title: "当前会话" },
      setCurrentSession: vi.fn(),
      sessions: [{ id: "s-current", title: "当前会话" }],
      setSessions: vi.fn(),
      switchSession: vi.fn(),
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      isLoading,
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
      pruneTabs,
    }))

    const props = {
      connectionState: "connected" as ConnectionState,
      onNewSession: vi.fn(),
      isCreatingSession: false,
      onOpenCommandPalette: vi.fn(),
    }
    const view = render(<CompactHeader {...props} />)
    isLoading = false
    view.rerender(<CompactHeader {...props} />)
    await waitFor(() => expect(mocks.sdkSessionGet).toHaveBeenCalledWith({ path: { id: "s-missing" } }))

    state.openTabs.push("s-new")
    resolveGet({ data: null, error: { status: 404 } })

    await waitFor(() => expect(removeTab).toHaveBeenCalledWith("s-missing"))
    expect(pruneTabs).not.toHaveBeenCalled()
    expect(state.openTabs).toEqual(["s-current", "s-new"])
  })

  it("switches to restored activeTab when currentSession is null", async () => {
    const switchSession = vi.fn().mockResolvedValue(undefined)
    const openTab = vi.fn()

    mocks.useSession.mockReturnValue({
      currentSession: null,
      setCurrentSession: vi.fn(),
      sessions: [],
      setSessions: vi.fn(),
      switchSession,
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      isLoading: false,
    })

    mocks.useTabStore.mockReturnValue({
      openTabs: ["s1", "s2"],
      activeTab: "s2",
      loaded: true,
      openTab,
      closeTab: vi.fn(),
      removeTab: vi.fn(),
      activateTab: vi.fn(),
      reorderTabs: vi.fn(),
      replaceTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeTabsToRight: vi.fn(),
      pruneTabs: vi.fn(),
    })

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(switchSession).toHaveBeenCalledWith("s2")
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(openTab).not.toHaveBeenCalled()
  })

  it("批量删除期间不恢复待删除标签，结束后只恢复最终标签", async () => {
    const switchSession = vi.fn().mockResolvedValue(undefined)
    let isDeleting = true
    const state = {
      sessions: [
        { id: "s2", title: "会话 2" },
        { id: "s3", title: "会话 3" },
      ],
      openTabs: ["s2", "s3"],
      activeTab: "s2",
    }
    mocks.useSession.mockImplementation(() => ({
      currentSession: null,
      setCurrentSession: vi.fn(),
      sessions: state.sessions,
      setSessions: vi.fn(),
      switchSession,
      regenerateSessionTitle: vi.fn(),
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      isLoading: false,
    }))
    mocks.useTabStore.mockImplementation(() => ({
      openTabs: state.openTabs,
      activeTab: state.activeTab,
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
    }))
    mocks.useSessionActions.mockImplementation(() => ({ ...createBaseActionsMock(), isDeleting }))

    const props = {
      connectionState: "connected" as ConnectionState,
      onNewSession: vi.fn(),
      isCreatingSession: false,
      onOpenCommandPalette: vi.fn(),
    }
    const view = render(<CompactHeader {...props} />)

    expect(switchSession).not.toHaveBeenCalled()

    state.sessions = [{ id: "s3", title: "会话 3" }]
    state.openTabs = ["s3"]
    state.activeTab = "s3"
    isDeleting = false
    view.rerender(<CompactHeader {...props} />)

    await waitFor(() => {
      expect(switchSession).toHaveBeenCalledWith("s3")
    })
    expect(switchSession).not.toHaveBeenCalledWith("s2")
  })

  it("does not reopen current session tab when already open", () => {
    const openTab = vi.fn()

    mocks.useSession.mockReturnValue({
      currentSession: { id: "s1", title: "会话 1" },
      setCurrentSession: vi.fn(),
      sessions: [],
      setSessions: vi.fn(),
      switchSession: vi.fn().mockResolvedValue(undefined),
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      isLoading: false,
    })

    mocks.useTabStore.mockReturnValue({
      openTabs: ["s1", "s2"],
      activeTab: "s1",
      loaded: true,
      openTab,
      closeTab: vi.fn(),
      removeTab: vi.fn(),
      activateTab: vi.fn(),
      reorderTabs: vi.fn(),
      replaceTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeTabsToRight: vi.fn(),
      pruneTabs: vi.fn(),
    })

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    expect(openTab).not.toHaveBeenCalledWith("s1")
  })

  it("删除当前唯一草稿标签后不会触发切换失败 toast", async () => {
    const switchSession = vi.fn().mockRejectedValue(new Error("not found"))
    const showToast = vi.fn()
    const onNewSession = vi.fn()
    let isLoading = true
    const state = {
      currentSession: { id: "s-draft", title: "草稿会话" } as { id: string; title: string } | null,
      sessions: [{ id: "s-draft", title: "草稿会话" }],
      openTabs: ["s-draft"],
      activeTab: "s-draft",
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
    mocks.useToast.mockReturnValue({ showToast })

    const view = render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={onNewSession}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    state.currentSession = null
    state.sessions = []
    isLoading = false
    view.rerender(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={onNewSession}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(removeTab).toHaveBeenCalledWith("s-draft")
    })

    view.rerender(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={onNewSession}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(onNewSession).toHaveBeenCalled()
    })
    expect(switchSession).not.toHaveBeenCalled()
    expect(showToast).not.toHaveBeenCalledWith("切换会话失败", { variant: "error" })
  })

  it("falls back to onNewSession when restored activeTab switch fails", async () => {
    const switchSession = vi.fn().mockRejectedValue(new Error("not found"))
    const onNewSession = vi.fn()

    mocks.useSession.mockReturnValue({
      currentSession: { id: "virtual-123", title: "" },
      setCurrentSession: vi.fn(),
      sessions: [],
      setSessions: vi.fn(),
      switchSession,
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      isLoading: false,
    })

    mocks.useTabStore.mockReturnValue({
      openTabs: ["deleted-session"],
      activeTab: "deleted-session",
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

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={onNewSession}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(onNewSession).toHaveBeenCalled()
    })
  })

  it("close other tabs 切换失败时显示错误 toast 而不是抛错", async () => {
    const switchSession = vi.fn().mockRejectedValue(new Error("boom"))
    const showToast = vi.fn()

    mocks.useSession.mockReturnValue({
      currentSession: { id: "s1", title: "测试会话" },
      setCurrentSession: vi.fn(),
      sessions: [],
      setSessions: vi.fn(),
      switchSession,
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      isLoading: false,
    })
    mocks.useToast.mockReturnValue({ showToast })

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    if (!mocks.tabBarProps) throw new Error("tab bar props not captured")
    mocks.tabBarProps.onCloseOtherTabs("s1")
    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith("切换会话失败", { variant: "error" })
    })
  })

  it("activeTab 为空时会触发 onNewSession", async () => {
    const switchSession = vi.fn().mockResolvedValue(undefined)
    const onNewSession = vi.fn()

    mocks.useSession.mockReturnValue({
      currentSession: null,
      setCurrentSession: vi.fn(),
      sessions: [],
      setSessions: vi.fn(),
      switchSession,
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      isLoading: false,
    })
    mocks.useTabStore.mockReturnValue({
      openTabs: [],
      activeTab: "",
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

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={onNewSession}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(onNewSession).toHaveBeenCalled()
    })
    expect(switchSession).not.toHaveBeenCalled()
  })

  it("activeTab 为空但 openTabs 非空时恢复最后一个标签而不是创建新会话", async () => {
    const switchSession = vi.fn().mockResolvedValue(undefined)
    const activateTab = vi.fn()
    const onNewSession = vi.fn()

    mocks.useSession.mockReturnValue({
      currentSession: null,
      setCurrentSession: vi.fn(),
      sessions: [
        { id: "s1", title: "会话 1" },
        { id: "s2", title: "会话 2" },
      ],
      setSessions: vi.fn(),
      switchSession,
      regenerateSessionTitle: vi.fn(),
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      hasMore: false,
      isLoading: false,
      isLoadingMore: false,
      loadMoreSessions: vi.fn(),
    })
    mocks.useTabStore.mockReturnValue({
      openTabs: ["s1", "s2"],
      activeTab: "",
      loaded: true,
      openTab: vi.fn(),
      closeTab: vi.fn(),
      removeTab: vi.fn(),
      activateTab,
      reorderTabs: vi.fn(),
      replaceTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeTabsToRight: vi.fn(),
      pruneTabs: vi.fn(),
    })

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={onNewSession}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(switchSession).toHaveBeenCalledWith("s2")
    })
    await waitFor(() => {
      expect(activateTab).toHaveBeenCalledWith("s2")
    })
    expect(onNewSession).not.toHaveBeenCalled()
  })

  it("close other tabs 会尝试切换到保留会话", async () => {
    const switchSession = vi.fn().mockResolvedValue(undefined)
    const showToast = vi.fn()

    mocks.useSession.mockReturnValue({
      currentSession: { id: "s1", title: "会话 1" },
      setCurrentSession: vi.fn(),
      sessions: [],
      setSessions: vi.fn(),
      switchSession,
      regenerateSessionTitle: vi.fn(),
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      isLoading: false,
    })
    mocks.useTabStore.mockReturnValue({
      openTabs: ["s1", "s2"],
      activeTab: "s2",
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
    mocks.useToast.mockReturnValue({ showToast })

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(switchSession).toHaveBeenCalledWith("s2")
    })
    if (!mocks.tabBarProps) throw new Error("tab bar props not captured")
    const tabs = mocks.tabBarProps
    await tabs.onCloseOtherTabs("s1")
    await waitFor(() => {
      expect(switchSession).toHaveBeenLastCalledWith("s1")
    })
    await act(async () => {
      await Promise.resolve()
    })
    expect(showToast).not.toHaveBeenCalled()
  })

  it("关闭唯一标签后不会把刚关闭的会话重新打开", async () => {
    const switchSession = vi.fn().mockResolvedValue(undefined)
    const onNewSession = vi.fn()
    const session = {
      current: { id: "s1", title: "会话 1" } as { id: string; title: string } | null,
    }
    const setCurrentSession = vi.fn((next: { id: string; title: string } | null) => {
      session.current = next
    })
    const state = {
      openTabs: ["s1"],
      activeTab: "s1",
    }
    const openTab = vi.fn((id: string) => {
      if (state.openTabs.includes(id)) {
        state.activeTab = id
        return
      }
      state.openTabs = [...state.openTabs, id]
      state.activeTab = id
    })
    const closeTab = vi.fn((id: string) => {
      const index = state.openTabs.indexOf(id)
      if (index < 0) return
      const openTabs = state.openTabs.filter((v) => v !== id)
      state.openTabs = openTabs
      state.activeTab = openTabs[Math.min(index, Math.max(openTabs.length - 1, 0))] || ""
    })

    mocks.useSession.mockImplementation(() => ({
      currentSession: session.current,
      setCurrentSession,
      sessions: [{ id: "s1", title: "会话 1" }],
      setSessions: vi.fn(),
      switchSession,
      regenerateSessionTitle: vi.fn(),
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      isLoading: false,
    }))
    mocks.useTabStore.mockImplementation(() => ({
      openTabs: state.openTabs,
      activeTab: state.activeTab,
      loaded: true,
      openTab,
      closeTab,
      removeTab: vi.fn(),
      activateTab: vi.fn(),
      reorderTabs: vi.fn(),
      replaceTab: vi.fn(),
      closeOtherTabs: vi.fn(),
      closeTabsToRight: vi.fn(),
      pruneTabs: vi.fn(),
    }))

    const view = render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={onNewSession}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    if (!mocks.tabBarProps) throw new Error("tab bar props not captured")
    mocks.tabBarProps.onClose("s1")

    view.rerender(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={onNewSession}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(onNewSession).toHaveBeenCalled()
    })
    expect(setCurrentSession).toHaveBeenCalledWith(null)
    expect(closeTab).toHaveBeenCalledWith("s1")
    expect(openTab).not.toHaveBeenCalledWith("s1")
    expect(switchSession).not.toHaveBeenCalled()
  })

  it("恢复切换进行中时 activeTab 改变，完成后会继续切换到最新 activeTab", async () => {
    let resolveFirst = () => {}
    const switchSession = vi.fn((id: string) => {
      if (id === "s1") {
        return new Promise<void>((resolve) => {
          resolveFirst = resolve
        })
      }
      return Promise.resolve()
    })
    const state = {
      openTabs: ["s1", "s2"],
      activeTab: "s1",
    }

    mocks.useSession.mockReturnValue({
      currentSession: null,
      setCurrentSession: vi.fn(),
      sessions: [
        { id: "s1", title: "会话 1" },
        { id: "s2", title: "会话 2" },
      ],
      setSessions: vi.fn(),
      switchSession,
      regenerateSessionTitle: vi.fn(),
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      isLoading: false,
    })
    mocks.useTabStore.mockImplementation(() => ({
      openTabs: state.openTabs,
      activeTab: state.activeTab,
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
    }))

    const view = render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(switchSession).toHaveBeenCalledWith("s1")
    })

    state.openTabs = ["s2"]
    state.activeTab = "s2"
    view.rerender(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    resolveFirst()

    await waitFor(() => {
      expect(switchSession).toHaveBeenCalledWith("s2")
    })
  })

  it("旧恢复切换失败时 activeTab 已改变不会创建新会话", async () => {
    let rejectFirst = () => {}
    const switchSession = vi.fn((id: string) => {
      if (id === "s1") {
        return new Promise<void>((_, reject) => {
          rejectFirst = () => reject(new Error("boom"))
        })
      }
      return Promise.resolve()
    })
    const onNewSession = vi.fn()
    const state = {
      openTabs: ["s1", "s2"],
      activeTab: "s1",
    }

    mocks.useSession.mockReturnValue({
      currentSession: null,
      setCurrentSession: vi.fn(),
      sessions: [
        { id: "s1", title: "会话 1" },
        { id: "s2", title: "会话 2" },
      ],
      setSessions: vi.fn(),
      switchSession,
      regenerateSessionTitle: vi.fn(),
      updateSessionTitle: vi.fn(),
      deleteSession: vi.fn(),
      isLoading: false,
    })
    mocks.useTabStore.mockImplementation(() => ({
      openTabs: state.openTabs,
      activeTab: state.activeTab,
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
    }))

    const view = render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={onNewSession}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(switchSession).toHaveBeenCalledWith("s1")
    })

    state.activeTab = "s2"
    view.rerender(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={onNewSession}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    rejectFirst()

    await waitFor(() => {
      expect(switchSession).toHaveBeenCalledWith("s2")
    })
    expect(onNewSession).not.toHaveBeenCalled()
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

  it("点击配置文件后调用 ideBridge ensureAndOpenFile", async () => {
    const user = userEvent.setup()
    mocks.ideBridgeRequest.mockResolvedValue({ ok: true })

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await user.click(screen.getByTitle("更多选项"))
    await user.click(screen.getByText("配置文件"))

    expect(mocks.ideBridgeRequest).toHaveBeenCalledWith("ensureAndOpenFile", {
      path: "/real/opencode.json",
    })
  })

  it("浏览器模式下更多菜单不显示配置文件按钮", async () => {
    const user = userEvent.setup()
    mocks.ideBridgeInstalled = false

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await user.click(screen.getByTitle("更多选项"))
    expect(screen.getByText("设置")).toBeInTheDocument()
    expect(screen.queryByText("配置文件")).not.toBeInTheDocument()

    mocks.ideBridgeInstalled = true
  })

  it("点击重启插件后弹出确认框并调用 restartHost", async () => {
    const user = userEvent.setup()
    mocks.ideBridgeRestartMode = "window"
    mocks.ideBridgeRequest.mockResolvedValue({ ok: true })

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await user.click(screen.getByTitle("更多选项"))
    await user.click(screen.getByText("重启插件"))

    expect(screen.getByText("确认重启插件")).toBeInTheDocument()
    expect(screen.getByText("将重载窗口并重启插件，是否继续？")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "重启" }))

    await waitFor(() => {
      expect(mocks.ideBridgeRequest).toHaveBeenCalledWith("restartHost")
    })
  })

  it("重启前等待 scoped storage 写入完成", async () => {
    const user = userEvent.setup()
    let release = () => {}
    mocks.ideBridgeRestartMode = "window"
    mocks.flushScopedStateWrites.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    mocks.ideBridgeRequest.mockResolvedValue({ ok: true })

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )
    await user.click(screen.getByTitle("更多选项"))
    await user.click(screen.getByText("重启插件"))
    await user.click(screen.getByRole("button", { name: "重启" }))

    expect(mocks.flushScopedStateWrites).toHaveBeenCalledOnce()
    expect(mocks.ideBridgeRequest).not.toHaveBeenCalledWith("restartHost")
    release()
    await waitFor(() => expect(mocks.ideBridgeRequest).toHaveBeenCalledWith("restartHost"))
  })

  it("scoped storage 写入失败时不重启并显示错误 toast", async () => {
    const user = userEvent.setup()
    const showToast = vi.fn()
    mocks.useToast.mockReturnValue({ showToast })
    mocks.flushScopedStateWrites.mockRejectedValue(new Error("flush failed"))

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )
    await user.click(screen.getByTitle("更多选项"))
    await user.click(screen.getByText("重启插件"))
    await user.click(screen.getByRole("button", { name: "重启" }))

    await waitFor(() => {
      expect(mocks.ideBridgeRequest).not.toHaveBeenCalledWith("restartHost")
      expect(showToast).toHaveBeenCalledWith("重启失败，请稍后重试", { variant: "error" })
      expect(screen.queryByText("确认重启插件")).not.toBeInTheDocument()
    })
  })

  it("JetBrains 模式下显示重启 IDE 文案", async () => {
    const user = userEvent.setup()
    mocks.ideBridgeRestartMode = "ide"

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await user.click(screen.getByTitle("更多选项"))
    await user.click(screen.getByText("重启插件"))

    expect(screen.getByText("将重启 IDE 以重新加载插件，是否继续？")).toBeInTheDocument()
  })

  it("restartHost 失败时显示错误 toast", async () => {
    const user = userEvent.setup()
    const showToast = vi.fn()
    mocks.useToast.mockReturnValue({ showToast })
    mocks.ideBridgeRestartMode = "window"
    mocks.ideBridgeRequest.mockImplementation(async (type: string) => {
      if (type === "restartHost") throw new Error("fail")
      return { ok: true }
    })

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await user.click(screen.getByTitle("更多选项"))
    await user.click(screen.getByText("重启插件"))
    await user.click(screen.getByRole("button", { name: "重启" }))

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith("重启失败，请稍后重试", { variant: "error" })
    })
  })

  it("restartHost 返回 ok=false 时显示错误 toast", async () => {
    const user = userEvent.setup()
    const showToast = vi.fn()
    mocks.useToast.mockReturnValue({ showToast })
    mocks.ideBridgeRestartMode = "window"
    mocks.ideBridgeRequest.mockImplementation(async (type: string) => {
      if (type === "restartHost") return { ok: false, error: "restartHost not supported" }
      return { ok: true }
    })

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await user.click(screen.getByTitle("更多选项"))
    await user.click(screen.getByText("重启插件"))
    await user.click(screen.getByRole("button", { name: "重启" }))

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith("重启失败，请稍后重试", { variant: "error" })
    })
  })

  it("ideBridge reject 时显示错误 toast", async () => {
    const user = userEvent.setup()
    const showToast = vi.fn()
    mocks.useToast.mockReturnValue({ showToast })
    mocks.ideBridgeRequest.mockRejectedValue(new Error("fail"))

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await user.click(screen.getByTitle("更多选项"))
    await user.click(screen.getByText("配置文件"))

    await waitFor(() => {
      expect(showToast).toHaveBeenCalledWith("打开配置文件失败", { variant: "error" })
    })
  })

  it("点击状态点会打开并关闭状态弹层", async () => {
    const user = userEvent.setup()

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await user.click(screen.getByTitle("状态点"))
    expect(screen.getByText("状态弹层")).toBeInTheDocument()
    expect(screen.getByTitle("状态点")).toHaveAttribute("aria-expanded", "true")

    await user.click(screen.getByRole("button", { name: "关闭状态弹层" }))
    expect(screen.queryByText("状态弹层")).not.toBeInTheDocument()
    expect(screen.getByTitle("状态点")).toHaveAttribute("aria-expanded", "false")
  })

  it("状态弹层与更多菜单互斥", async () => {
    const user = userEvent.setup()

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await user.click(screen.getByTitle("更多选项"))
    expect(screen.getByText("配置文件")).toBeInTheDocument()

    await user.click(screen.getByTitle("状态点"))
    expect(screen.getByText("状态弹层")).toBeInTheDocument()
    expect(screen.queryByText("配置文件")).not.toBeInTheDocument()
  })

  it("点击历史会话会关闭状态弹层", async () => {
    const user = userEvent.setup()
    const dropdown = createBaseDropdownMock()
    mocks.useSessionDropdown.mockReturnValue(dropdown)

    render(
      <CompactHeader
        connectionState={"connected" as ConnectionState}
        onNewSession={vi.fn()}
        isCreatingSession={false}
        onOpenCommandPalette={vi.fn()}
      />,
    )

    await user.click(screen.getByTitle("状态点"))
    expect(screen.getByText("状态弹层")).toBeInTheDocument()

    await user.click(screen.getByTitle("历史会话"))
    expect(dropdown.toggleDropdown).toHaveBeenCalledOnce()
    expect(screen.queryByText("状态弹层")).not.toBeInTheDocument()
  })
})
