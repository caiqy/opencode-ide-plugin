import { useEffect } from "react"
import { useMessages } from "../../state/MessagesContext"
import { useSession } from "../../state/SessionContext"
import { useUISettings } from "../../state/UISettingsContext"
import { TypingIndicator } from "../TypingIndicator"
import { ConfirmModal } from "../ConfirmModal"
import { EmptyState } from "./EmptyState"
import { MessageRow } from "./MessageRow"
import { RevertBanner } from "./RevertBanner"
import { RevertSummary } from "./RevertSummary"
import { QuestionPart } from "./Parts/QuestionPart"
import { useMessageScroll } from "./hooks/useMessageScroll"
import { useMessageActions } from "./hooks/useMessageActions"
import { PartOpenProvider, type PartOpenItem } from "./PartOpenContext"

interface MessageListProps {
  sessionID?: string | null
  onUndoToInput?: (value: string) => void
}

export function MessageList({ sessionID, onUndoToInput }: MessageListProps) {
  const { getMessagesBySession, messages, getQuestionsBySession } = useMessages()
  const { isIdle, isReasoning, currentSession } = useSession()
  const { autoExpandMessageParts } = useUISettings()

  // Get pending questions for current session
  const pendingQuestions = sessionID ? getQuestionsBySession(sessionID) : []

  // Debug logging for isIdle state
  useEffect(() => {
    console.log("[MessageList] isIdle state changed:", isIdle)
  }, [isIdle])

  // Get messages for current session
  const sessionMessages = sessionID ? getMessagesBySession(sessionID) : []

  // Debug logging
  useEffect(() => {
    console.log("[MessageList] Debug info:", {
      sessionID,
      totalMessages: messages.length,
      sessionMessages: sessionMessages.length,
      messageSessionIDs: messages.map((m) => ({ id: m.info.id, sessionID: m.info.sessionID })),
    })
  }, [sessionID, messages, sessionMessages])

  // Sort messages by creation time
  const sortedMessages = [...sessionMessages].sort((a, b) => {
    return a.info.time.created - b.info.time.created
  })

  const { messagesEndRef, messagesContainerRef } = useMessageScroll(sessionID, sortedMessages, isIdle, isReasoning)

  const {
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
  } = useMessageActions(sessionID, onUndoToInput)

  // Show empty state if no messages
  if (!sessionID || sortedMessages.length === 0) {
    return <EmptyState />
  }

  // Inline revert handling: if session has a revert boundary, hide messages at/after it
  const revertBoundaryID = currentSession?.revert?.messageID

  const visibleMessages = (() => {
    if (!revertBoundaryID) return sortedMessages
    const index = sortedMessages.findIndex((m) => m.info.id === revertBoundaryID)
    if (index === -1) return sortedMessages
    return sortedMessages.slice(0, index)
  })()

  const items: PartOpenItem[] = visibleMessages.flatMap((msg): PartOpenItem[] => {
    return msg.parts.flatMap((part): PartOpenItem[] => {
      if (part.type === "reasoning") {
        return [{ type: "reasoning", id: part.id, text: part.text, end: part.time?.end }]
      }
      if (part.type === "tool") {
        const status = part.state?.status
        const safe = status === "pending" || status === "running" || status === "completed" || status === "error"
        return [{ type: "tool", id: part.id, tool: part.tool, status: safe ? status : undefined }]
      }
      return []
    })
  })

  const lastMessageID = visibleMessages.at(-1)?.info.id

  // Build rows with optional inline reverted summary block
  const rows: React.ReactNode[] = []
  let insertedRevertSummary = false
  if (revertBoundaryID) {
    for (const message of sortedMessages) {
      if (!insertedRevertSummary && message.info.id === revertBoundaryID) {
        // Insert a compact inline summary and stop rendering further messages
        rows.push(
          <RevertSummary
            key="revert-summary"
            onRedo={handleRedoClick}
            onRestore={handleRestoreClick}
            isRevertBusy={isRevertBusy}
          />,
        )
        insertedRevertSummary = true
        break
      }
      rows.push(
        <MessageRow
          key={message.info.id}
          message={message}
          onFork={handleForkStart}
          onRevert={handleRevert}
          revertBusy={isRevertBusy}
          sessionID={sessionID || undefined}
          isLast={message.info.id === lastMessageID}
        />,
      )
    }
  } else {
    for (const message of sortedMessages) {
      const isSummaryAssistant =
        message.info.role === "assistant" && (message.info as { summary?: boolean }).summary === true

      if (isSummaryAssistant) {
        rows.push(
          <div key={`${message.info.id}-summary-separator`} className="flex items-center my-4">
            <div className="flex-1 border-t border-dashed border-gray-300 dark:border-gray-700" />
            <span className="mx-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
              Conversation compacted here
            </span>
            <div className="flex-1 border-t border-dashed border-gray-300 dark:border-gray-700" />
          </div>,
        )
      }

      rows.push(
        <MessageRow
          key={message.info.id}
          message={message}
          onFork={handleForkStart}
          onRevert={handleRevert}
          revertBusy={isRevertBusy}
          sessionID={sessionID || undefined}
          isLast={message.info.id === lastMessageID}
        />,
      )
    }
  }

  return (
    <>
      <div ref={messagesContainerRef} className="h-full">
        <PartOpenProvider items={items} defaultExpanded={autoExpandMessageParts}>
          <div className="space-y-2">
            {/* Revert banner (pinned to top of scroll area) */}
            {currentSession?.revert?.messageID && (
              <RevertBanner onRedo={handleRedoClick} onRestore={handleRestoreClick} isRevertBusy={isRevertBusy} />
            )}

            {rows}

            {/* Pending questions from server */}
            {pendingQuestions.map((question) => (
              <div key={question.id} className="px-4">
                <QuestionPart request={question} />
              </div>
            ))}

            {/* Typing indicator - hide while reasoning parts are streaming */}
            <TypingIndicator visible={!isIdle && !isReasoning} />
            {/* Scroll anchor */}
            <div ref={messagesEndRef} />
          </div>
        </PartOpenProvider>
      </div>

      {/* Fork confirmation modal */}
      <ConfirmModal
        isOpen={!!forkConfirm}
        onClose={() => setForkConfirm(null)}
        onConfirm={handleForkConfirm}
        title="Fork Session"
        message="Create a new session with messages up to this point? This will create a copy of the conversation history."
        confirmText="Fork"
        cancelText="Cancel"
        variant="info"
        isLoading={isForking}
      />

      {/* Revert / Redo / Restore confirmation modal */}
      <ConfirmModal
        isOpen={!!revertAction}
        onClose={handleRevertCancel}
        onConfirm={handleRevertConfirm}
        title={
          revertAction?.type === "undo"
            ? "Undo session changes"
            : revertAction?.type === "redo"
              ? "Redo session changes"
              : revertAction?.type === "restore"
                ? "Restore all changes"
                : ""
        }
        message={
          revertAction?.type === "undo"
            ? "Undo messages and file changes after this message?"
            : revertAction?.type === "redo"
              ? "Redo the next undone messages and file changes?"
              : revertAction?.type === "restore"
                ? "Restore all previously undone messages and file changes?"
                : ""
        }
        confirmText={
          revertAction?.type === "undo"
            ? "Undo"
            : revertAction?.type === "redo"
              ? "Redo"
              : revertAction?.type === "restore"
                ? "Restore"
                : "Confirm"
        }
        cancelText="Cancel"
        variant="warning"
        isLoading={isRevertBusy}
      />
    </>
  )
}
