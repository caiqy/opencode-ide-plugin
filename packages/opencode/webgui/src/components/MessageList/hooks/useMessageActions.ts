import { useState, useCallback, useRef } from "react"
import type { Session } from "@opencode-ai/sdk/client"
import { useSession } from "../../../state/SessionContext"
import { useMessages } from "../../../state/MessagesContext"
import { useTabStore } from "../../../state/tabStore"
import { draftFromMessage, loadDrafts, saveDrafts } from "../../../state/repo/draftRepo"
import { useToast } from "../../../state/ToastContext"
import { getUserMessagePlainText } from "../utils"

export function useMessageActions(sessionID: string | null | undefined, onUndoToInput?: (value: string) => void) {
  const { currentSession, forkSession, revertToMessage, unrevertSession, redoNext } = useSession()
  const { getMessagesBySession, removeSessionErrors } = useMessages()
  const tabStore = useTabStore()
  const { showToast } = useToast()
  const pendingFork = useRef<{ sourceSessionID: string; messageID: string; fork: Session } | null>(null)
  const forkBoundary = useRef<{ sourceSessionID: string; messageID: string } | null>(null)

  const [forkConfirm, setForkConfirm] = useState<string | null>(null)
  const [isForking, setIsForking] = useState(false)
  const [revertAction, setRevertAction] = useState<{ type: "undo" | "redo" | "restore"; messageId?: string } | null>(
    null,
  )
  const [isRevertBusy, setIsRevertBusy] = useState(false)

  const handleForkStart = useCallback((messageId: string) => {
    pendingFork.current = null
    forkBoundary.current = currentSession ? { sourceSessionID: currentSession.id, messageID: messageId } : null
    setForkConfirm(messageId)
  }, [currentSession])

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
    handleRevertConfirm,
    handleRevertCancel,
    handleRedoClick,
    handleRestoreClick,
    setForkConfirm,
  }
}
