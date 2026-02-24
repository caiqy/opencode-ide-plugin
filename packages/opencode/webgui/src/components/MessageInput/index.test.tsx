import { beforeEach, describe, expect, it, vi } from "vitest"
import { act, render } from "@testing-library/react"

let lastConfirmModalProps: any
let lastEditorToolbarProps: any
let sessionIdle = true
const mocks = vi.hoisted(() => {
  return {
    insertPlainWithMentionsImpl: vi.fn(),
    draftListener: null as ((value: string) => void) | null,
    uiBridgeDraft: vi.fn((id: string | null) => {
      if (id === "s1") return "draft-a"
      if (id === "s2") return "draft-b"
      return ""
    }),
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

vi.mock("./EditorConfig", () => {
  return {
    createEditorConfig: () => ({}),
  }
})

vi.mock("./EditorContent", () => {
  return {
    EditorContent: () => null,
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
      isSending: false,
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

vi.mock("../../state/uiBridgeState", () => {
  return {
    uiBridgeDraft: mocks.uiBridgeDraft,
    uiBridgeSubscribeDraft: vi.fn((id: string | null, fn: (value: string) => void) => {
      void id
      mocks.draftListener = fn
      return () => {
        mocks.draftListener = null
      }
    }),
    uiBridgeUpdateDraft: vi.fn(),
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
    mocks.draftListener = null
  })

  it("精简会话确认弹窗文案为中文", () => {
    render(<MessageInput sessionID="s1" />)

    expect(lastConfirmModalProps).toBeTruthy()
    expect(lastConfirmModalProps.title).toBe("精简会话历史")
    expect(lastConfirmModalProps.message).toContain("较早")
    expect(lastConfirmModalProps.confirmText).toBe("精简")
    expect(lastConfirmModalProps.cancelText).toBe("取消")
  })

  it("按会话恢复草稿，切换会话时不串线", () => {
    mocks.insertPlainWithMentionsImpl.mockClear()
    const { rerender } = render(<MessageInput sessionID="s1" />)

    expect(mocks.uiBridgeDraft).toHaveBeenCalledWith("s1")
    expect(mocks.insertPlainWithMentionsImpl).toHaveBeenCalledWith(expect.anything(), expect.anything(), "draft-a", {
      replace: true,
    })

    rerender(<MessageInput sessionID="s2" />)

    expect(mocks.uiBridgeDraft).toHaveBeenCalledWith("s2")
    expect(mocks.insertPlainWithMentionsImpl).toHaveBeenCalledWith(expect.anything(), expect.anything(), "draft-b", {
      replace: true,
    })
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

  it("同会话下后到的草稿更新应触发回填", () => {
    mocks.insertPlainWithMentionsImpl.mockClear()
    render(<MessageInput sessionID="s3" />)

    expect(mocks.insertPlainWithMentionsImpl).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), "", {
      replace: true,
    })

    act(() => {
      mocks.draftListener?.("late-draft")
    })

    expect(mocks.insertPlainWithMentionsImpl).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      "late-draft",
      { replace: true },
    )
  })
})
