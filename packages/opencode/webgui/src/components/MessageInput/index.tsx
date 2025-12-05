import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from "react"
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $getRoot, $getSelection, $isRangeSelection, $createTextNode, type EditorState } from "lexical"
import { $createMentionNode } from "../mention/MentionNode"
import { useSession } from "../../state/SessionContext"
import { useProject } from "../../state/ProjectContext"
import { useProviders } from "../../state/ProvidersContext"
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
  const { isIdle, selectedProviderId, selectedModelId, selectedAgent, setSelectedModel, setSelectedAgent } =
    useSession()
  const { providersDirty, clearProvidersDirty } = useProviders()

  const handleEditorChange = useCallback((editorState: EditorState) => {
    editorState.read(() => {
      const root = $getRoot()
      const textContent = root.getTextContent()
      setIsEmpty(textContent.trim().length === 0)
    })
  }, [])

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

  const { extractMessageParts } = useMessageParts({ editor, resolveToAbsolutePath })

  const { isSending, lastFailedMessage, handleSubmit, handleRetry, handleAbort, handleCompact } = useMessageInput({
    sessionID,
    editor,
    isEmpty,
    selectedProviderId,
    selectedModelId,
    selectedAgent,
    extractMessageParts,
    onMessageSent,
    onError,
  })

  const { fileInputRef, handleFileSelect, handleFileChange } = useFileAttachment(editor)

  useDragDrop({ contentEditableRef, containerRef, editor, worktree, parseWithRange })

  useEditorKeyboard({ editor, contentEditableRef, parseWithRange, onSubmit: handleSubmit })

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

  // Disable/enable editor based on isSending state
  useEffect(() => {
    editor.setEditable(!isSending)
  }, [editor, isSending])

  // Update model selector when providers change
  useEffect(() => {
    if (!providersDirty) return
    setModelSelectorKey((value) => value + 1)
    clearProvidersDirty()
  }, [providersDirty, clearProvidersDirty])

  const isDisabled = isSending
  const isButtonDisabled = isDisabled || isEmpty
  const isCompactDisabled =
    isSending ||
    isCompacting ||
    !sessionID ||
    sessionID.startsWith("virtual-") ||
    !selectedProviderId ||
    !selectedModelId

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
        />
      </footer>

      <ConfirmModal
        isOpen={isCompactConfirmOpen}
        onClose={() => setIsCompactConfirmOpen(false)}
        onConfirm={handleCompactWithModal}
        title="Compact session history"
        message="This will summarize earlier parts of the conversation to save context. Recent messages will be kept, but long-term details may be lost. Proceed?"
        confirmText="Compact"
        cancelText="Cancel"
        variant="warning"
        isLoading={isCompacting}
      />
    </>
  )
})

MessageInputInner.displayName = "MessageInputInner"
