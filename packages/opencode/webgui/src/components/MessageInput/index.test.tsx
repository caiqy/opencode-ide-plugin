import { describe, expect, it, vi } from "vitest"
import { render } from "@testing-library/react"

let lastConfirmModalProps: any

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
    EditorToolbar: () => null,
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
    insertPlainWithMentionsImpl: () => {},
  }
})

vi.mock("../../state/uiBridgeState", () => {
  return {
    uiBridgeSubscribe: () => () => {},
    uiBridgeUpdate: () => {},
  }
})

vi.mock("../../state/SessionContext", () => {
  return {
    useSession: () => ({
      isIdle: true,
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
  it("精简会话确认弹窗文案为中文", () => {
    render(<MessageInput sessionID="s1" />)

    expect(lastConfirmModalProps).toBeTruthy()
    expect(lastConfirmModalProps.title).toBe("精简会话历史")
    expect(lastConfirmModalProps.message).toContain("较早")
    expect(lastConfirmModalProps.confirmText).toBe("精简")
    expect(lastConfirmModalProps.cancelText).toBe("取消")
  })
})
