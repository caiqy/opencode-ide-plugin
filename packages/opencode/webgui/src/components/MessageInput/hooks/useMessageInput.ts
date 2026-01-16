import { useState, useCallback, useEffect } from "react"
import { $getRoot, $createParagraphNode, $createTextNode, type LexicalEditor } from "lexical"
import { sdk } from "../../../lib/api/sdkClient"
import { useSession } from "../../../state/SessionContext"
import { useToast } from "../../../state/ToastContext"

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
  const [isSending, setIsSending] = useState(false)
  const [lastFailedMessage, setLastFailedMessage] = useState<string | null>(null)
  const { showToast } = useToast()
  const { setIsIdle, isVirtualSession, materializeSession } = useSession()

  // Reset isSending when session changes
  useEffect(() => {
    setIsSending(false)
  }, [sessionID])

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

      // Add variant if selected
      if (selectedVariant) {
        requestBody.variant = selectedVariant
      }

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
    selectedVariant,
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

  const handleCompact = useCallback(
    async (closeModal: () => void) => {
      if (!sessionID) return
      if (sessionID.startsWith("virtual-")) {
        showToast("Cannot compact a virtual session. Send a message first to create the session.", {
          title: "Compaction not available",
          variant: "warning",
          duration: 6000,
        })
        closeModal()
        return
      }
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
    isSending,
    lastFailedMessage,
    handleSubmit,
    handleRetry,
    handleAbort,
    handleCompact,
  }
}
