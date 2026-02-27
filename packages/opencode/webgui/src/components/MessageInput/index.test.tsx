import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render, waitFor } from "@testing-library/react"
import { prepareSession } from "../../App"

let lastConfirmModalProps: any
let lastEditorToolbarProps: any
let lastEditorContentProps: any
let rootText = ""
let sessionIdle = true
const mocks = vi.hoisted(() => {
  return {
    insertPlainWithMentionsImpl: vi.fn(),
    loadDrafts: vi.fn(async () => ({})),
    loadDraftSession: vi.fn(async (): Promise<string | null> => null),
    saveDrafts: vi.fn(async (_value: Record<string, string>) => ({ ok: true })),
    saveDraftSession: vi.fn(async (_value: string | null) => ({ ok: true })),
  }
})

vi.mock("../ConfirmModal", () => {
  return {
    ConfirmModal: (props: any) => {
      lastConfirmModalProps = props
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

vi.mock("./hooks/useMessageParts", () => {
  return {
    useMessageParts: () => ({ extractMessageParts: vi.fn() }),
  }
})

vi.mock("./hooks/useMessageInput", () => {
  return {
    useMessageInput: () => ({
      lastFailedMessage: null,
      handleSubmit: vi.fn(),
      handleRetry: vi.fn(),
      handleAbort: vi.fn(),
      handleCompact: vi.fn((done: () => void) => done()),
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

vi.mock("../../state/SessionContext", () => {
  return {
    useSession: () => ({
      isIdle: sessionIdle,
      selectedProviderId: "openai",
      selectedModelId: "gpt-4.1",
      selectedAgent: "build",
      setSelectedModel: vi.fn(),
      setSelectedAgent: vi.fn(),
      selectedVariant: undefined,
      setSelectedVariant: vi.fn(),
    }),
  }
})

vi.mock("../../state/ProjectContext", () => {
  return {
    useProject: () => ({ worktree: undefined }),
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

describe("MessageInput compact confirm", () => {
  beforeEach(() => {
    sessionIdle = true
    lastEditorToolbarProps = null
    lastEditorContentProps = null
    rootText = ""
    vi.clearAllMocks()
    mocks.loadDrafts.mockResolvedValue({})
    mocks.loadDraftSession.mockResolvedValue(null)
    mocks.saveDrafts.mockResolvedValue({ ok: true })
    mocks.saveDraftSession.mockResolvedValue({ ok: true })
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
      expect(mocks.loadDrafts).toHaveBeenCalledTimes(1)
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

  it("生成中会话应禁用精简按钮，仅保留停止能力", () => {
    sessionIdle = false
    render(<MessageInput sessionID="s1" />)

    expect(lastEditorToolbarProps).toBeTruthy()
    expect(lastEditorToolbarProps.isCompactDisabled).toBe(true)
    expect(lastEditorToolbarProps.isDisabled).toBe(true)
  })

  it("A 生成中切到 B 空闲时，B 应恢复可交互", () => {
    sessionIdle = false
    const { rerender } = render(<MessageInput sessionID="s1" />)

    expect(lastEditorToolbarProps.isDisabled).toBe(true)

    sessionIdle = true
    rerender(<MessageInput sessionID="s2" />)

    expect(lastEditorToolbarProps.isDisabled).toBe(false)
  })

  it("再次进入会话时会读取最新的 scoped 草稿", async () => {
    mocks.loadDrafts
      .mockResolvedValueOnce({ s3: "" })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ s3: "late-draft" })

    mocks.insertPlainWithMentionsImpl.mockClear()
    const { rerender } = render(<MessageInput sessionID="s3" />)

    await waitFor(() => {
      expect(mocks.loadDrafts).toHaveBeenCalledTimes(1)
    })

    expect(mocks.insertPlainWithMentionsImpl).not.toHaveBeenCalled()

    rerender(<MessageInput sessionID={null} />)

    await waitFor(() => {
      expect(mocks.loadDrafts).toHaveBeenCalledTimes(2)
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
})
