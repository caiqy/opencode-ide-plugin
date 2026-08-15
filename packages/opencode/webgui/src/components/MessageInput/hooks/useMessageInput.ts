import { useState, useCallback, useRef } from "react"
import { $getRoot, $createParagraphNode, type EditorState, type LexicalEditor } from "lexical"
import { sdk } from "../../../lib/api/sdkClient"
import { useSession } from "../../../state/SessionContext"
import { useToast } from "../../../state/ToastContext"
import { useMessages } from "../../../state/MessagesContext"
import { createOptimisticUserMessage, removeMessage } from "../../../lib/messagesStore"
import { loadDraftSession, saveDraftSession, type DraftPart } from "../../../state/repo/draftRepo"
import { resolveSlashInput } from "./resolveSlashInput"

function errorMessage(input: unknown, fallback: string) {
  if (input instanceof Error && input.message) return input.message
  if (!input || typeof input !== "object") return fallback
  const msg = "message" in input ? input.message : null
  if (typeof msg === "string" && msg.length > 0) return msg
  const data = "data" in input ? input.data : null
  if (!data || typeof data !== "object") return fallback
  const nested = "message" in data ? data.message : null
  if (typeof nested === "string" && nested.length > 0) return nested
  return fallback
}

interface UseMessageInputOptions {
  sessionID: string | null
  editor: LexicalEditor
  isEmpty: boolean
  selectedProviderId: string | undefined
  selectedModelId: string | undefined
  selectedAgent: string
  selectedVariant: string | undefined
  extractMessageParts: (editorState?: EditorState) => DraftPart[]
  onMessageSent?: () => void
  onError?: (error: Error) => void
}

interface EditorSubmission {
  state: EditorState
  parts: DraftPart[]
}

export function useMessageInput({
  sessionID,
  editor,
  selectedProviderId,
  selectedModelId,
  selectedAgent,
  selectedVariant,
  extractMessageParts,
  onMessageSent,
  onError,
}: UseMessageInputOptions) {
  const [failedMap, setFailedMap] = useState<Record<string, EditorState>>({})
  const { showToast } = useToast()
  const { setSessionIdle } = useSession()
  const { addMessage, setMessages, getQuestionsBySession, rejectQuestion } = useMessages()
  const seq = useRef(0)
  const submittingEditor = useRef(false)

  const lastFailedMessage = sessionID ? (failedMap[sessionID] ?? null) : null

  const setFailed = useCallback((id: string, value: EditorState | null) => {
    if (!id) return
    setFailedMap((prev) => {
      if (value === null) {
        if (!prev[id]) return prev
        const next = { ...prev }
        delete next[id]
        return next
      }
      return { ...prev, [id]: value }
    })
  }, [])

  const submitText = useCallback(
    async (saved: string, source: "editor" | "quick_phrase", submission?: EditorSubmission) => {
      if (!sessionID) return
      const text = saved.trim()
      if (!text) return
      if (source === "editor" && submittingEditor.current) return

      const id = ++seq.current
      if (source === "editor") {
        submittingEditor.current = true
        setSessionIdle(sessionID, false)
      }
      let optimistic: ReturnType<typeof createOptimisticUserMessage> | null = null

      try {
        const resolvedSlash = await resolveSlashInput(text)
        const slashCommand = resolvedSlash.mode === "command" ? resolvedSlash : null
        optimistic = !slashCommand && source === "editor" ? createOptimisticUserMessage(sessionID, text) : null

        if (source === "quick_phrase") setSessionIdle(sessionID, false)

        if (source === "editor") {
          editor.update(() => {
            const root = $getRoot()
            root.clear()
            const paragraph = $createParagraphNode()
            root.append(paragraph)
          })
          setFailed(sessionID, null)
          onMessageSent?.()
          setTimeout(() => {
            editor.focus()
          }, 0)
        }

        if (optimistic) {
          addMessage(optimistic)
        }

        if (slashCommand) {
          const request: any = {
            command: slashCommand.name,
            arguments: slashCommand.arguments,
            agent: selectedAgent,
          }
          if (selectedProviderId && selectedModelId) {
            request.model = `${selectedProviderId}/${selectedModelId}`
          }
          if (selectedVariant) {
            request.variant = selectedVariant
          }
          const response = await sdk.session.command({
            path: { id: sessionID },
            body: request,
          })
          if (response.error) {
            throw new Error(errorMessage(response.error, "Failed to execute command"))
          }
        }

        if (!slashCommand) {
          const request: any = {
            parts: source === "editor" ? submission?.parts ?? [] : [{ type: "text", text }],
            agent: selectedAgent,
          }
          if (request.parts.length === 0) {
            throw new Error("No message content")
          }
          if (selectedProviderId && selectedModelId) {
            request.model = {
              providerID: selectedProviderId,
              modelID: selectedModelId,
            }
          }
          if (selectedVariant) {
            request.variant = selectedVariant
          }
          const response = await sdk.session.prompt({
            path: { id: sessionID },
            body: request,
          })
          if (response.error) {
            throw new Error(errorMessage(response.error, "发送消息失败"))
          }
        }

        if (source === "editor") {
          const activeDraft = await loadDraftSession()
          if (activeDraft === sessionID) {
            await saveDraftSession(null)
          }
        }
      } catch (err) {
        const failedOptimistic = optimistic
        if (failedOptimistic) {
          setMessages((prev) => removeMessage(prev, failedOptimistic.info.id))
        }
        if (id !== seq.current) return
        const msg = errorMessage(err, "发送消息失败")
        const error = err instanceof Error ? err : new Error(msg)
        console.error("[MessageInput] Failed to send message:", error)
        setSessionIdle(sessionID, true)
        if (source === "editor") {
          if (submission) setFailed(sessionID, submission.state)
        }
        showToast(msg, {
          title: "发送失败",
          variant: "error",
          duration: 8000,
        })
        onError?.(error)
      } finally {
        if (source === "editor") submittingEditor.current = false
      }
    },
    [
      addMessage,
      editor,
      onError,
      onMessageSent,
      selectedAgent,
      selectedModelId,
      selectedProviderId,
      selectedVariant,
      sessionID,
      setFailed,
      setMessages,
      setSessionIdle,
      showToast,
    ],
  )

  const handleSubmit = useCallback(async () => {
    if (!sessionID) return
    const state = editor.getEditorState()
    let saved = ""
    state.read(() => {
      const root = $getRoot()
      saved = root.getTextContent()
    })
    await submitText(saved, "editor", { state, parts: extractMessageParts(state) })
  }, [editor, extractMessageParts, sessionID, submitText])

  const submitQuickPhrase = useCallback(
    async (body: string) => {
      await submitText(body, "quick_phrase")
    },
    [submitText],
  )

  const handleRetry = useCallback(() => {
    if (lastFailedMessage && sessionID) {
      editor.setEditorState(lastFailedMessage)
      setFailed(sessionID, null)
      setTimeout(() => {
        editor.focus()
      }, 0)
    }
  }, [lastFailedMessage, editor, sessionID, setFailed])

  const handleAbort = useCallback(async () => {
    if (!sessionID) return
    try {
      const response = await sdk.session.abort({ path: { id: sessionID } })
      if (response.error) {
        const message =
          typeof response.error === "object" && "message" in response.error
            ? String(response.error.message)
            : "终止会话失败"
        throw new Error(message)
      }

      const result = await Promise.allSettled(getQuestionsBySession(sessionID).map((item) => rejectQuestion(item.id)))
      if (result.some((item) => item.status === "rejected" || (item.status === "fulfilled" && item.value === false))) {
        console.warn("[MessageInput] Failed to reject question after abort")
      }
      setSessionIdle(sessionID, true)
      setTimeout(() => {
        editor.focus()
      }, 0)
    } catch (err) {
      const error = err instanceof Error ? err : new Error("终止会话失败")
      console.error("[MessageInput] Failed to abort session:", error)
      showToast(error.message, {
        title: "终止失败",
        variant: "error",
        duration: 6000,
      })
    }
  }, [sessionID, setSessionIdle, showToast, editor, getQuestionsBySession, rejectQuestion])

  const handleCompact = useCallback(
    async (closeModal: () => void) => {
      if (!sessionID) return
      if (!selectedProviderId || !selectedModelId) {
        showToast("请先选择模型再压缩会话。", {
          title: "需要模型",
          variant: "warning",
          duration: 6000,
        })
        closeModal()
        return
      }

      closeModal()

      try {
        showToast("会话压缩已开始，完成后会通知你。", {
          title: "正在压缩会话",
          variant: "info",
          duration: 5000,
        })

        const response = await sdk.session.summarize({
          path: { id: sessionID },
          body: {
            providerID: selectedProviderId,
            modelID: selectedModelId,
          },
        })

        if ((response as any).error) {
          const data =
            (response as any).error && typeof (response as any).error === "object" && "data" in (response as any).error
              ? (response as any).error.data
              : null
          const msg =
            data && typeof data === "object" && data !== null && "message" in data
              ? String((data as any).message)
              : "压缩会话失败"
          showToast(msg, {
            title: "压缩失败",
            variant: "error",
            duration: 8000,
          })
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error("压缩会话失败")
        console.error("[MessageInput] Failed to compact session:", error)
        showToast(error.message, {
          title: "压缩失败",
          variant: "error",
          duration: 8000,
        })
      }
    },
    [sessionID, selectedProviderId, selectedModelId, showToast],
  )

  return {
    lastFailedMessage,
    handleSubmit,
    submitQuickPhrase,
    handleRetry,
    handleAbort,
    handleCompact,
  }
}
