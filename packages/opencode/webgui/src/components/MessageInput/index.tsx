import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle, useMemo } from "react"
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $getRoot, $getSelection, $isRangeSelection, $createTextNode, type EditorState } from "lexical"
import { $createMentionNode } from "../mention/MentionNode"
import { useSession } from "../../state/SessionContext"
import { useProject } from "../../state/ProjectContext"
import { useProviders } from "../../state/ProvidersContext"
import { sdk } from "../../lib/api/sdkClient"
import type { Provider } from "@opencode-ai/sdk/client"
import { toProjectRelative } from "../../utils/path"
import { ConfirmModal } from "../ConfirmModal"
import { createEditorConfig } from "./EditorConfig"
import { EditorContent } from "./EditorContent"
import { EditorToolbar } from "./EditorToolbar"
import { FooterPanels } from "./FooterPanels"
import { useMessageInput } from "./hooks/useMessageInput"
import { useFileAttachment } from "./hooks/useFileAttachment"
import { useDragDrop } from "./hooks/useDragDrop"
import { useEditorKeyboard } from "./hooks/useEditorKeyboard"
import { useMessageParts } from "./hooks/useMessageParts"
import { insertPlainWithMentionsImpl } from "./utils"
import { uiBridgeDraft, uiBridgeSubscribeDraft, uiBridgeUpdateDraft } from "../../state/uiBridgeState"

interface MessageInputProps {
  sessionID: string | null
  onMessageSent?: () => void
  onError?: (error: Error) => void
}

export const MessageInput = forwardRef<
  {
    focus: () => void
    insertPaths: (paths: string[]) => void
    pastePath: (path: string) => void
    insertPlainWithMentions: (value: string) => void
  },
  MessageInputProps
>(({ sessionID, onMessageSent, onError }, ref) => {
  const initialConfig = createEditorConfig()

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <MessageInputInner ref={ref} sessionID={sessionID} onMessageSent={onMessageSent} onError={onError} />
    </LexicalComposer>
  )
})

MessageInput.displayName = "MessageInput"

const MessageInputInner = forwardRef<
  {
    focus: () => void
    insertPaths: (paths: string[]) => void
    pastePath: (path: string) => void
    insertPlainWithMentions: (value: string) => void
  },
  MessageInputProps
>(({ sessionID, onMessageSent, onError }, ref) => {
  const [editor] = useLexicalComposerContext()
  const [isEmpty, setIsEmpty] = useState(true)
  const [isCompactConfirmOpen, setIsCompactConfirmOpen] = useState(false)
  const [isCompacting, setIsCompacting] = useState(false)
  const [modelSelectorKey, setModelSelectorKey] = useState(0)
  const contentEditableRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { worktree } = useProject()
  const {
    isIdle,
    selectedProviderId,
    selectedModelId,
    selectedAgent,
    setSelectedModel,
    setSelectedAgent,
    selectedVariant,
    setSelectedVariant,
  } = useSession()
  const { providersDirty, clearProvidersDirty } = useProviders()

  // Providers state for variants computation
  const [providers, setProviders] = useState<Provider[]>([])

  const restoring = useRef(false)
  const draft = useRef("")

  const handleEditorChange = useCallback(
    (editorState: EditorState) => {
      editorState.read(() => {
        const root = $getRoot()
        const textContent = root.getTextContent()
        setIsEmpty(textContent.trim().length === 0)
        draft.current = textContent
        if (!restoring.current && sessionID) uiBridgeUpdateDraft(sessionID, textContent)
      })
    },
    [sessionID],
  )

  const resolveToAbsolutePath = useCallback(
    (path: string | undefined): string => {
      if (!path) return ""
      const p = path.replaceAll("\\", "/")
      const isDrive = /^[A-Za-z]:\//.test(p)
      const isUnc = p.startsWith("//")
      const isRooted = p.startsWith("/")
      if (isDrive || isUnc || isRooted) return p
      if (!worktree) return p
      const wtNorm = worktree.replaceAll("\\", "/")
      const wt = wtNorm.endsWith("/") ? wtNorm.slice(0, -1) : wtNorm
      return `${wt}/${p}`
    },
    [worktree],
  )

  const parseWithRange = useCallback(
    (val: string): { display: string; path: string; range?: { start: number; end: number } } => {
      const idx = val.lastIndexOf(":")
      if (idx > 0) {
        const base = val.slice(0, idx)
        const tail = val.slice(idx + 1)
        const m = tail.match(/^(\d+)-(\d+)$/)
        if (m) {
          const start = parseInt(m[1], 10)
          const end = parseInt(m[2], 10)
          if (!Number.isNaN(start) && !Number.isNaN(end)) {
            return { display: val, path: base, range: { start, end } }
          }
        }
        return { display: val, path: val }
      }
      return { display: val, path: val }
    },
    [],
  )

  const restore = useCallback(
    (value: string) => {
      restoring.current = true
      draft.current = value
      insertPlainWithMentionsImpl(editor, parseWithRange, value, { replace: true })
      queueMicrotask(() => {
        restoring.current = false
      })
    },
    [editor, parseWithRange],
  )

  const { extractMessageParts } = useMessageParts({ editor, resolveToAbsolutePath })

  const { lastFailedMessage, handleSubmit, handleRetry, handleAbort, handleCompact } = useMessageInput({
    sessionID,
    editor,
    isEmpty,
    selectedProviderId,
    selectedModelId,
    selectedVariant,
    selectedAgent,
    extractMessageParts,
    onMessageSent,
    onError,
  })

  const { fileInputRef, handleFileSelect, handleFileChange } = useFileAttachment(editor)

  useDragDrop({ contentEditableRef, containerRef, editor, worktree, parseWithRange })

  useEditorKeyboard({ editor, contentEditableRef, parseWithRange, onSubmit: handleSubmit })

  // Restore and subscribe to session-scoped draft (handles late host hydrate)
  useEffect(() => {
    restore(uiBridgeDraft(sessionID))
    return uiBridgeSubscribeDraft(sessionID, (value) => {
      if (value === draft.current) return
      restore(value)
    })
  }, [restore, sessionID])

  // Expose methods to parent
  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        editor.focus()
      },
      insertPaths: (paths: string[]) => {
        if (!paths || paths.length === 0) return
        let tries = 0
        const perform = () => {
          if (!worktree && tries++ < 10) {
            setTimeout(perform, 200)
            return
          }
          editor.update(() => {
            const selection = $getSelection()
            if (!$isRangeSelection(selection)) return
            const nodes = [] as any[]
            for (const raw of paths) {
              const isDir = raw.endsWith("/")
              if (isDir) {
                let rel = toProjectRelative(raw, worktree)
                if (!rel.endsWith("/")) rel = rel + "/"
                const metadata = {
                  type: "directory" as const,
                  display: rel,
                  path: rel,
                }
                nodes.push($createMentionNode(metadata))
                nodes.push($createTextNode(" "))
                continue
              }

              const parsed = parseWithRange(raw)
              const relBase = toProjectRelative(parsed.path, worktree)
              const display = parsed.range ? `${relBase}:${parsed.range.start}-${parsed.range.end}` : relBase
              const metadata: any = {
                type: "file" as const,
                display,
                path: relBase,
              }
              if (parsed.range) {
                metadata.range = {
                  start: { line: parsed.range.start, character: 0 },
                  end: { line: parsed.range.end, character: 0 },
                }
              }
              nodes.push($createMentionNode(metadata))
              nodes.push($createTextNode(" "))
            }
            if (nodes.length > 0) selection.insertNodes(nodes)
          })
        }
        perform()
      },
      pastePath: (path: string) => {
        if (!path) return
        let tries = 0
        const perform = () => {
          if (!worktree && tries++ < 10) {
            setTimeout(perform, 200)
            return
          }
          editor.update(() => {
            const selection = $getSelection()
            if (!$isRangeSelection(selection)) return
            let rel = toProjectRelative(path, worktree)
            if (!rel.endsWith("/")) rel = rel + "/"
            const metadata = {
              type: "directory" as const,
              display: rel,
              path: rel,
            }
            selection.insertNodes([$createMentionNode(metadata), $createTextNode(" ")])
          })
        }
        perform()
      },
      insertPlainWithMentions: (value: string) => {
        insertPlainWithMentionsImpl(editor, parseWithRange, value, { replace: true })
      },
    }),
    [editor, worktree, parseWithRange],
  )

  const busy = !isIdle

  // Disable/enable editor based on session busy state
  useEffect(() => {
    editor.setEditable(!busy)
  }, [editor, busy])

  // Load providers for variant computation
  useEffect(() => {
    let active = true
    async function loadProviders() {
      try {
        const response = await sdk.config.providers()
        if (!active) return
        if (response.data) {
          setProviders(response.data.providers)
        }
      } catch (err) {
        console.error("[MessageInput] Failed to load providers:", err)
      }
    }
    loadProviders()
    return () => {
      active = false
    }
  }, [])

  // Update model selector when providers change
  useEffect(() => {
    if (!providersDirty) return
    setModelSelectorKey((value) => value + 1)
    // Reload providers when dirty
    sdk.config.providers().then((response) => {
      if (response.data) {
        setProviders(response.data.providers)
      }
    })
    clearProvidersDirty()
  }, [providersDirty, clearProvidersDirty])

  const currentModelInfo = useMemo(() => {
    if (!selectedProviderId || !selectedModelId) {
      return {
        variants: undefined as string[] | undefined,
        isReasoning: false,
      }
    }
    const provider = providers.find((p) => p.id === selectedProviderId)
    if (!provider) {
      return {
        variants: undefined,
        isReasoning: false,
      }
    }
    const model = provider.models?.[selectedModelId] as
      | ((typeof provider.models)[string] & {
          variants?: Record<string, unknown>
          capabilities?: { reasoning?: boolean }
        })
      | undefined

    return {
      variants: model?.variants ? Object.keys(model.variants) : undefined,
      isReasoning: !!model?.capabilities?.reasoning,
    }
  }, [providers, selectedProviderId, selectedModelId])

  const isDisabled = busy
  const isButtonDisabled = busy || isEmpty
  const isCompactDisabled = busy || isCompacting || !sessionID || !selectedProviderId || !selectedModelId

  const handleCompactWithModal = useCallback(async () => {
    setIsCompacting(true)
    await handleCompact(() => {
      setIsCompacting(false)
      setIsCompactConfirmOpen(false)
    })
  }, [handleCompact])

  return (
    <>
      <footer className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex-shrink-0">
        <FooterPanels sessionID={sessionID} />
        <EditorContent
          contentEditableRef={contentEditableRef}
          containerRef={containerRef}
          onEditorChange={handleEditorChange}
        />
        <EditorToolbar
          selectedProviderId={selectedProviderId}
          selectedModelId={selectedModelId}
          selectedAgent={selectedAgent}
          onModelSelect={setSelectedModel}
          onAgentSelect={setSelectedAgent}
          onFileSelect={handleFileSelect}
          isDisabled={isDisabled}
          modelSelectorKey={modelSelectorKey}
          lastFailedMessage={lastFailedMessage}
          onRetry={handleRetry}
          fileInputRef={fileInputRef}
          onFileChange={handleFileChange}
          isIdle={isIdle}
          isButtonDisabled={isButtonDisabled}
          isCompactDisabled={isCompactDisabled}
          onSubmit={handleSubmit}
          onAbort={handleAbort}
          onCompactClick={() => setIsCompactConfirmOpen(true)}
          variants={currentModelInfo.variants}
          selectedVariant={selectedVariant}
          onVariantSelect={(variant) => setSelectedVariant(variant)}
          isReasoningModel={currentModelInfo.isReasoning}
        />
      </footer>

      <ConfirmModal
        isOpen={isCompactConfirmOpen}
        onClose={() => setIsCompactConfirmOpen(false)}
        onConfirm={handleCompactWithModal}
        title="精简会话历史"
        message="这将总结较早的会话内容，以节省上下文。近期消息会保留，但长期细节可能丢失。是否继续？"
        confirmText="精简"
        cancelText="取消"
        variant="warning"
        isLoading={isCompacting}
      />
    </>
  )
})

MessageInputInner.displayName = "MessageInputInner"
