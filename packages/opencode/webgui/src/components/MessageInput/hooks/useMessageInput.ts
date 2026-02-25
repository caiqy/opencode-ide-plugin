import { useState, useCallback } from "react"
import { $getRoot, $createParagraphNode, $createTextNode, type LexicalEditor } from "lexical"
import { sdk } from "../../../lib/api/sdkClient"
import { useSession } from "../../../state/SessionContext"
import { useToast } from "../../../state/ToastContext"
import { useMessages } from "../../../state/MessagesContext"
import { createOptimisticUserMessage, removeOptimisticMessages } from "../../../lib/messagesStore"
import { uiBridgeDraftSessionId, uiBridgeUpdateDraftSessionId } from "../../../state/uiBridgeState"

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
  isEmpty,
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

  const handleSubmit = useCallback(async () => {
    if (!sessionID || isEmpty) return

    setSessionIdle(sessionID, false)

    let savedMessage = ""
    editor.getEditorState().read(() => {
      const root = $getRoot()
      savedMessage = root.getTextContent()
    })

    try {
      const trimmedMessage = savedMessage.trim()
      const isCommand = trimmedMessage.startsWith("/")

      editor.update(() => {
        const root = $getRoot()
        root.clear()
        const paragraph = $createParagraphNode()
        root.append(paragraph)
      })

      setFailed(sessionID, null)
      onMessageSent?.()

      // Optimistic update: show user message immediately without waiting for SSE
      if (!isCommand) {
        addMessage(createOptimisticUserMessage(sessionID, trimmedMessage))
      }

      setTimeout(() => {
        editor.focus()
      }, 0)

      if (isCommand) {
        const commandParts = trimmedMessage.slice(1).split(/\s+/)
        const commandName = commandParts[0]
        const commandArgs = commandParts.slice(1).join(" ")

        const requestBody: any = {
          command: commandName,
          // Server schema requires `arguments` even if empty
          arguments: commandArgs,
        }

        if (selectedProviderId && selectedModelId) {
          requestBody.model = `${selectedProviderId}/${selectedModelId}`
        }

        requestBody.agent = selectedAgent

        if (selectedVariant) {
          requestBody.variant = selectedVariant
        }

        const response = await sdk.session.command({
          path: { id: sessionID },
          body: requestBody,
        })

        if (response.error) {
          const errorMsg =
            "data" in response.error &&
            response.error.data &&
            typeof response.error.data === "object" &&
            "message" in response.error.data
              ? String(response.error.data.message)
              : "Failed to execute command"
          throw new Error(errorMsg)
        }
      } else {
        const parts = extractMessageParts()

        if (parts.length === 0) {
          throw new Error("No message content")
        }

        const requestBody: any = {
          parts,
        }

        if (selectedProviderId && selectedModelId) {
          requestBody.model = {
            providerID: selectedProviderId,
            modelID: selectedModelId,
          }
        }

        requestBody.agent = selectedAgent

        if (selectedVariant) {
          requestBody.variant = selectedVariant
        }

        const response = await sdk.session.prompt({
          path: { id: sessionID },
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
      }

      if (uiBridgeDraftSessionId() === sessionID) {
        uiBridgeUpdateDraftSessionId(null)
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Failed to send message")
      console.error("[MessageInput] Failed to send message:", error)

      // Restore failed message for retry
      setFailed(sessionID, savedMessage)

      // Remove optimistic message on failure
      setMessages((prev) => removeOptimisticMessages(prev, sessionID))

      showToast(error.message, {
        title: "Failed to send message",
        variant: "error",
        duration: 8000,
      })

      onError?.(error)
      setSessionIdle(sessionID, true)
    }
  }, [
    sessionID,
    isEmpty,
    selectedProviderId,
    selectedModelId,
    selectedAgent,
    selectedVariant,
    onMessageSent,
    onError,
    setSessionIdle,
    showToast,
    editor,
    extractMessageParts,
    setFailed,
    addMessage,
    setMessages,
  ])

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
    handleRetry,
    handleAbort,
    handleCompact,
  }
}
