import { useState, useCallback, useRef } from "react"
import type { Session } from "@opencode-ai/sdk/client"
import { useSession } from "../../../state/SessionContext"
import { useMessages } from "../../../state/MessagesContext"
import { useTabStore } from "../../../state/tabStore"
import { draftFromMessage, loadDrafts, saveDrafts } from "../../../state/repo/draftRepo"
import { useToast } from "../../../state/ToastContext"
import { getUserMessagePlainText } from "../utils"
import { sdk } from "../../../lib/api/sdkClient"

export function useMessageActions(sessionID: string | null | undefined, onUndoToInput?: (value: string) => void) {
  const {
    currentSession,
    isIdle,
    sessionStatusReady,
    setSessionIdle,
    forkSession,
    revertToMessage,
    unrevertSession,
    redoNext,
  } = useSession()
  const { getMessagesBySession, removeSessionErrors } = useMessages()
  const tabStore = useTabStore()
  const { showToast } = useToast()
  const pendingFork = useRef<{ sourceSessionID: string; messageID: string; fork: Session } | null>(null)
  const forkBoundary = useRef<{ sourceSessionID: string; messageID: string } | null>(null)
  const retrying = useRef(new Set<string>())

  const [forkConfirm, setForkConfirm] = useState<string | null>(null)
  const [isForking, setIsForking] = useState(false)
  const [revertAction, setRevertAction] = useState<{ type: "undo" | "redo" | "restore"; messageId?: string } | null>(
    null,
  )
  const [isRevertBusy, setIsRevertBusy] = useState(false)
  const [retryMessageID, setRetryMessageID] = useState<string | null>(null)
  const [isRetrying, setIsRetrying] = useState(false)

  const handleForkStart = useCallback(
    (messageId: string) => {
      pendingFork.current = null
      forkBoundary.current = currentSession ? { sourceSessionID: currentSession.id, messageID: messageId } : null
      setForkConfirm(messageId)
    },
    [currentSession],
  )

  const handleForkConfirm = useCallback(async () => {
    if (!forkConfirm || !currentSession) return
    const boundary = forkBoundary.current
    if (!boundary || boundary.sourceSessionID !== currentSession.id || boundary.messageID !== forkConfirm) {
      pendingFork.current = null
      forkBoundary.current = null
      setForkConfirm(null)
      return
    }

    setIsForking(true)
    try {
      const forkedSession =
        pendingFork.current?.sourceSessionID === currentSession.id && pendingFork.current.messageID === forkConfirm
          ? pendingFork.current.fork
          : await forkSession(currentSession.id, forkConfirm)
      if (!forkedSession) return
      pendingFork.current = { ...boundary, fork: forkedSession }
      const source = getMessagesBySession(currentSession.id).find((message) => message.info.id === forkConfirm)
      const draft = source ? draftFromMessage(source) : undefined
      if (draft) {
        const drafts = await loadDrafts()
        const saved = await saveDrafts({ ...drafts, [forkedSession.id]: draft })
        if (!saved.ok) throw new Error("保存分叉草稿失败")
      }
      tabStore.openTab(forkedSession.id)
      pendingFork.current = null
      forkBoundary.current = null
      setForkConfirm(null)
    } catch (error) {
      showToast(error instanceof Error ? error.message : "保存分叉草稿失败", {
        title: "分叉失败",
        variant: "error",
        duration: 8000,
      })
    } finally {
      setIsForking(false)
    }
  }, [forkConfirm, currentSession, forkSession, getMessagesBySession, showToast, tabStore])

  const handleRevert = useCallback(
    (messageId: string) => {
      if (!currentSession?.id) return
      if (isRevertBusy) return
      setRevertAction({ type: "undo", messageId })
    },
    [currentSession, isRevertBusy],
  )

  const handleRetry = useCallback(
    (messageId: string) => {
      if (!sessionID || !currentSession?.id || !sessionStatusReady || !isIdle) return
      if (retrying.current.has(sessionID)) return
      setRetryMessageID(messageId)
    },
    [currentSession, isIdle, sessionID, sessionStatusReady],
  )

  const handleRetryConfirm = useCallback(async () => {
    if (!retryMessageID || !sessionID || !currentSession?.id) return
    if (!sessionStatusReady || !isIdle || retrying.current.has(sessionID)) {
      setRetryMessageID(null)
      return
    }

    const message = getMessagesBySession(sessionID).find((item) => item.info.id === retryMessageID)
    if (!message || message.info.role !== "user") {
      setRetryMessageID(null)
      return
    }
    const draft = draftFromMessage(message)
    if (!draft) {
      setRetryMessageID(null)
      return
    }

    retrying.current.add(sessionID)
    setIsRetrying(true)
    setSessionIdle(sessionID, false)
    try {
      const response = await sdk.session.prompt({
        path: { id: sessionID },
        body: {
          // v1 and v2 SDKs share the wire shape but generate incompatible source types.
          parts: draft.parts as unknown as NonNullable<Parameters<typeof sdk.session.prompt>[0]["body"]>["parts"],
          agent: draft.agent,
          ...(draft.model
            ? {
                model: { providerID: draft.model.providerID, modelID: draft.model.modelID },
                variant: draft.model.variant,
              }
            : {}),
          ...(message.info.format ? { format: message.info.format } : {}),
          ...(message.info.system ? { system: message.info.system } : {}),
          ...(message.info.tools ? { tools: message.info.tools } : {}),
        },
      })
      if (!response.error) return
      setSessionIdle(sessionID, true)
      showToast("重试消息失败", { title: "重试失败", variant: "error", duration: 8000 })
    } catch {
      setSessionIdle(sessionID, true)
      showToast("重试消息失败", { title: "重试失败", variant: "error", duration: 8000 })
    } finally {
      retrying.current.delete(sessionID)
      setIsRetrying(false)
      setRetryMessageID(null)
    }
  }, [
    currentSession,
    getMessagesBySession,
    isIdle,
    retryMessageID,
    sessionID,
    sessionStatusReady,
    setSessionIdle,
    showToast,
  ])

  const handleRetryCancel = useCallback(() => {
    if (!isRetrying) setRetryMessageID(null)
  }, [isRetrying])

  const handleRevertConfirm = useCallback(async () => {
    if (!currentSession?.id) return
    if (!revertAction) return
    setIsRevertBusy(true)
    try {
      if (revertAction.type === "undo" && revertAction.messageId) {
        const reverted = await revertToMessage(currentSession.id, revertAction.messageId)
        if (!reverted) return
        const sid = sessionID ?? currentSession.id
        if (sid) {
          const msgs = getMessagesBySession(sid)
          const msg = msgs.find((m) => m.info.id === revertAction.messageId)
          if (msg) {
            if (onUndoToInput) {
              const plain = getUserMessagePlainText(msg)
              if (plain) onUndoToInput(plain)
            }
            removeSessionErrors(sid, msg.info.time.created)
          }
        }
      }
      if (revertAction.type === "redo") {
        const redone = await redoNext(currentSession.id)
        if (!redone) return
      }
      if (revertAction.type === "restore") {
        const restored = await unrevertSession(currentSession.id)
        if (!restored) return
      }
      setRevertAction(null)
    } finally {
      setIsRevertBusy(false)
    }
  }, [
    currentSession,
    revertAction,
    sessionID,
    getMessagesBySession,
    removeSessionErrors,
    onUndoToInput,
    revertToMessage,
    redoNext,
    unrevertSession,
  ])

  const handleRevertCancel = useCallback(() => {
    if (isRevertBusy) return
    setRevertAction(null)
  }, [isRevertBusy])

  const handleRedoClick = useCallback(() => {
    if (!currentSession?.id) return
    if (isRevertBusy) return
    setRevertAction({ type: "redo" })
  }, [currentSession, isRevertBusy])

  const handleRestoreClick = useCallback(() => {
    if (!currentSession?.id) return
    if (isRevertBusy) return
    setRevertAction({ type: "restore" })
  }, [currentSession, isRevertBusy])

  return {
    forkConfirm,
    isForking,
    revertAction,
    isRevertBusy,
    handleForkStart,
    handleForkConfirm,
    handleRevert,
    handleRetry,
    handleRetryConfirm,
    handleRetryCancel,
    isRetrying,
    retryMessageID,
    handleRevertConfirm,
    handleRevertCancel,
    handleRedoClick,
    handleRestoreClick,
    setForkConfirm,
  }
}
