import { useState, useCallback } from "react"
import { useSession } from "../../../state/SessionContext"
import { useMessages } from "../../../state/MessagesContext"
import { getUserMessagePlainText } from "../utils"

export function useMessageActions(sessionID: string | null | undefined, onUndoToInput?: (value: string) => void) {
  const { currentSession, forkSession, revertToMessage, unrevertSession, redoNext } = useSession()
  const { getMessagesBySession, removeSessionErrors } = useMessages()

  const [forkConfirm, setForkConfirm] = useState<string | null>(null)
  const [isForking, setIsForking] = useState(false)
  const [revertAction, setRevertAction] = useState<{ type: "undo" | "redo" | "restore"; messageId?: string } | null>(
    null,
  )
  const [isRevertBusy, setIsRevertBusy] = useState(false)

  const handleForkStart = useCallback((messageId: string) => {
    setForkConfirm(messageId)
  }, [])

  const handleForkConfirm = useCallback(async () => {
    if (!forkConfirm || !currentSession) return

    setIsForking(true)
    const forkedSession = await forkSession(currentSession.id, forkConfirm)
    setIsForking(false)

    if (forkedSession) {
      setForkConfirm(null)
    }
  }, [forkConfirm, currentSession, forkSession])

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
    if (revertAction.type === "undo" && revertAction.messageId) {
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
      await revertToMessage(currentSession.id, revertAction.messageId)
    }
    if (revertAction.type === "redo") {
      await redoNext(currentSession.id)
    }
    if (revertAction.type === "restore") {
      await unrevertSession(currentSession.id)
    }
    setIsRevertBusy(false)
    setRevertAction(null)
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
