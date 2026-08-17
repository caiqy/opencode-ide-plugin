import { useState, useRef, useCallback, useEffect, useReducer, forwardRef, useImperativeHandle, useMemo, type RefObject } from "react"
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $getRoot, $getSelection, $isRangeSelection, $createTextNode, type EditorState } from "lexical"
import { $createMentionNode } from "../mention/MentionNode"
import { useSession } from "../../state/SessionContext"
import { useMessages } from "../../state/MessagesContext"
import { useProject } from "../../state/ProjectContext"
import { useProviders } from "../../state/ProvidersContext"
import { sdk, type SessionWithApproval } from "../../lib/api/sdkClient"
import type { Provider } from "@opencode-ai/sdk/client"
import { toProjectRelative } from "../../utils/path"
import { ConfirmModal } from "../ConfirmModal"
import { createEditorConfig } from "./EditorConfig"
import { EditorContent } from "./EditorContent"
import { EditorToolbar } from "./EditorToolbar"
import { FooterPanels } from "./FooterPanels"
import { QuickPhraseBar } from "./QuickPhraseBar"
import { useMessageInput } from "./hooks/useMessageInput"
import { useFileAttachment } from "./hooks/useFileAttachment"
import { useDragDrop } from "./hooks/useDragDrop"
import { useEditorKeyboard } from "./hooks/useEditorKeyboard"
import { useMessageParts } from "./hooks/useMessageParts"
import { insertPlainWithMentionsImpl, restoreDraftImpl } from "./utils"
import { draftText, loadDrafts, saveDraftSession, saveDrafts, type Draft } from "../../state/repo/draftRepo"
import { loadQuickPhraseState, type QuickPhraseState } from "../../state/repo/quickPhraseRepo"
import { quick_phrase_updated_event } from "../../state/repo/quickPhraseEvent"
import { approvalMode, type ApprovalMode } from "../../state/approval"
import { useToast } from "../../state/ToastContext"

interface MessageInputProps {
  sessionID: string | null
  blocked?: boolean
  onMessageSent?: () => void
  onSendIntent?: () => void
  onError?: (error: Error) => void
}

interface DraftHydration {
  sessionID: string | null
  revision: number
  editorRevision: number
  loading: number
}

export const MessageInput = forwardRef<
  {
    focus: () => void
    insertPaths: (paths: string[]) => void
    pastePath: (path: string) => void
    insertPlainWithMentions: (value: string) => void
  },
  MessageInputProps
>(({ sessionID, blocked = false, onMessageSent, onSendIntent, onError }, ref) => {
  const initialConfig = createEditorConfig()
  const draftHydration = useRef<DraftHydration>({ sessionID: null, revision: 0, editorRevision: 0, loading: 0 })

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <MessageInputInner
        ref={ref}
        sessionID={sessionID}
        blocked={blocked}
        onMessageSent={onMessageSent}
        onSendIntent={onSendIntent}
        onError={onError}
        draftHydration={draftHydration}
      />
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
  MessageInputProps & { draftHydration: RefObject<DraftHydration> }
>(({ sessionID, blocked = false, onMessageSent, onSendIntent, onError, draftHydration }, ref) => {
  const [editor] = useLexicalComposerContext()
  const [isEmpty, setIsEmpty] = useState(true)
const [isCompactConfirmOpen, setIsCompactConfirmOpen] = useState(false)
  const activeSessionRef = useRef(sessionID)
  activeSessionRef.current = sessionID
  const pendingApprovalRef = useRef<Record<string, boolean>>({})
  const [, forceRender] = useReducer((count: number) => count + 1, 0)

  const [isCompacting, setIsCompacting] = useState(false)
  const [modelSelectorKey, setModelSelectorKey] = useState(0)
  const contentEditableRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { worktree } = useProject()
  const {
    currentSession,
    setCurrentSession,
    isSessionIdle,
    selectedProviderId,
    selectedModelId,
    selectedAgent,
    setSelectedModel,
    setSelectedAgent,
    selectedVariant,
    selectionRevision,
    selectionSessionId,
    setSelectedVariant,
    restoreSelections,
  } = useSession()
  const { providersDirty, clearProvidersDirty } = useProviders()
  const { showToast } = useToast()
  const { getMessagesBySession, isSessionLoaded } = useMessages()

  // Providers state for variants computation
  const [providers, setProviders] = useState<Provider[]>([])
  const [quickPhrases, setQuickPhrases] = useState<QuickPhraseState | null>(null)

  const restoring = useRef(false)
  const selectionRevisionRef = useRef(selectionRevision)
  selectionRevisionRef.current = selectionRevision
  if (draftHydration.current.sessionID !== sessionID) {
    draftHydration.current.sessionID = sessionID
    draftHydration.current.revision = selectionRevision
  }
  const phraseLoading = useRef(0)
  const draft = useRef("")
  const drafts = useRef<Record<string, Draft>>({})

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
    (value: Draft | undefined, restoreSelection = true) => {
      const text = draftText(value)
      restoring.current = true
      draft.current = text
      if (typeof value === "string" || !value) {
        insertPlainWithMentionsImpl(editor, parseWithRange, text, { replace: true })
      } else {
        restoreDraftImpl(editor, value)
        if (restoreSelection) {
          restoreSelections(
            {
              providerId: value.model?.providerID ?? null,
              modelId: value.model?.modelID ?? null,
              agent: value.agent,
              variant: value.model?.variant ?? null,
            },
            sessionID,
          )
        }
      }
      queueMicrotask(() => {
        restoring.current = false
      })
    },
    [editor, parseWithRange, restoreSelections, sessionID],
  )

  const { extractMessageParts } = useMessageParts({ editor, resolveToAbsolutePath })

  const handleEditorChange = useCallback(
    (editorState: EditorState) => {
      editorState.read(() => {
        const textContent = $getRoot().getTextContent()
        setIsEmpty(textContent.trim().length === 0)
        draft.current = textContent
        if (restoring.current || !sessionID) return
        draftHydration.current.editorRevision++
        const parts = extractMessageParts()
        const next = { ...drafts.current }
        if (parts.length > 0) {
          next[sessionID] = {
            parts,
            agent: selectedAgent,
            model: selectedProviderId && selectedModelId ? { providerID: selectedProviderId, modelID: selectedModelId, variant: selectedVariant } : undefined,
          }
        } else {
          delete next[sessionID]
        }
        drafts.current = next
        void saveDrafts(next)
        if (!textContent) return
        if (!isSessionLoaded(sessionID)) return
        if (getMessagesBySession(sessionID).length > 0) return
        void saveDraftSession(sessionID)
      })
    },
    [draftHydration, extractMessageParts, getMessagesBySession, isSessionLoaded, selectedAgent, selectedModelId, selectedProviderId, selectedVariant, sessionID],
  )

  const { lastFailedMessage, handleSubmit, submitQuickPhrase, handleRetry, handleAbort, handleCompact } =
    useMessageInput({
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

  const selectionPending =
    !!sessionID &&
    currentSession?.id === sessionID &&
    ((typeof selectionSessionId === "string" && selectionSessionId !== sessionID) || selectionSessionId === null)

  const busy = sessionID ? !isSessionIdle(sessionID) : false
  const isIdle = !busy
  const interactionLocked = blocked || selectionPending
  const sendLocked = busy || interactionLocked

const currentApproval = approvalMode(
    currentSession?.id === sessionID ? (currentSession as SessionWithApproval).permission : undefined,
  )
  const approvalDisabled = !sessionID || currentSession?.id !== sessionID
  const approvalPending = !!sessionID && !!pendingApprovalRef.current[sessionID]
  const setApproval = useCallback(
    async (approval: ApprovalMode) => {
      if (!sessionID || currentSession?.id !== sessionID || pendingApprovalRef.current[sessionID]) return
      pendingApprovalRef.current[sessionID] = true
      forceRender()
      try {
        const result = await sdk.session.setApproval({ sessionID, approval })
        if (activeSessionRef.current !== sessionID) return
        if (result.data) {
          setCurrentSession(result.data)
          return
        }
        showToast("切换审批模式失败", { variant: "error" })
      } catch {
        if (activeSessionRef.current === sessionID) showToast("切换审批模式失败", { variant: "error" })
      } finally {
        delete pendingApprovalRef.current[sessionID]
        forceRender()
      }
    },
    [currentSession?.id, sessionID, setCurrentSession, showToast],
  )

  const submit = useCallback(() => {
    if (sendLocked) return
    void handleSubmit()
  }, [handleSubmit, sendLocked])

  useDragDrop({ contentEditableRef, containerRef, disabled: interactionLocked })

  useEditorKeyboard({ editor, contentEditableRef, onSubmit: submit })

  // Restore session-scoped draft from workspace storage
  useEffect(() => {
    let active = true
    const load = ++draftHydration.current.loading
    const revision = draftHydration.current.revision
    const editorRevision = draftHydration.current.editorRevision
    const cached = sessionID ? drafts.current[sessionID] : undefined
    if ((cached && typeof cached !== "string") || draftText(cached) !== draft.current) {
      restore(cached, selectionRevisionRef.current === revision)
    }
    void loadDrafts().then((value) => {
      if (!active || load !== draftHydration.current.loading || editorRevision !== draftHydration.current.editorRevision) return
      drafts.current = value
      const next = sessionID ? value[sessionID] : undefined
      if (draft.current && draftText(next) !== draft.current) return
      if (typeof next === "string" && draftText(next) === draft.current) return
      restore(next, selectionRevisionRef.current === revision)
    })
    return () => {
      active = false
    }
  }, [restore, sessionID])

  useEffect(() => {
    let active = true
    const load = () => {
      const id = ++phraseLoading.current
      void loadQuickPhraseState().then((state) => {
        if (!active) return
        if (id !== phraseLoading.current) return
        setQuickPhrases(state)
      })
    }
    const onUpdate = () => load()
    load()
    window.addEventListener(quick_phrase_updated_event, onUpdate)
    return () => {
      active = false
      window.removeEventListener(quick_phrase_updated_event, onUpdate)
    }
  }, [])

  // Expose methods to parent
  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        editor.focus()
      },
      insertPaths: (paths: string[]) => {
        if (interactionLocked) return
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
        if (interactionLocked) return
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
        if (interactionLocked) return
        insertPlainWithMentionsImpl(editor, parseWithRange, value, { replace: true })
      },
    }),
    [editor, interactionLocked, worktree, parseWithRange],
  )

  // Requests and selection restoration lock editing; model execution only locks sending.
  useEffect(() => {
    editor.setEditable(!interactionLocked)
  }, [editor, interactionLocked])

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

  const isButtonDisabled = sendLocked || isEmpty
  const isCompactDisabled = sendLocked || isCompacting || !sessionID || !selectedProviderId || !selectedModelId

  const handleCompactWithModal = useCallback(async () => {
    if (sendLocked) {
      setIsCompactConfirmOpen(false)
      return
    }
    setIsCompacting(true)
    await handleCompact(() => {
      setIsCompacting(false)
      setIsCompactConfirmOpen(false)
    })
  }, [handleCompact, sendLocked])

  const openCompactConfirm = useCallback(() => {
    if (sendLocked) return
    setIsCompactConfirmOpen(true)
  }, [sendLocked])

  const fillPhrase = useCallback(
    (body: string) => {
      if (!body.trim()) return
      insertPlainWithMentionsImpl(editor, parseWithRange, body, { replace: true })
      draft.current = body
      setIsEmpty(body.trim().length === 0)
      if (!sessionID) return
      const next = { ...drafts.current, [sessionID]: body }
      drafts.current = next
      void saveDrafts(next)
      if (!isSessionLoaded(sessionID)) return
      if (getMessagesBySession(sessionID).length > 0) return
      void saveDraftSession(sessionID)
    },
    [editor, getMessagesBySession, isSessionLoaded, parseWithRange, sessionID],
  )

  const sendPhrase = useCallback(
    (body: string) => {
      if (!body.trim()) return
      if (!sessionID) return
      if (sendLocked) return
      onSendIntent?.()
      void submitQuickPhrase(body)
    },
    [onSendIntent, sendLocked, sessionID, submitQuickPhrase],
  )

  const onSendPhrase = useCallback(
    (item: { id: string; title: string; body: string }) => {
      sendPhrase(item.body)
    },
    [sendPhrase],
  )

  const onFillPhrase = useCallback(
    (item: { id: string; title: string; body: string }) => {
      if (interactionLocked) return
      fillPhrase(item.body)
    },
    [fillPhrase, interactionLocked],
  )

  const phraseItems = useMemo(() => {
    if (!quickPhrases) return [] as Array<{ id: string; title: string; body: string }>
    return quickPhrases.order
      .map((id) => quickPhrases.items[id])
      .filter((item): item is NonNullable<typeof item> => Boolean(item) && item.hidden !== true)
      .map((item) => ({ id: item.id, title: item.title, body: item.body }))
  }, [quickPhrases])

  return (
    <>
      <footer className="flex-shrink-0 bg-[rgb(243,243,243)] pt-2 dark:bg-gray-950">
        <div
          className="ml-4 mr-[22px] mb-2 rounded-lg bg-white dark:bg-[rgb(30,30,30)]"
          data-testid="message-composer"
        >
          <FooterPanels sessionID={sessionID} />
          <QuickPhraseBar
            items={phraseItems}
            disabled={interactionLocked}
            sendDisabled={sendLocked}
            onSend={onSendPhrase}
            onFill={onFillPhrase}
          />
          <div
            className="first:rounded-t-lg border border-transparent bg-white rounded-b-lg focus-within:border-blue-500 dark:bg-[var(--color-gray-800)] dark:focus-within:border-blue-400"
          >
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
              isDisabled={interactionLocked}
              modelSelectorKey={modelSelectorKey}
              lastFailedMessage={Boolean(lastFailedMessage)}
              onRetry={handleRetry}
              fileInputRef={fileInputRef}
              onFileChange={handleFileChange}
              isIdle={isIdle}
              isButtonDisabled={isButtonDisabled}
              isCompactDisabled={isCompactDisabled}
              onSubmit={submit}
              onAbort={handleAbort}
              onCompactClick={openCompactConfirm}
              variants={currentModelInfo.variants}
              selectedVariant={selectedVariant}
              onVariantSelect={(variant) => setSelectedVariant(variant)}
              isReasoningModel={currentModelInfo.isReasoning}
selectionPending={selectionPending}
              approvalMode={currentApproval}
              approvalPending={approvalPending}
              approvalDisabled={approvalDisabled}
              onApprovalSelect={setApproval}
            />
          </div>
        </div>
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
