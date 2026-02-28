import { useState, useCallback, useRef } from "react"
import { $getRoot, $createParagraphNode, $createTextNode, type LexicalEditor } from "lexical"
import { sdk } from "../../../lib/api/sdkClient"
import { useSession } from "../../../state/SessionContext"
import { useToast } from "../../../state/ToastContext"
import { useMessages } from "../../../state/MessagesContext"
import { createOptimisticUserMessage, removeMessage } from "../../../lib/messagesStore"
import { loadDraftSession, saveDraftSession } from "../../../state/repo/draftRepo"

interface UseMessageInputOptions {
  sessionID: string | null
  editor: LexicalEditor
  isEmpty: boolean
  selectedProviderId: string | undefined
  selectedModelId: string | undefined
  selectedAgent: string
  selectedVariant: string | undefined
  extractMessageParts: () => any[]
  onMessageSent?: () => void
  onError?: (error: Error) => void
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
  const [failedMap, setFailedMap] = useState<Record<string, string>>({})
  const { showToast } = useToast()
  const { setSessionIdle } = useSession()
  const { addMessage, setMessages, getQuestionsBySession, rejectQuestion } = useMessages()
  const seq = useRef(0)

  const lastFailedMessage = sessionID ? (failedMap[sessionID] ?? null) : null

  const setFailed = useCallback((id: string, value: string | null) => {
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
    async (saved: string, source: "editor" | "quick_phrase") => {
      if (!sessionID) return
      const text = saved.trim()
      if (!text) return
      const id = ++seq.current
      const command = text.startsWith("/")
      const optimistic = !command && source === "editor" ? createOptimisticUserMessage(sessionID, text) : null

      setSessionIdle(sessionID, false)

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

      try {
        if (command) {
          const parts = text.slice(1).split(/\s+/)
          const request: any = {
            command: parts[0],
            arguments: parts.slice(1).join(" "),
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
            const message =
              "data" in response.error &&
              response.error.data &&
              typeof response.error.data === "object" &&
              "message" in response.error.data
                ? String(response.error.data.message)
                : "Failed to execute command"
            throw new Error(message)
          }
        }

        if (!command) {
          const request: any = {
            parts: source === "editor" ? extractMessageParts() : [{ type: "text", text }],
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
            const message =
              "data" in response.error &&
              response.error.data &&
              typeof response.error.data === "object" &&
              "message" in response.error.data
                ? String(response.error.data.message)
                : "Failed to send message"
            throw new Error(message)
          }
        }

        if (source === "editor") {
          const activeDraft = await loadDraftSession()
          if (activeDraft === sessionID) {
            await saveDraftSession(null)
          }
        }
      } catch (err) {
        if (optimistic) {
          setMessages((prev) => removeMessage(prev, optimistic.info.id))
        }
        if (id !== seq.current) return
        const error = err instanceof Error ? err : new Error("Failed to send message")
        console.error("[MessageInput] Failed to send message:", error)
        if (source === "editor") {
          setFailed(sessionID, saved)
        }
        showToast(error.message, {
          title: "Failed to send message",
          variant: "error",
          duration: 8000,
        })
        onError?.(error)
        setSessionIdle(sessionID, true)
      }
    },
    [
      addMessage,
      editor,
      extractMessageParts,
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
    let saved = ""
    editor.getEditorState().read(() => {
      const root = $getRoot()
      saved = root.getTextContent()
    })
    await submitText(saved, "editor")
  }, [editor, sessionID, submitText])

  const submitQuickPhrase = useCallback(
    async (body: string) => {
      await submitText(body, "quick_phrase")
    },
    [submitText],
  )

  const handleRetry = useCallback(() => {
    if (lastFailedMessage && sessionID) {
      editor.update(() => {
        const root = $getRoot()
        root.clear()
        const paragraph = $createParagraphNode()
        const text = $createTextNode(lastFailedMessage)
        paragraph.append(text)
        root.append(paragraph)
      })
      setFailed(sessionID, null)
      setTimeout(() => {
        editor.focus()
      }, 0)
    }
  }, [lastFailedMessage, editor, sessionID, setFailed])

  const handleAbort = useCallback(async () => {
    if (!sessionID) return
    try {
      const result = await Promise.allSettled(getQuestionsBySession(sessionID).map((item) => rejectQuestion(item.id)))

      if (result.some((item) => item.status === "rejected")) {
        console.warn("[MessageInput] Failed to reject question before abort")
      }
      if (result.some((item) => item.status === "fulfilled" && item.value === false)) {
        console.warn("[MessageInput] Question reject returned false before abort")
      }

      await sdk.session.abort({ path: { id: sessionID } })
      setSessionIdle(sessionID, true)
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
      setSessionIdle(sessionID, true)
    }
  }, [sessionID, setSessionIdle, showToast, editor, getQuestionsBySession, rejectQuestion])

  const handleCompact = useCallback(
    async (closeModal: () => void) => {
      if (!sessionID) return
      if (!selectedProviderId || !selectedModelId) {
        showToast("Select a model before compacting the session.", {
          title: "Model required",
          variant: "warning",
          duration: 6000,
        })
        closeModal()
        return
      }

      closeModal()

      try {
        showToast("Session compaction started. You will see a notification when it completes.", {
          title: "Compacting session",
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
              : "Failed to compact session"
          showToast(msg, {
            title: "Compaction failed",
            variant: "error",
            duration: 8000,
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
