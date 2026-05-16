import { createRef } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, waitFor } from "@testing-library/react"
import { prepareSession } from "../../App"
import { quick_phrase_updated_event } from "../../state/repo/quickPhraseEvent"

let lastConfirmModalProps: any
let confirmModalMap: Record<string, any> = {}
let lastEditorToolbarProps: any
let lastEditorContentProps: any
let lastQuickPhraseBarProps: any
let rootText = ""
let sessionIdle = true
let selectionSessionId: string | null = null
let currentSessionId: string | null = null
const mocks = vi.hoisted(() => {
  return {
    insertPlainWithMentionsImpl: vi.fn(),
    getMessagesBySession: vi.fn((): any[] => []),
    isSessionLoaded: vi.fn(() => true),
    loadDrafts: vi.fn(async () => ({})),
    loadDraftSession: vi.fn(async (): Promise<string | null> => null),
    saveDrafts: vi.fn(async (_value: Record<string, string>) => ({ ok: true })),
    saveDraftSession: vi.fn(async (_value: string | null) => ({ ok: true })),
    handleSubmit: vi.fn(),
    submitQuickPhrase: vi.fn(),
    handleRetry: vi.fn(),
    handleAbort: vi.fn(),
    handleCompact: vi.fn((done: () => void) => done()),
    loadQuickPhraseState: vi.fn(async () => ({
      mode: "fill_input",
      preset_version: 1,
      order: ["preset:commit"],
      items: {
        "preset:commit": {
          id: "preset:commit",
          title: "提交总结",
          body: "请总结改动",
          source: "preset",
          hidden: false,
          order: 0,
          updated_at: 1,
        },
      },
    })),
  }
})

vi.mock("../ConfirmModal", () => {
  return {
    ConfirmModal: (props: any) => {
      lastConfirmModalProps = props
      if (props?.title) confirmModalMap[props.title] = props
      return null
    },
  }
})

vi.mock("@lexical/react/LexicalComposer", () => {
  return {
    LexicalComposer: ({ children }: any) => <div>{children}</div>,
  }
})

vi.mock("@lexical/react/LexicalComposerContext", () => {
  return {
    useLexicalComposerContext: () => [
      {
        focus: vi.fn(),
        update: vi.fn((fn: any) => fn()),
        setEditable: vi.fn(),
      },
    ],
  }
})

vi.mock("lexical", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lexical")>()
  return {
    ...actual,
    $getRoot: () => ({
      getTextContent: () => rootText,
    }),
    $getSelection: () => null,
    $isRangeSelection: () => false,
  }
})

vi.mock("./EditorConfig", () => {
  return {
    createEditorConfig: () => ({}),
  }
})

vi.mock("./EditorContent", () => {
  return {
    EditorContent: (props: any) => {
      lastEditorContentProps = props
      return null
    },
  }
})

vi.mock("./EditorToolbar", () => {
  return {
    EditorToolbar: (props: any) => {
      lastEditorToolbarProps = props
      return null
    },
  }
})

vi.mock("./FooterPanels", () => {
  return {
    FooterPanels: () => null,
  }
})

vi.mock("./QuickPhraseBar", () => {
  return {
    QuickPhraseBar: (props: any) => {
      lastQuickPhraseBarProps = props
      return null
    },
  }
})

vi.mock("./hooks/useMessageParts", () => {
  return {
    useMessageParts: () => ({ extractMessageParts: vi.fn() }),
  }
})

vi.mock("./hooks/useMessageInput", () => {
  return {
    useMessageInput: () => ({
      lastFailedMessage: null,
      handleSubmit: mocks.handleSubmit,
      submitQuickPhrase: mocks.submitQuickPhrase,
      handleRetry: mocks.handleRetry,
      handleAbort: mocks.handleAbort,
      handleCompact: mocks.handleCompact,
    }),
  }
})

vi.mock("./hooks/useFileAttachment", () => {
  return {
    useFileAttachment: () => ({
      fileInputRef: { current: null },
      handleFileSelect: vi.fn(),
      handleFileChange: vi.fn(),
    }),
  }
})

vi.mock("./hooks/useDragDrop", () => {
  return {
    useDragDrop: () => {},
  }
})

vi.mock("./hooks/useEditorKeyboard", () => {
  return {
    useEditorKeyboard: () => {},
  }
})

vi.mock("./utils", () => {
  return {
    insertPlainWithMentionsImpl: mocks.insertPlainWithMentionsImpl,
  }
})

vi.mock("../../state/repo/draftRepo", () => {
  return {
    loadDrafts: () => mocks.loadDrafts(),
    loadDraftSession: () => mocks.loadDraftSession(),
    saveDrafts: (value: Record<string, string>) => mocks.saveDrafts(value),
    saveDraftSession: (value: string | null) => mocks.saveDraftSession(value),
  }
})

vi.mock("../../state/repo/quickPhraseRepo", () => {
  return {
    loadQuickPhraseState: () => mocks.loadQuickPhraseState(),
  }
})

vi.mock("../../state/SessionContext", () => {
  return {
    useSession: () => ({
      isIdle: sessionIdle,
      currentSession: currentSessionId ? { id: currentSessionId } : null,
      selectedProviderId: "openai",
      selectedModelId: "gpt-4.1",
      selectedAgent: "build",
      setSelectedModel: vi.fn(),
      setSelectedAgent: vi.fn(),
      selectedVariant: undefined,
      setSelectedVariant: vi.fn(),
      selectionSessionId,
    }),
  }
})

vi.mock("../../state/ProjectContext", () => {
  return {
    useProject: () => ({ worktree: undefined }),
  }
})

vi.mock("../../state/MessagesContext", () => {
  return {
    useMessages: () => ({
      getMessagesBySession: mocks.getMessagesBySession,
      isSessionLoaded: mocks.isSessionLoaded,
    }),
  }
})

vi.mock("../../state/ProvidersContext", () => {
  return {
    useProviders: () => ({ providersDirty: false, clearProvidersDirty: vi.fn() }),
  }
})

vi.mock("../../lib/api/sdkClient", () => {
  return {
    sdk: {
      config: {
        providers: vi.fn().mockResolvedValue({ data: null, error: null }),
      },
    },
  }
})

import { MessageInput } from "./index"

const quick = {
  mode: "fill_input",
  preset_version: 1,
  order: ["preset:commit"],
  items: {
    "preset:commit": {
      id: "preset:commit",
      title: "提交总结",
      body: "请总结改动",
      source: "preset",
      hidden: false,
      order: 0,
      updated_at: 1,
    },
  },
}

describe("MessageInput compact confirm", () => {
  beforeEach(() => {
    sessionIdle = true
    selectionSessionId = null
    currentSessionId = null
    lastEditorToolbarProps = null
    lastEditorContentProps = null
    lastQuickPhraseBarProps = null
    confirmModalMap = {}
    rootText = ""
    vi.clearAllMocks()
    mocks.getMessagesBySession.mockReturnValue([])
    mocks.isSessionLoaded.mockReturnValue(true)
    mocks.loadDrafts.mockImplementation(async () => new Promise(() => {}))
    mocks.loadDraftSession.mockResolvedValue(null)
    mocks.saveDrafts.mockResolvedValue({ ok: true })
    mocks.saveDraftSession.mockResolvedValue({ ok: true })
    mocks.handleSubmit.mockReset()
    mocks.submitQuickPhrase.mockReset()
    mocks.handleRetry.mockReset()
    mocks.handleAbort.mockReset()
    mocks.handleCompact.mockReset()
    mocks.handleCompact.mockImplementation((done: () => void) => done())
    mocks.loadQuickPhraseState.mockImplementation(async () => new Promise(() => {}))
  })

  it("会在输入框上方渲染快捷短语栏", async () => {
    mocks.loadQuickPhraseState.mockResolvedValue(quick)
    render(<MessageInput sessionID="s1" />)

    await waitFor(() => {
      expect(lastQuickPhraseBarProps).toBeTruthy()
    })
    expect(lastQuickPhraseBarProps.items).toEqual([
      {
        id: "preset:commit",
        title: "提交总结",
        body: "请总结改动",
      },
    ])
  })

  it("fill_input 模式双击仅回填不发送", async () => {
    mocks.loadQuickPhraseState.mockResolvedValue(quick)
    render(<MessageInput sessionID="s1" />)

    await waitFor(() => {
      expect(lastQuickPhraseBarProps).toBeTruthy()
    })

    act(() => {
      lastQuickPhraseBarProps.onActivate({
        id: "preset:commit",
        title: "提交总结",
        body: "请总结改动",
      })
    })

    expect(mocks.insertPlainWithMentionsImpl).toHaveBeenCalledWith(expect.anything(), expect.anything(), "请总结改动", {
      replace: true,
    })
    expect(mocks.handleSubmit).not.toHaveBeenCalled()
  })

  it("double_send 模式双击会直接发送", async () => {
    const onSendIntent = vi.fn()
    mocks.loadQuickPhraseState.mockResolvedValue({
      mode: "double_send",
      preset_version: 1,
      order: ["preset:commit"],
      items: {
        "preset:commit": {
          id: "preset:commit",
          title: "提交总结",
          body: "请总结改动",
          source: "preset",
          hidden: false,
          order: 0,
          updated_at: 1,
        },
      },
    })

    render(<MessageInput sessionID="s1" onSendIntent={onSendIntent} />)
    await waitFor(() => {
      expect(lastQuickPhraseBarProps).toBeTruthy()
    })

    act(() => {
      lastQuickPhraseBarProps.onActivate({
        id: "preset:commit",
        title: "提交总结",
        body: "请总结改动",
      })
    })

    await waitFor(() => {
      expect(mocks.submitQuickPhrase).toHaveBeenCalledWith("请总结改动")
    })
    expect(onSendIntent).toHaveBeenCalledTimes(1)
  })

  it("double_send 模式发送不应回填输入框", async () => {
    mocks.loadQuickPhraseState.mockResolvedValue({
      mode: "double_send",
      preset_version: 1,
      order: ["preset:commit"],
      items: {
        "preset:commit": {
          id: "preset:commit",
          title: "提交总结",
          body: "请总结改动",
          source: "preset",
          hidden: false,
          order: 0,
          updated_at: 1,
        },
      },
    })

    render(<MessageInput sessionID="s1" />)
    await waitFor(() => {
      expect(lastQuickPhraseBarProps).toBeTruthy()
    })

    act(() => {
      lastQuickPhraseBarProps.onActivate({
        id: "preset:commit",
        title: "提交总结",
        body: "请总结改动",
      })
    })

    expect(mocks.insertPlainWithMentionsImpl).not.toHaveBeenCalled()
  })

  it("double_send 模式遇到空正文时不应发送", async () => {
    const onSendIntent = vi.fn()
    mocks.loadQuickPhraseState.mockResolvedValue({
      mode: "double_send",
      preset_version: 1,
      order: ["preset:empty"],
      items: {
        "preset:empty": {
          id: "preset:empty",
          title: "空正文",
          body: "   ",
          source: "preset",
          hidden: false,
          order: 0,
          updated_at: 1,
        },
      },
    } as any)

    render(<MessageInput sessionID="s1" onSendIntent={onSendIntent} />)
    await waitFor(() => {
      expect(lastQuickPhraseBarProps).toBeTruthy()
    })

    act(() => {
      lastQuickPhraseBarProps.onActivate({
        id: "preset:empty",
        title: "空正文",
        body: "   ",
      })
    })

    expect(mocks.handleSubmit).not.toHaveBeenCalled()
    expect(mocks.submitQuickPhrase).not.toHaveBeenCalled()
    expect(onSendIntent).not.toHaveBeenCalled()
  })

  it("confirm_send 模式双击需确认后发送", async () => {
    const onSendIntent = vi.fn()
    mocks.loadQuickPhraseState.mockResolvedValue({
      mode: "confirm_send",
      preset_version: 1,
      order: ["preset:commit"],
      items: {
        "preset:commit": {
          id: "preset:commit",
          title: "提交总结",
          body: "请总结改动",
          source: "preset",
          hidden: false,
          order: 0,
          updated_at: 1,
        },
      },
    })

    render(<MessageInput sessionID="s1" onSendIntent={onSendIntent} />)
    await waitFor(() => {
      expect(lastQuickPhraseBarProps).toBeTruthy()
    })

    act(() => {
      lastQuickPhraseBarProps.onActivate({
        id: "preset:commit",
        title: "提交总结",
        body: "请总结改动",
      })
    })

    await waitFor(() => {
      expect(confirmModalMap["确认发送快捷短语"]?.isOpen).toBe(true)
    })

    act(() => {
      confirmModalMap["确认发送快捷短语"].onConfirm()
    })

    await waitFor(() => {
      expect(mocks.submitQuickPhrase).toHaveBeenCalledWith("请总结改动")
    })
    expect(onSendIntent).toHaveBeenCalledTimes(1)
  })

  it("没有 session 时 double_send 不应触发发送意图", async () => {
    const onSendIntent = vi.fn()
    mocks.loadQuickPhraseState.mockResolvedValue({
      mode: "double_send",
      preset_version: 1,
      order: ["preset:commit"],
      items: {
        "preset:commit": {
          id: "preset:commit",
          title: "提交总结",
          body: "请总结改动",
          source: "preset",
          hidden: false,
          order: 0,
          updated_at: 1,
        },
      },
    })

    render(<MessageInput sessionID={null} onSendIntent={onSendIntent} />)
    await waitFor(() => {
      expect(lastQuickPhraseBarProps).toBeTruthy()
    })

    act(() => {
      lastQuickPhraseBarProps.onActivate({
        id: "preset:commit",
        title: "提交总结",
        body: "请总结改动",
      })
    })

    expect(onSendIntent).not.toHaveBeenCalled()
    expect(mocks.submitQuickPhrase).not.toHaveBeenCalled()
  })

  it("confirm_send 弹窗切换会话后会关闭且不会发送旧会话短语", async () => {
    const onSendIntent = vi.fn()
    mocks.loadQuickPhraseState.mockResolvedValue({
      mode: "confirm_send",
      preset_version: 1,
      order: ["preset:commit"],
      items: {
        "preset:commit": {
          id: "preset:commit",
          title: "提交总结",
          body: "请总结改动",
          source: "preset",
          hidden: false,
          order: 0,
          updated_at: 1,
        },
      },
    })

    const { rerender } = render(<MessageInput sessionID="s1" onSendIntent={onSendIntent} />)
    await waitFor(() => {
      expect(lastQuickPhraseBarProps).toBeTruthy()
    })

    act(() => {
      lastQuickPhraseBarProps.onActivate({
        id: "preset:commit",
        title: "提交总结",
        body: "请总结改动",
      })
    })
    expect(confirmModalMap["确认发送快捷短语"]?.isOpen).toBe(true)

    rerender(<MessageInput sessionID="s2" onSendIntent={onSendIntent} />)

    await waitFor(() => {
      expect(confirmModalMap["确认发送快捷短语"]?.isOpen).toBe(false)
    })
    act(() => {
      confirmModalMap["确认发送快捷短语"].onConfirm()
    })

    expect(onSendIntent).not.toHaveBeenCalled()
    expect(mocks.submitQuickPhrase).not.toHaveBeenCalled()
  })

  it("confirm_send 模式遇到空正文时不应弹确认也不发送", async () => {
    mocks.loadQuickPhraseState.mockResolvedValue({
      mode: "confirm_send",
      preset_version: 1,
      order: ["preset:empty"],
      items: {
        "preset:empty": {
          id: "preset:empty",
          title: "空正文",
          body: "",
          source: "preset",
          hidden: false,
          order: 0,
          updated_at: 1,
        },
      },
    } as any)

    render(<MessageInput sessionID="s1" />)
    await waitFor(() => {
      expect(lastQuickPhraseBarProps).toBeTruthy()
    })

    act(() => {
      lastQuickPhraseBarProps.onActivate({
        id: "preset:empty",
        title: "空正文",
        body: "",
      })
    })

    expect(confirmModalMap["确认发送快捷短语"]?.isOpen).not.toBe(true)
    expect(mocks.submitQuickPhrase).not.toHaveBeenCalled()
  })

  it("精简会话确认弹窗文案为中文", () => {
    render(<MessageInput sessionID="s1" />)

    expect(lastConfirmModalProps).toBeTruthy()
    expect(lastConfirmModalProps.title).toBe("精简会话历史")
    expect(lastConfirmModalProps.message).toContain("较早")
    expect(lastConfirmModalProps.confirmText).toBe("精简")
    expect(lastConfirmModalProps.cancelText).toBe("取消")
  })

  it("按会话恢复草稿，切换会话时不串线", async () => {
    mocks.loadDrafts.mockResolvedValue({
      s1: "draft-a",
      s2: "draft-b",
    })
    mocks.insertPlainWithMentionsImpl.mockClear()
    const { rerender } = render(<MessageInput sessionID="s1" />)

    await waitFor(() => {
      expect(mocks.loadDrafts.mock.calls.length).toBeGreaterThanOrEqual(1)
      expect(mocks.insertPlainWithMentionsImpl).toHaveBeenCalledWith(expect.anything(), expect.anything(), "draft-a", {
        replace: true,
      })
    })

    rerender(<MessageInput sessionID="s2" />)

    await waitFor(() => {
      expect(mocks.insertPlainWithMentionsImpl).toHaveBeenCalledWith(expect.anything(), expect.anything(), "draft-b", {
        replace: true,
      })
    })
  })

  it("切换会话时会先同步清空旧草稿，避免闪回上一会话内容", async () => {
    let done: ((value: Record<string, string>) => void) | null = null
    mocks.loadDrafts.mockImplementationOnce(async () => ({ s1: "draft-a" }))
    mocks.loadDrafts.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          done = resolve
        }),
    )
    mocks.insertPlainWithMentionsImpl.mockClear()

    const { rerender } = render(<MessageInput sessionID="s1" />)

    await waitFor(() => {
      expect(mocks.insertPlainWithMentionsImpl).toHaveBeenCalledWith(expect.anything(), expect.anything(), "draft-a", {
        replace: true,
      })
    })

    mocks.insertPlainWithMentionsImpl.mockClear()
    rerender(<MessageInput sessionID="s2" />)

    expect(mocks.insertPlainWithMentionsImpl).toHaveBeenCalledWith(expect.anything(), expect.anything(), "", {
      replace: true,
    })

    act(() => {
      done?.({ s1: "draft-a" })
    })
  })

  it("切换会话后若用户已输入，晚到草稿不会覆盖当前输入", async () => {
    let done: ((value: Record<string, string>) => void) | null = null
    mocks.loadDrafts.mockImplementationOnce(async () => ({ s1: "draft-a" }))
    mocks.loadDrafts.mockImplementationOnce(
      async () =>
        new Promise((resolve) => {
          done = resolve
        }),
    )
    mocks.insertPlainWithMentionsImpl.mockClear()

    const { rerender } = render(<MessageInput sessionID="s1" />)

    await waitFor(() => {
      expect(mocks.insertPlainWithMentionsImpl).toHaveBeenCalledWith(expect.anything(), expect.anything(), "draft-a", {
        replace: true,
      })
    })

    mocks.insertPlainWithMentionsImpl.mockClear()
    rerender(<MessageInput sessionID="s2" />)

    expect(mocks.insertPlainWithMentionsImpl).toHaveBeenCalledWith(expect.anything(), expect.anything(), "", {
      replace: true,
    })

    mocks.insertPlainWithMentionsImpl.mockClear()
    act(() => {
      rootText = "fresh"
      lastEditorContentProps.onEditorChange({
        read: (run: () => void) => run(),
      })
    })

    act(() => {
      done?.({ s2: "old" })
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(mocks.insertPlainWithMentionsImpl).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), "old", {
      replace: true,
    })
  })

  it("空内容变更不会覆盖 draftSession 指针", () => {
    render(<MessageInput sessionID="s2" />)

    act(() => {
      rootText = ""
      lastEditorContentProps.onEditorChange({
        read: (run: () => void) => run(),
      })
    })

    expect(mocks.saveDraftSession).not.toHaveBeenCalled()
  })

  it("非草稿会话输入不会覆盖已有 draftSession 指针", () => {
    let draftSession: string | null = "s-draft"
    mocks.getMessagesBySession.mockReturnValue([{ info: { id: "m1" } }] as any[])
    mocks.saveDraftSession.mockImplementation(async (value: string | null) => {
      draftSession = value
      return { ok: true }
    })

    render(<MessageInput sessionID="s-other" />)

    act(() => {
      rootText = "hello"
      lastEditorContentProps.onEditorChange({
        read: (run: () => void) => run(),
      })
    })

    expect(draftSession).toBe("s-draft")
    expect(mocks.saveDraftSession).not.toHaveBeenCalledWith("s-other")
  })

  it("会话消息未加载完成时输入也不应覆盖已有 draftSession 指针", () => {
    let draftSession: string | null = "s-draft"
    mocks.getMessagesBySession.mockReturnValue([])
    mocks.isSessionLoaded.mockReturnValue(false)
    mocks.saveDraftSession.mockImplementation(async (value: string | null) => {
      draftSession = value
      return { ok: true }
    })

    render(<MessageInput sessionID="s-other" />)

    act(() => {
      rootText = "hello before messages loaded"
      lastEditorContentProps.onEditorChange({
        read: (run: () => void) => run(),
      })
    })

    expect(draftSession).toBe("s-draft")
    expect(mocks.saveDraftSession).not.toHaveBeenCalledWith("s-other")
  })

  it("草稿标签不在打开列表时，再次新建会话会复用原草稿会话", async () => {
    let draftSession: string | null = "s-draft"
    mocks.loadDraftSession.mockImplementation(async () => draftSession)
    mocks.saveDraftSession.mockImplementation(async (value: string | null) => {
      draftSession = value
      return { ok: true }
    })

    render(<MessageInput sessionID="s-other" />)

    act(() => {
      rootText = ""
      lastEditorContentProps.onEditorChange({
        read: (run: () => void) => run(),
      })
    })

    const open = vi.fn()
    const create = vi.fn(async () => ({ id: "s-new" }))
    const switchTo = vi.fn(async () => {})
    const fail = vi.fn()

    await prepareSession({
      draft: null,
      restore: mocks.loadDraftSession,
      reusable: async (id) => id === "s-draft",
      create,
      open,
      switchTo,
      setDraft: (id) => {
        void mocks.saveDraftSession(id)
      },
      fail,
    })

    expect(draftSession).toBe("s-draft")
    expect(open).toHaveBeenCalledWith("s-draft")
    expect(switchTo).toHaveBeenCalledWith("s-draft")
    expect(create).not.toHaveBeenCalled()
    expect(fail).not.toHaveBeenCalled()
  })

  it("生成中会话应禁用精简按钮，仅保留停止能力", async () => {
    sessionIdle = false
    mocks.loadQuickPhraseState.mockResolvedValue(quick)
    render(<MessageInput sessionID="s1" />)

    await waitFor(() => {
      expect(lastQuickPhraseBarProps).toBeTruthy()
    })

    expect(lastEditorToolbarProps).toBeTruthy()
    expect(lastEditorToolbarProps.isCompactDisabled).toBe(true)
    expect(lastEditorToolbarProps.isDisabled).toBe(true)
    expect(lastQuickPhraseBarProps.disabled).toBe(true)
  })

  it("A 生成中切到 B 空闲时，B 应恢复可交互", async () => {
    sessionIdle = false
    mocks.loadQuickPhraseState.mockResolvedValue(quick)
    const { rerender } = render(<MessageInput sessionID="s1" />)

    await waitFor(() => {
      expect(lastQuickPhraseBarProps).toBeTruthy()
    })

    expect(lastEditorToolbarProps.isDisabled).toBe(true)

    sessionIdle = true
    rerender(<MessageInput sessionID="s2" />)

    await waitFor(() => {
      expect(lastEditorToolbarProps.isDisabled).toBe(false)
    })

    expect(lastQuickPhraseBarProps.disabled).toBe(false)
  })

  it("生成中状态下快捷短语触发应无效", async () => {
    const onSendIntent = vi.fn()
    sessionIdle = false
    mocks.loadQuickPhraseState.mockResolvedValue({
      mode: "double_send",
      preset_version: 1,
      order: ["preset:commit"],
      items: {
        "preset:commit": {
          id: "preset:commit",
          title: "提交总结",
          body: "请总结改动",
          source: "preset",
          hidden: false,
          order: 0,
          updated_at: 1,
        },
      },
    })

    render(<MessageInput sessionID="s1" onSendIntent={onSendIntent} />)
    await waitFor(() => {
      expect(lastQuickPhraseBarProps).toBeTruthy()
    })

    act(() => {
      lastQuickPhraseBarProps.onActivate({
        id: "preset:commit",
        title: "提交总结",
        body: "请总结改动",
      })
    })

    expect(mocks.handleSubmit).not.toHaveBeenCalled()
    expect(mocks.submitQuickPhrase).not.toHaveBeenCalled()
    expect(onSendIntent).not.toHaveBeenCalled()
  })

  it("再次进入会话时会读取最新的 scoped 草稿", async () => {
    let count = 0
    mocks.loadDrafts.mockImplementation(async () => {
      count += 1
      if (count === 1) return { s3: "" }
      if (count === 2) return {}
      return { s3: "late-draft" }
    })

    mocks.insertPlainWithMentionsImpl.mockClear()
    const { rerender } = render(<MessageInput sessionID="s3" />)

    await waitFor(() => {
      expect(mocks.loadDrafts.mock.calls.length).toBeGreaterThanOrEqual(1)
    })

    expect(mocks.insertPlainWithMentionsImpl).not.toHaveBeenCalled()

    rerender(<MessageInput sessionID={null} />)

    await waitFor(() => {
      expect(mocks.loadDrafts.mock.calls.length).toBeGreaterThanOrEqual(2)
    })

    rerender(<MessageInput sessionID="s3" />)

    await waitFor(() => {
      expect(mocks.insertPlainWithMentionsImpl).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.anything(),
        "late-draft",
        { replace: true },
      )
    })
  })

  it("快捷短语刷新时应仅应用最后一次加载结果", async () => {
    const old = {
      mode: "fill_input",
      preset_version: 1,
      order: ["preset:old"],
      items: {
        "preset:old": {
          id: "preset:old",
          title: "旧短语",
          body: "old",
          source: "preset",
          hidden: false,
          order: 0,
          updated_at: 1,
        },
      },
    } as any
    const newer = {
      mode: "fill_input",
      preset_version: 1,
      order: ["preset:new"],
      items: {
        "preset:new": {
          id: "preset:new",
          title: "新短语",
          body: "new",
          source: "preset",
          hidden: false,
          order: 0,
          updated_at: 2,
        },
      },
    } as any
    let first: ((value: any) => void) | null = null
    let second: ((value: any) => void) | null = null
    mocks.loadQuickPhraseState.mockImplementation(
      async () =>
        new Promise((resolve) => {
          if (!first) {
            first = resolve
            return
          }
          second = resolve
        }),
    )

    render(<MessageInput sessionID="s1" />)
    await waitFor(() => {
      expect(mocks.loadQuickPhraseState).toHaveBeenCalledTimes(1)
    })

    act(() => {
      window.dispatchEvent(new Event(quick_phrase_updated_event))
    })
    await waitFor(() => {
      expect(mocks.loadQuickPhraseState).toHaveBeenCalledTimes(2)
    })

    act(() => {
      second?.(newer)
    })
    await waitFor(() => {
      expect(lastQuickPhraseBarProps.items[0]?.title).toBe("新短语")
    })

    act(() => {
      first?.(old)
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(lastQuickPhraseBarProps.items[0]?.title).toBe("新短语")
  })

  it("会话切换后 selection 尚未恢复时，工具栏进入占位态", async () => {
    selectionSessionId = "s1"
    currentSessionId = "s2"

    render(<MessageInput sessionID="s2" />)

    await waitFor(() => {
      expect(lastEditorToolbarProps.selectionPending).toBe(true)
    })
  })

  it("selection pending 期间会阻断输入与发送，避免沿用旧会话配置", async () => {
    selectionSessionId = "s1"
    currentSessionId = "s2"

    render(<MessageInput sessionID="s2" />)

    await waitFor(() => {
      expect(lastEditorToolbarProps.selectionPending).toBe(true)
      expect(lastEditorToolbarProps.isDisabled).toBe(true)
      expect(lastEditorToolbarProps.isButtonDisabled).toBe(true)
    })
  })

  it("selection pending 时，外部 insertPlainWithMentions 不会写入输入框", async () => {
    selectionSessionId = "s1"
    currentSessionId = "s2"
    const ref = createRef<any>()

    render(<MessageInput ref={ref} sessionID="s2" />)

    await waitFor(() => {
      expect(lastEditorToolbarProps.selectionPending).toBe(true)
    })

    mocks.insertPlainWithMentionsImpl.mockClear()
    act(() => {
      ref.current?.insertPlainWithMentions("from-outside")
    })

    expect(mocks.insertPlainWithMentionsImpl).not.toHaveBeenCalled()
  })

  it("首次激活会话且 selection 尚未恢复时，也会进入 pending", async () => {
    selectionSessionId = null
    currentSessionId = "s2"

    render(<MessageInput sessionID="s2" />)

    await waitFor(() => {
      expect(lastEditorToolbarProps.selectionPending).toBe(true)
      expect(lastEditorToolbarProps.isDisabled).toBe(true)
      expect(lastEditorToolbarProps.isButtonDisabled).toBe(true)
    })
  })
})
