import { createRef } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"
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
let selectedProviderId = "openai"
let selectedModelId = "gpt-4.1"
let selectedAgent = "build"
let selectedVariant: string | undefined
let selectionRevision = 0
const mocks = vi.hoisted(() => {
  return {
    insertPlainWithMentionsImpl: vi.fn(),
    restoreDraftImpl: vi.fn(),
    restoreSelections: vi.fn(),
    getMessagesBySession: vi.fn((): any[] => []),
    isSessionLoaded: vi.fn(() => true),
    loadDrafts: vi.fn(async () => ({})),
    loadDraftSession: vi.fn(async (): Promise<string | null> => null),
    saveDrafts: vi.fn(async (_value: Record<string, string>) => ({ ok: true })),
    saveDraftSession: vi.fn(async (_value: string | null) => ({ ok: true })),
    extractMessageParts: vi.fn(),
    handleSubmit: vi.fn(),
    submitQuickPhrase: vi.fn(),
    handleRetry: vi.fn(),
    handleAbort: vi.fn(),
    handleCompact: vi.fn((done: () => void) => done()),
    loadQuickPhraseState: vi.fn(async () => ({
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
    FooterPanels: ({ sessionID }: { sessionID: string | null }) => (
      <div data-testid="composer-tasks" data-session-id={sessionID} />
    ),
  }
})

vi.mock("./QuickPhraseBar", () => {
  return {
    QuickPhraseBar: (props: any) => {
      lastQuickPhraseBarProps = props
      return <div data-testid="quick-phrase-bar" />
    },
  }
})

vi.mock("./hooks/useMessageParts", () => {
  return {
    useMessageParts: () => ({ extractMessageParts: mocks.extractMessageParts }),
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
    restoreDraftImpl: mocks.restoreDraftImpl,
  }
})

vi.mock("../../state/repo/draftRepo", () => {
  return {
    loadDrafts: () => mocks.loadDrafts(),
    draftText: (value: unknown) =>
      typeof value === "string"
        ? value
        : value && typeof value === "object" && "parts" in value && Array.isArray(value.parts)
          ? value.parts.flatMap((part) => (part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string" ? [part.text] : [])).join("\n")
          : "",
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
      selectedProviderId,
      selectedModelId,
      selectedAgent,
      setSelectedModel: vi.fn(),
      setSelectedAgent: vi.fn(),
      selectedVariant,
      selectionRevision,
      setSelectedVariant: vi.fn(),
      restoreSelections: mocks.restoreSelections,
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
    selectedProviderId = "openai"
    selectedModelId = "gpt-4.1"
    selectedAgent = "build"
    selectedVariant = undefined
    selectionRevision = 0
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
    mocks.extractMessageParts.mockReturnValue([])
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
      expect(lastQuickPhraseBarProps.items[0]?.body).toBe("请总结改动")
    })
    expect(lastQuickPhraseBarProps.items).toEqual([
      {
        id: "preset:commit",
        title: "提交总结",
        body: "请总结改动",
      },
    ])
  })

  it("深色主题下编辑区使用较浅背景与正文分层", () => {
    const { container } = render(<MessageInput sessionID="s1" />)

    const editorSurface = container.querySelector('[data-testid="message-composer"] > .border')
    expect(editorSurface).toHaveClass("dark:bg-gray-900", "focus-within:border-blue-500")
  })

  it("composer 与消息内容对齐且不含顶部边框", async () => {
    mocks.loadQuickPhraseState.mockResolvedValue(quick)
    const { container } = render(<MessageInput sessionID="s1" />)
    const composer = screen.getByTestId("message-composer")

    await waitFor(() => {
      expect(composer).toHaveClass("ml-4", "mr-[22px]", "mb-2")
      expect(composer).toHaveClass("bg-white", "dark:bg-[rgb(30,30,30)]")
      expect(composer).not.toHaveClass("bg-black")
      expect(composer.parentElement).not.toHaveClass("border-t")
      expect(composer.parentElement).toHaveClass("bg-[rgb(243,243,243)]")
      expect(composer).not.toHaveClass("focus-within:border-blue-500")
      expect(container.querySelector('[data-testid="message-composer"] > .border')).toHaveClass(
        "focus-within:border-blue-500",
        "rounded-b-lg",
      )
    })
  })

  it("将任务摘要置于 composer 内部", () => {
    render(<MessageInput sessionID="s1" />)

    expect(screen.getByTestId("message-composer")).toContainElement(screen.getByTestId("composer-tasks"))
    expect(screen.getByTestId("composer-tasks")).toHaveAttribute("data-session-id", "s1")
    expect(screen.getByTestId("composer-tasks").compareDocumentPosition(screen.getByTestId("quick-phrase-bar"))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  })

  it("任务摘要存在且无快捷短语时，编辑区仅保留底部圆角", () => {
    render(<MessageInput sessionID="s1" />)

    expect(screen.getByTestId("composer-tasks")).toBeInTheDocument()
    const editorSurface = screen.getByTestId("message-composer").querySelector(":scope > .border")
    expect(editorSurface).not.toHaveClass("rounded-lg")
    expect(editorSurface).toHaveClass("rounded-b-lg")
  })

  it("onFill 回调仅回填不发送", async () => {
    mocks.loadQuickPhraseState.mockResolvedValue(quick)
    render(<MessageInput sessionID="s1" />)

    await waitFor(() => {
      expect(lastQuickPhraseBarProps.items[0]?.body).toBe("请总结改动")
    })

    act(() => {
      lastQuickPhraseBarProps.onFill({
        id: "preset:commit",
        title: "提交总结",
        body: "请总结改动",
      })
    })

    expect(mocks.insertPlainWithMentionsImpl).toHaveBeenCalledWith(expect.anything(), expect.anything(), "请总结改动", {
      replace: true,
    })
    expect(mocks.handleSubmit).not.toHaveBeenCalled()
    expect(mocks.submitQuickPhrase).not.toHaveBeenCalled()
  })

  it("onSend 回调会直接发送", async () => {
    const onSendIntent = vi.fn()
    mocks.loadQuickPhraseState.mockResolvedValue(quick)

    render(<MessageInput sessionID="s1" onSendIntent={onSendIntent} />)
    await waitFor(() => {
      expect(lastQuickPhraseBarProps).toBeTruthy()
    })

    act(() => {
      lastQuickPhraseBarProps.onSend({
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

  it("onSend 发送不应回填输入框", async () => {
    mocks.loadQuickPhraseState.mockResolvedValue(quick)

    render(<MessageInput sessionID="s1" />)
    await waitFor(() => {
      expect(lastQuickPhraseBarProps).toBeTruthy()
    })

    act(() => {
      lastQuickPhraseBarProps.onSend({
        id: "preset:commit",
        title: "提交总结",
        body: "请总结改动",
      })
    })

    expect(mocks.insertPlainWithMentionsImpl).not.toHaveBeenCalled()
  })

  it("onSend 遇到空正文时不应发送", async () => {
    const onSendIntent = vi.fn()
    mocks.loadQuickPhraseState.mockResolvedValue({
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
      lastQuickPhraseBarProps.onSend({
        id: "preset:empty",
        title: "空正文",
        body: "   ",
      })
    })

    expect(mocks.handleSubmit).not.toHaveBeenCalled()
    expect(mocks.submitQuickPhrase).not.toHaveBeenCalled()
    expect(onSendIntent).not.toHaveBeenCalled()
  })

  it("没有 session 时 onSend 不应触发发送意图", async () => {
    const onSendIntent = vi.fn()
    mocks.loadQuickPhraseState.mockResolvedValue(quick)

    render(<MessageInput sessionID={null} onSendIntent={onSendIntent} />)
    await waitFor(() => {
      expect(lastQuickPhraseBarProps).toBeTruthy()
    })

    act(() => {
      lastQuickPhraseBarProps.onSend({
        id: "preset:commit",
        title: "提交总结",
        body: "请总结改动",
      })
    })

    expect(onSendIntent).not.toHaveBeenCalled()
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

  it("恢复结构化 fork 草稿及其 selection", async () => {
    const draft = {
      parts: [
        { type: "text", text: "draft [Image #1] @explore" },
        { type: "file", mime: "image/png", filename: "image.png", url: "data:image/png;base64,AA==" },
        { type: "agent", name: "explore" },
      ],
      agent: "review",
      model: { providerID: "openai", modelID: "gpt-5", variant: "high" },
    }
    mocks.loadDrafts.mockResolvedValue({ forked: draft })

    render(<MessageInput sessionID="forked" />)

    await waitFor(() => {
      expect(mocks.restoreDraftImpl).toHaveBeenCalledWith(expect.anything(), draft)
      expect(mocks.restoreSelections).toHaveBeenCalledWith(
        { providerId: "openai", modelId: "gpt-5", agent: "review", variant: "high" },
        "forked",
      )
    })
  })

  it("恢复 attachment-only structured fork draft", async () => {
    const draft = {
      parts: [{ type: "file", mime: "image/png", filename: "image.png", url: "data:image/png;base64,AA==" }],
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5" },
    }
    mocks.loadDrafts.mockResolvedValue({ forked: draft })

    render(<MessageInput sessionID="forked" />)

    await waitFor(() => {
      expect(mocks.restoreDraftImpl).toHaveBeenCalledWith(expect.anything(), draft)
    })
  })

  it("同会话晚到 draft 不覆盖用户等待期间修改的 selection", async () => {
    let resolveDrafts!: (value: Record<string, unknown>) => void
    mocks.loadDrafts.mockReturnValue(
      new Promise((resolve) => {
        resolveDrafts = resolve
      }),
    )
    const { rerender } = render(<MessageInput sessionID="forked" />)

    selectedAgent = "user-choice"
    selectionRevision += 1
    rerender(<MessageInput sessionID="forked" />)
    await waitFor(() => expect(lastEditorToolbarProps.selectedAgent).toBe("user-choice"))
    act(() => {
      resolveDrafts({
        forked: {
          parts: [{ type: "text", text: "draft" }],
          agent: "review",
          model: { providerID: "openai", modelID: "gpt-5", variant: "high" },
        },
      })
    })

    await waitFor(() => {
      expect(mocks.restoreDraftImpl).toHaveBeenCalled()
    })
    expect(mocks.restoreSelections).not.toHaveBeenCalled()
  })

  it("用户编辑时晚到 structured draft 不恢复内容或 selection", async () => {
    let resolveDrafts!: (value: Record<string, unknown>) => void
    mocks.loadDrafts.mockReturnValue(new Promise((resolve) => {
      resolveDrafts = resolve
    }))
    rootText = "user edit"
    mocks.extractMessageParts.mockReturnValue([{ type: "text", text: "user edit" }])
    render(<MessageInput sessionID="forked" />)

    act(() => {
      lastEditorContentProps.onEditorChange({ read: (fn: () => void) => fn() })
      resolveDrafts({
        forked: {
          parts: [{ type: "text", text: "late draft" }],
          agent: "review",
          model: { providerID: "openai", modelID: "gpt-5" },
        },
      })
    })

    await act(async () => {
      await Promise.resolve()
    })
    expect(mocks.restoreDraftImpl).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ agent: "review" }))
    expect(mocks.restoreSelections).not.toHaveBeenCalledWith(expect.objectContaining({ agent: "review" }), "forked")
  })

  it("fork session activation 先恢复 selection 时，晚到 draft 仍恢复其 selection", async () => {
    let resolveDrafts!: (value: Record<string, unknown>) => void
    selectionRevision = 1
    mocks.loadDrafts.mockReturnValue(
      new Promise((resolve) => {
        resolveDrafts = resolve
      }),
    )
    render(<MessageInput sessionID="forked" />)

    act(() => {
      resolveDrafts({
        forked: {
          parts: [{ type: "text", text: "draft" }],
          agent: "review",
          model: { providerID: "openai", modelID: "gpt-5" },
        },
      })
    })

    await waitFor(() => {
      expect(mocks.restoreSelections).toHaveBeenCalledWith(
        { providerId: "openai", modelId: "gpt-5", agent: "review", variant: null },
        "forked",
      )
    })
  })

  it("编辑 structured fork draft 时保留 resource、agent 和 selection", async () => {
    currentSessionId = "forked"
    selectedAgent = "review"
    selectedProviderId = "openai"
    selectedModelId = "gpt-5"
    selectedVariant = "high"
    rootText = "changed [resource.txt] @explore"
    mocks.extractMessageParts.mockReturnValue([
      { type: "text", text: rootText },
      { type: "agent", name: "explore" },
      {
        type: "file",
        mime: "text/plain",
        filename: "resource.txt",
        url: "resource://server/item",
        source: {
          type: "resource",
          clientName: "server",
          uri: "resource://server/item",
          text: { value: "resource://server/item", start: 8, end: 22 },
        },
      },
    ])
    render(<MessageInput sessionID="forked" />)

    act(() => {
      lastEditorContentProps.onEditorChange({ read: (fn: () => void) => fn() })
    })

    expect(mocks.saveDrafts).toHaveBeenCalledWith({
      forked: {
        parts: mocks.extractMessageParts.mock.results[0].value,
        agent: "review",
        model: { providerID: "openai", modelID: "gpt-5", variant: "high" },
      },
    })
  })

  it("附件-only 和纯文本编辑均写入 structured drafts", async () => {
    currentSessionId = "forked"
    rootText = "[image.png]"
    mocks.extractMessageParts.mockReturnValue([
      { type: "file", mime: "image/png", filename: "image.png", url: "data:image/png;base64,AA==" },
    ])
    render(<MessageInput sessionID="forked" />)

    act(() => {
      lastEditorContentProps.onEditorChange({ read: (fn: () => void) => fn() })
    })

    expect(mocks.saveDrafts).toHaveBeenLastCalledWith({
      forked: {
        parts: [{ type: "file", mime: "image/png", filename: "image.png", url: "data:image/png;base64,AA==" }],
        agent: "build",
        model: { providerID: "openai", modelID: "gpt-4.1", variant: undefined },
      },
    })

    await act(async () => {
      await Promise.resolve()
    })
    rootText = "plain"
    mocks.extractMessageParts.mockReturnValue([{ type: "text", text: "plain" }])
    act(() => {
      lastEditorContentProps.onEditorChange({ read: (fn: () => void) => fn() })
    })

    expect(mocks.saveDrafts).toHaveBeenLastCalledWith({
      forked: {
        parts: [{ type: "text", text: "plain" }],
        agent: "build",
        model: { providerID: "openai", modelID: "gpt-4.1", variant: undefined },
      },
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
    mocks.loadQuickPhraseState.mockResolvedValue(quick)

    render(<MessageInput sessionID="s1" onSendIntent={onSendIntent} />)
    await waitFor(() => {
      expect(lastQuickPhraseBarProps).toBeTruthy()
    })

    act(() => {
      lastQuickPhraseBarProps.onSend({
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
