import { useState, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from "react"
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  $isElementNode,
  $getSelection,
  $isRangeSelection,
  type EditorState,
  type LexicalEditor,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
} from "lexical"
import { sdk } from "../lib/api/sdkClient"
import { useSession } from "../state/SessionContext"
import { useToast } from "../state/ToastContext"
import { useProject } from "../state/ProjectContext"
import { ModelSelector } from "./ModelSelector"
import { AgentSelector } from "./AgentSelector"
import { MentionNode, $isMentionNode, $createMentionNode } from "./mention/MentionNode"
import { MentionPlugin } from "./mention/MentionPlugin"
import { AttachmentNode, $isAttachmentNode, $createAttachmentNode } from "./attachment/AttachmentNode"
import { AttachmentPlugin } from "./attachment/AttachmentPlugin"
import {
  fileToDataURL,
  getExtensionFromFilename,
  getMimeTypeFromExtension,
  isSupportedAttachmentType,
  normalizeTextAttachment,
} from "../lib/fileUtils"
import { toProjectRelative } from "../lib/path"
import { extractPathsFromDrop } from "../lib/dnd"
import { ConfirmModal } from "./ConfirmModal"
import { useProviders } from "../state/ProvidersContext"

interface MessageInputProps {
  sessionID: string | null
  onMessageSent?: () => void
  onError?: (error: Error) => void
}

const theme = {
  paragraph: "mb-0",
  text: {
    bold: "font-bold",
    italic: "italic",
    underline: "underline",
  },
}

function insertPlainWithMentionsImpl(
  editor: LexicalEditor,
  parseWithRange: (val: string) => { display: string; path: string; range?: { start: number; end: number } },
  plain: string,
  options?: { replace?: boolean },
) {
  if (!plain) return
  editor.update(() => {
    if (options?.replace) {
      const root = $getRoot()
      root.clear()
      const paragraph = $createParagraphNode()
      root.append(paragraph)
      paragraph.select()
    }
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return
    const nodes: any[] = []
    const re = /@(\S+)/g
    let last = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(plain)) !== null) {
      const start = m.index
      const end = re.lastIndex
      if (start > last) {
        const chunk = plain.slice(last, start)
        if (chunk) nodes.push($createTextNode(chunk))
      }
      const token = m[1]
      const parsed = parseWithRange(token)
      const isDir = token.endsWith("/")
      const md: any = isDir
        ? { type: "directory" as const, display: token, path: token.endsWith("/") ? token : token + "/" }
        : (() => {
            const relBase = parsed.path
            const display = parsed.range ? `${relBase}:${parsed.range.start}-${parsed.range.end}` : relBase
            const base: any = { type: "file" as const, display, path: relBase }
            if (parsed.range)
              base.range = {
                start: { line: parsed.range.start, character: 0 },
                end: { line: parsed.range.end, character: 0 },
              }
            return base
          })()
      nodes.push($createMentionNode(md))
      last = end
    }
    if (last < plain.length) {
      const chunk = plain.slice(last)
      if (chunk) nodes.push($createTextNode(chunk))
    }
    if (nodes.length > 0) selection.insertNodes(nodes)
  })
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
  const initialConfig = {
    namespace: "MessageInput",
    theme,
    onError: (error: Error) => {
      console.error("[MessageInput] Lexical error:", error)
    },
    nodes: [MentionNode, AttachmentNode],
  }

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
  const [isSending, setIsSending] = useState(false)
  const [isEmpty, setIsEmpty] = useState(true)
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null)
  const [isCompactConfirmOpen, setIsCompactConfirmOpen] = useState(false)
  const [isCompacting, setIsCompacting] = useState(false)
  const [modelSelectorKey, setModelSelectorKey] = useState(0)
  const contentEditableRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const { showToast } = useToast()
  const { worktree } = useProject()
  const {
    isIdle,
    setIsIdle,
    selectedProviderId,
    selectedModelId,
    selectedAgent,
    setSelectedModel,
    setSelectedAgent,
    isVirtualSession,
    materializeSession,
  } = useSession()
  const { providersDirty, clearProvidersDirty } = useProviders()

  const handleEditorChange = useCallback((editorState: EditorState) => {
    editorState.read(() => {
      const root = $getRoot()
      const textContent = root.getTextContent()
      setIsEmpty(textContent.trim().length === 0)
    })
  }, [])

  // Helper to resolve paths to absolute
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

  const extractMessageParts = useCallback(() => {
    let fullText = ""
    const mentions: Array<{
      type: "file" | "directory" | "agent" | "symbol"
      start: number
      end: number
      display: string
      metadata: any
    }> = []
    const attachments: Array<{
      id: string
      display: string
      filename: string
      mime: string
      url: string
      size: number
      start: number
      end: number
    }> = []

    editor.getEditorState().read(() => {
      const root = $getRoot()

      // Process each paragraph
      const paragraphs = root.getChildren()
      for (const paragraph of paragraphs) {
        // Process direct children of the paragraph only if it's an element node
        if (!$isElementNode(paragraph)) continue

        const children = paragraph.getChildren()

        for (const child of children) {
          if ($isMentionNode(child)) {
            // This is a mention node - add it to the text and track position
            const metadata = child.getMetadata()
            const mentionText = `@${metadata.display}`
            const start = fullText.length
            fullText += mentionText
            const end = fullText.length

            // Track this mention for later
            if (metadata.type === "file" || metadata.type === "directory" || metadata.type === "symbol") {
              mentions.push({
                type: metadata.type,
                start,
                end,
                display: mentionText,
                metadata,
              })
            } else if (metadata.type === "agent") {
              mentions.push({
                type: "agent",
                start,
                end,
                display: mentionText,
                metadata,
              })
            }
          } else if ($isAttachmentNode(child)) {
            // This is an attachment node - collect for later
            const metadata = child.getMetadata()
            // Add placeholder text for attachment and track position
            const attachmentText = `[${metadata.display}]`
            const start = fullText.length
            fullText += attachmentText
            const end = fullText.length

            attachments.push({
              id: metadata.id,
              display: metadata.display,
              filename: metadata.filename,
              mime: metadata.mime,
              url: metadata.url,
              size: metadata.size,
              start,
              end,
            })
          } else {
            // Regular text node - add to full text
            const text = child.getTextContent ? child.getTextContent() : ""
            fullText += text
          }
        }

        // Add newline between paragraphs (except for the last one)
        if (paragraph !== paragraphs[paragraphs.length - 1]) {
          fullText += "\n"
        }
      }
    })

    // Build parts array: first the text, then file/agent parts with positions
    const parts: any[] = []

    if (fullText.trim()) {
      parts.push({
        type: "text",
        text: fullText,
      })

      // Add file/agent parts with proper source.text positions
      for (const mention of mentions) {
        if (mention.type === "file" || mention.type === "directory" || mention.type === "symbol") {
          const absolutePath = resolveToAbsolutePath(mention.metadata.path)

          const withRangeUrl = (() => {
            const toFileUrl = (start?: number, end?: number) => {
              const p = absolutePath.replaceAll("\\", "/")
              if (!p) return ""
              let base = ""
              const isDrive = /^[A-Za-z]:\//.test(p)
              const isUnc = p.startsWith("//")
              if (isDrive) {
                base = `file:///${encodeURI(p)}`
              } else if (isUnc) {
                const without = p.slice(2)
                const idx = without.indexOf("/")
                const host = idx >= 0 ? without.slice(0, idx) : without
                const rest = idx >= 0 ? without.slice(idx) : ""
                const pathPart = rest || "/"
                base = `file://${host}${encodeURI(pathPart)}`
              } else {
                const pathPart = p.startsWith("/") ? p : `/${p}`
                base = `file://${encodeURI(pathPart)}`
              }
              if (typeof start === "number" && typeof end === "number") {
                return `${base}?start=${start}&end=${end}`
              }
              return base
            }
            // Prefer explicit metadata.range if present
            const r = mention.metadata?.range
            if (r && typeof r.start?.line === "number" && typeof r.end?.line === "number") {
              const start = r.start.line
              const end = r.end.line
              return toFileUrl(start, end)
            }
            // Fallback: parse from display suffix ":a-b"
            const disp: string = mention.metadata?.display || ""
            const idx = disp.lastIndexOf(":")
            if (idx > 0) {
              const tail = disp.slice(idx + 1)
              const m = tail.match(/^(\d+)-(\d+)$/)
              if (m) {
                const start = parseInt(m[1], 10)
                const end = parseInt(m[2], 10)
                if (!Number.isNaN(start) && !Number.isNaN(end)) {
                  return toFileUrl(start, end)
                }
              }
            }
            return toFileUrl()
          })()

          parts.push({
            type: "file",
            mime: "text/plain",
            filename: mention.metadata.display,
            url: withRangeUrl,
            source:
              mention.type === "symbol"
                ? {
                    type: "symbol",
                    text: {
                      value: mention.display,
                      start: mention.start,
                      end: mention.end,
                    },
                    path: absolutePath,
                    name: mention.metadata.name,
                    range: mention.metadata.range,
                    kind: mention.metadata.kind,
                  }
                : {
                    type: "file",
                    text: {
                      value: mention.display,
                      start: mention.start,
                      end: mention.end,
                    },
                    path: absolutePath,
                  },
          })
        } else if (mention.type === "agent") {
          parts.push({
            type: "agent",
            name: mention.metadata.name,
          })
        }
      }
    }

    // Add file parts for attachments with source.text positions
    for (const attachment of attachments) {
      const normalized = normalizeTextAttachment(attachment.mime, attachment.url)
      parts.push({
        type: "file",
        mime: normalized.mime,
        filename: attachment.filename,
        url: normalized.url,
        source: {
          text: {
            value: `[${attachment.display}]`,
            start: attachment.start,
            end: attachment.end,
          },
          type: "file",
          path: attachment.filename,
        },
      })
    }

    return parts
  }, [editor, resolveToAbsolutePath])

  const handleSubmit = useCallback(async () => {
    if (!sessionID || isEmpty) return

    setIsSending(true)
    setIsIdle(false)

    // Save message content before clearing (for potential restore on error)
    let savedMessage = ""
    editor.getEditorState().read(() => {
      const root = $getRoot()
      savedMessage = root.getTextContent()
    })

    try {
      // Extract parts from editor
      const parts = extractMessageParts()

      if (parts.length === 0) {
        throw new Error("No message content")
      }

      // If this is a virtual session, materialize it first
      let actualSessionID = sessionID
      if (isVirtualSession) {
        console.log("[MessageInput] Materializing virtual session before sending message...")
        const realSession = await materializeSession()
        if (!realSession) {
          throw new Error("Failed to create session")
        }
        actualSessionID = realSession.id
        console.log("[MessageInput] Virtual session materialized:", actualSessionID)
      }

      // Build request body
      const requestBody: any = {
        parts,
      }

      // Add model if selected
      if (selectedProviderId && selectedModelId) {
        requestBody.model = {
          providerID: selectedProviderId,
          modelID: selectedModelId,
        }
      }

      // Always include agent (defaults to 'build')
      requestBody.agent = selectedAgent

      // Clear editor immediately (optimistic UI)
      editor.update(() => {
        const root = $getRoot()
        root.clear()
        const paragraph = $createParagraphNode()
        root.append(paragraph)
      })

      setLastFailedMessage(null)
      onMessageSent?.()

      setTimeout(() => {
        editor.focus()
      }, 0)

      // Send message (this may take minutes, but UI is already cleared)
      const response = await sdk.session.prompt({
        path: { id: actualSessionID },
        body: requestBody,
      })

      if (response.error) {
        const errorMsg =
          "data" in response.error &&
          response.error.data &&
          typeof response.error.data === "object" &&
          "message" in response.error.data
            ? String(response.error.data.message)
            : "Failed to send message"
        throw new Error(errorMsg)
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to send message")
      console.error("[MessageInput] Failed to send message:", error)

      // Restore failed message for retry
      setLastFailedMessage(savedMessage)

      showToast(error.message, {
        title: "Failed to send message",
        variant: "error",
        duration: 8000,
      })

      onError?.(error)
      setIsIdle(true)
    } finally {
      setIsSending(false)
    }
  }, [
    sessionID,
    isEmpty,
    selectedProviderId,
    selectedModelId,
    selectedAgent,
    onMessageSent,
    onError,
    setIsIdle,
    showToast,
    isVirtualSession,
    materializeSession,
    editor,
    extractMessageParts,
  ])

  const handleRetry = useCallback(() => {
    if (lastFailedMessage) {
      editor.update(() => {
        const root = $getRoot()
        root.clear()
        const paragraph = $createParagraphNode()
        const text = $createTextNode(lastFailedMessage)
        paragraph.append(text)
        root.append(paragraph)
      })
      setLastFailedMessage(null)
      setTimeout(() => {
        editor.focus()
      }, 0)
    }
  }, [lastFailedMessage, editor])

  // Reset isSending when session changes (e.g., when user clicks "new session")
  useEffect(() => {
    setIsSending(false)
  }, [sessionID])

  const handleFileSelect = useCallback(async () => {
    fileInputRef.current?.click()
  }, [])

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files
      if (!files || files.length === 0) return

      for (const file of Array.from(files)) {
        const ext = getExtensionFromFilename(file.name)
        const mime = file.type || getMimeTypeFromExtension(ext)

        if (!isSupportedAttachmentType(mime)) {
          showToast(`File type not supported: ${file.name}`, {
            title: "Unsupported file type",
            variant: "error",
            duration: 5000,
          })
          continue
        }

        try {
          const dataUrl = await fileToDataURL(file)
          const normalized = normalizeTextAttachment(mime, dataUrl)

          const metadata = {
            id: crypto.randomUUID(),
            display: file.name,
            filename: file.name,
            mime: normalized.mime,
            url: normalized.url,
            size: file.size,
          }

          editor.update(() => {
            const selection = $getSelection()
            if ($isRangeSelection(selection)) {
              const attachmentNode = $createAttachmentNode(metadata)
              selection.insertNodes([attachmentNode])
            }
          })
        } catch {
          showToast(`Failed to read file: ${file.name}`, {
            title: "File read error",
            variant: "error",
            duration: 5000,
          })
        }
      }

      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    },
    [editor, showToast],
  )

  // Disable/enable editor based on isSending state
  useEffect(() => {
    editor.setEditable(!isSending)
  }, [editor, isSending])

  useEffect(() => {
    const el = contentEditableRef.current
    if (!el) return

    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData) return
      const plain = e.clipboardData.getData("text/plain")
      if (!plain) return
      e.preventDefault()
      e.stopPropagation()
      insertPlainWithMentionsImpl(editor, parseWithRange, plain)
    }

    el.addEventListener("paste", onPaste as any, true)
    return () => {
      el.removeEventListener("paste", onPaste as any, true)
    }
  }, [contentEditableRef.current, editor, parseWithRange])

  // Register Cmd/Ctrl+Enter command
  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if ((event?.metaKey || event?.ctrlKey) && event.key === "Enter") {
          event?.preventDefault()
          handleSubmit()
          return true
        }
        return false
      },
      COMMAND_PRIORITY_HIGH,
    )
  }, [editor, handleSubmit])

  const isDisabled = isSending
  const isButtonDisabled = isDisabled || isEmpty

  const isCompactDisabled =
    isSending ||
    isCompacting ||
    !sessionID ||
    sessionID.startsWith("virtual-") ||
    !selectedProviderId ||
    !selectedModelId

  const handleAbort = useCallback(async () => {
    if (!sessionID) return
    if (sessionID.startsWith("virtual-")) return
    try {
      await sdk.session.abort({ path: { id: sessionID } })
      setIsIdle(true)
      setIsSending(false)
      setTimeout(() => {
        editor.focus()
      }, 0)
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to abort session")
      console.error("[MessageInput] Failed to abort session:", error)
      showToast(error.message, {
        title: "Abort failed",
        variant: "error",
        duration: 6000,
      })
    }
  }, [sessionID, setIsIdle, showToast, editor])

  const handleCompact = useCallback(async () => {
    if (!sessionID) return
    if (sessionID.startsWith("virtual-")) {
      showToast("Cannot compact a virtual session. Send a message first to create the session.", {
        title: "Compaction not available",
        variant: "warning",
        duration: 6000,
      })
      setIsCompactConfirmOpen(false)
      return
    }
    if (!selectedProviderId || !selectedModelId) {
      showToast("Select a model before compacting the session.", {
        title: "Model required",
        variant: "warning",
        duration: 6000,
      })
      setIsCompactConfirmOpen(false)
      return
    }

    setIsCompacting(true)
    try {
      const response = await sdk.session.summarize({
        path: { id: sessionID },
        body: {
          providerID: selectedProviderId,
          modelID: selectedModelId,
        },
      })

      if ((response as any).error) {
        const errorData =
          (response as any).error && typeof (response as any).error === "object" && "data" in (response as any).error
            ? (response as any).error.data
            : null
        const msg =
          errorData && typeof errorData === "object" && errorData !== null && "message" in errorData
            ? String((errorData as any).message)
            : "Failed to compact session"
        showToast(msg, {
          title: "Compaction failed",
          variant: "error",
          duration: 8000,
        })
      } else {
        showToast("Session compaction started. You will see a notification when it completes.", {
          title: "Compacting session",
          variant: "info",
          duration: 5000,
        })
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to compact session")
      console.error("[MessageInput] Failed to compact session:", error)
      showToast(error.message, {
        title: "Compaction failed",
        variant: "error",
        duration: 8000,
      })
    } finally {
      setIsCompacting(false)
      setIsCompactConfirmOpen(false)
    }
  }, [sessionID, selectedProviderId, selectedModelId, showToast])

  // Attach drag-and-drop to the contentEditable
  useEffect(() => {
    const el = contentEditableRef.current
    if (!el) return

    let overCount = 0

    const addHighlight = () => {
      const box = containerRef.current
      if (!box) return
      box.classList.add("ring-2", "ring-blue-500", "border-blue-500")
    }
    const removeHighlight = () => {
      const box = containerRef.current
      if (!box) return
      box.classList.remove("ring-2", "ring-blue-500", "border-blue-500")
    }

    const onDragEnter = (ev: DragEvent) => {
      ev.preventDefault()
      overCount = overCount + 1
      addHighlight()
    }

    const onDragOver = (ev: DragEvent) => {
      ev.preventDefault()
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy"
      addHighlight()
    }

    const onDragLeave = (ev: DragEvent) => {
      ev.preventDefault()
      overCount = Math.max(0, overCount - 1)
      if (overCount === 0) removeHighlight()
    }

    const onDrop = (ev: DragEvent) => {
      ev.preventDefault()
      ev.stopPropagation()
      overCount = 0
      removeHighlight()
      const paths = extractPathsFromDrop(ev)
      if (paths && paths.length > 0) {
        // Reuse the same insertion logic as insertPaths
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
                const metadata = { type: "directory" as const, display: rel, path: rel }
                nodes.push($createMentionNode(metadata))
                nodes.push($createTextNode(" "))
                continue
              }

              const parsed = parseWithRange(raw)
              const relBase = toProjectRelative(parsed.path, worktree)
              const display = parsed.range ? `${relBase}:${parsed.range.start}-${parsed.range.end}` : relBase
              const metadata: any = { type: "file" as const, display, path: relBase }
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
      }
    }

    el.addEventListener("dragenter", onDragEnter as any)
    el.addEventListener("dragover", onDragOver as any)
    el.addEventListener("dragleave", onDragLeave as any)
    el.addEventListener("drop", onDrop as any)
    return () => {
      el.removeEventListener("dragenter", onDragEnter as any)
      el.removeEventListener("dragover", onDragOver as any)
      el.removeEventListener("dragleave", onDragLeave as any)
      el.removeEventListener("drop", onDrop as any)
    }
  }, [contentEditableRef.current, editor, worktree])

  useEffect(() => {
    let over = 0
    const add = () => {
      const box = containerRef.current
      if (!box) return
      box.classList.add("ring-2", "ring-blue-500", "border-blue-500")
    }
    const rm = () => {
      const box = containerRef.current
      if (!box) return
      box.classList.remove("ring-2", "ring-blue-500", "border-blue-500")
    }
    const onEnter = (e: DragEvent) => {
      e.preventDefault()
      over = over + 1
      add()
    }
    const onOver = (e: DragEvent) => {
      e.preventDefault()
      add()
    }
    const onLeave = (e: DragEvent) => {
      e.preventDefault()
      over = Math.max(0, over - 1)
      if (over === 0) rm()
    }
    const onEnd = () => {
      over = 0
      rm()
    }

    document.addEventListener("dragenter", onEnter as any)
    document.addEventListener("dragover", onOver as any)
    document.addEventListener("dragleave", onLeave as any)
    document.addEventListener("drop", onEnd as any)
    document.addEventListener("dragend", onEnd as any)

    return () => {
      document.removeEventListener("dragenter", onEnter as any)
      document.removeEventListener("dragover", onOver as any)
      document.removeEventListener("dragleave", onLeave as any)
      document.removeEventListener("drop", onEnd as any)
      document.removeEventListener("dragend", onEnd as any)
    }
  }, [])

  useEffect(() => {
    if (!providersDirty) return
    setModelSelectorKey((value) => value + 1)
    clearProvidersDirty()
  }, [providersDirty, clearProvidersDirty])

  return (
    <>
      <footer className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 flex-shrink-0">
        {/* Input area */}
        <div className="px-2 pt-1.5 pb-1">
          <div ref={containerRef} className="relative modern-input bg-white dark:bg-gray-900">
            <RichTextPlugin
              contentEditable={
                // @ts-expect-error React 19 type compatibility
                <ContentEditable
                  ref={contentEditableRef}
                  className="px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100 focus:outline-none min-h-[32px] max-h-[400px] overflow-y-auto"
                  style={{ caretColor: "auto" }}
                  aria-placeholder="Ask anything (Cmd/Ctrl+Enter to send)"
                  placeholder={
                    <div className="absolute top-1.5 left-2 text-sm text-gray-400 dark:text-gray-500 pointer-events-none">
                      Ask anything (Cmd/Ctrl+Enter to send)
                    </div>
                  }
                />
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            <OnChangePlugin onChange={handleEditorChange} />
            <HistoryPlugin />
            <MentionPlugin />
            <AttachmentPlugin />
          </div>
        </div>

        {/* Toolbar */}
        <div className="h-8 px-2 flex items-center justify-between border-t border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-1">
            {/* Retry button (visible when there's a failed message) */}
            {lastFailedMessage && (
              <button
                onClick={handleRetry}
                className="h-6 px-2 flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-950 rounded border border-red-200 dark:border-red-800"
                title="Restore failed message"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Retry
              </button>
            )}

            {/* Model selector */}
            <ModelSelector
              key={modelSelectorKey}
              selectedProviderId={selectedProviderId}
              selectedModelId={selectedModelId}
              onSelect={setSelectedModel}
              disabled={isDisabled}
            />

            {/* Agent selector */}
            <AgentSelector selectedAgent={selectedAgent} onSelect={setSelectedAgent} disabled={isDisabled} />

            {/* Add file button */}
            <button
              onClick={handleFileSelect}
              className="modern-icon-button w-6 h-6 flex items-center justify-center"
              disabled={isDisabled}
              title="Add file"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                />
              </svg>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,application/pdf,text/*"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {/* Compact + Send / Stop buttons */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setIsCompactConfirmOpen(true)}
              disabled={isCompactDisabled}
              className="modern-button modern-button-ghost h-6 px-2 text-xs"
              title="Compact session history"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7h16M6 12h12M8 17h8" />
              </svg>
              <span>Compact</span>
            </button>
            {isIdle ? (
              <button
                onClick={handleSubmit}
                disabled={isButtonDisabled}
                className="h-6 w-6 flex items-center justify-center text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Send (Cmd/Ctrl+Enter)"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                  />
                </svg>
              </button>
            ) : (
              <button
                onClick={handleAbort}
                className="h-6 w-6 flex items-center justify-center text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
                title="Stop generation"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="6" y="6" width="12" height="12" rx="1" ry="1" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </footer>

      <ConfirmModal
        isOpen={isCompactConfirmOpen}
        onClose={() => setIsCompactConfirmOpen(false)}
        onConfirm={handleCompact}
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
