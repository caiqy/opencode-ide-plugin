import { useEffect, useMemo } from "react"
import { useMessages } from "../../state/MessagesContext"
import { useSession } from "../../state/SessionContext"
import { computeAllTurnMetas } from "../MessageList/turnMeta"
import { TypingIndicator } from "../TypingIndicator"
import { EmptyState } from "../MessageList/EmptyState"
import { MessageRow } from "../MessageList/MessageRow"
import { QuestionPart } from "../MessageList/Parts/QuestionPart"
import { PartOpenProvider, type PartOpenItem } from "../MessageList/PartOpenContext"
import { ScrollToBottomButton } from "../MessageList/ScrollToBottomButton"
import { useMessageScroll } from "../MessageList/hooks/useMessageScroll"
import { mergeReasoningParts } from "../MessageList/utils"

interface SubtaskMessageListProps {
  sessionID?: string | null
}

export function SubtaskMessageList({ sessionID }: SubtaskMessageListProps) {
  const { getMessagesBySession, getQuestionsBySession } = useMessages()
  const { isSessionIdle, isSessionReasoning, sessionStatusReady } = useSession()

  const pendingQuestions = sessionID ? getQuestionsBySession(sessionID) : []

  const sessionMessages = sessionID ? getMessagesBySession(sessionID) : []

  const sortedMessages = [...sessionMessages].sort((a, b) => a.info.time.created - b.info.time.created)

  const isIdle = sessionID ? isSessionIdle(sessionID) : true
  const isReasoning = sessionID ? isSessionReasoning(sessionID) : false
  const sessionInterrupted = Boolean(sessionID && sessionStatusReady && isIdle)
  const generationStartedAt = sortedMessages.filter((message) => message.info.role === "user").at(-1)?.info.time.created

  const { messagesEndRef, messagesContainerRef, showScrollToBottom, scrollToBottom } = useMessageScroll(
    sessionID,
    sortedMessages,
    isIdle,
    isReasoning,
  )

  // Scroll to bottom when the component mounts (belt-and-suspenders on top of
  // the scroll-signature effect in useMessageScroll).  The effect fires once
  // scrollToBottom stabilises (after containerNode is set by useLayoutEffect).
  useEffect(() => {
    scrollToBottom()
  }, [scrollToBottom])

  const turnMetas = useMemo(
    () => computeAllTurnMetas(sortedMessages, sessionInterrupted),
    [sessionInterrupted, sortedMessages],
  )

  if (!sessionID) {
    return <EmptyState />
  }

  if (sortedMessages.length === 0 && pendingQuestions.length === 0) {
    return <EmptyState />
  }

  const items: PartOpenItem[] = sortedMessages.flatMap((msg): PartOpenItem[] => {
    return mergeReasoningParts(msg.parts).flatMap((part): PartOpenItem[] => {
      if (part.type === "reasoning") {
        return [{ type: "reasoning", id: part.id, text: part.text, end: part.time?.end }]
      }
      if (part.type === "tool") {
        const status = part.state?.status
        const safe = status === "pending" || status === "running" || status === "completed" || status === "error"
        const stateMetadata = status === "pending" ? undefined : part.state.metadata
        const metadata = part.metadata || stateMetadata ? { ...part.metadata, ...stateMetadata } : undefined
        return [
          {
            type: "tool",
            id: part.id,
            tool: part.tool,
            status: safe ? status : undefined,
            metadata,
          },
        ]
      }
      return []
    })
  })

  const lastMessageID = sortedMessages.at(-1)?.info.id

  return (
    <>
      <div ref={messagesContainerRef} className="min-h-full">
        <PartOpenProvider items={items}>
          <div className="flex flex-col gap-3">
            {sortedMessages.map((message) => (
              <MessageRow
                key={message.info.id}
                message={message}
                userActionMode="copy"
                sessionID={sessionID}
                isLast={message.info.id === lastMessageID}
                showMeta={!!turnMetas.get(message.info.id)}
                turnDurationMs={turnMetas.get(message.info.id)?.turnDurationMs}
                sessionInterrupted={sessionInterrupted}
              />
            ))}

            {/* Pending questions from server */}
            {pendingQuestions.map((question) => (
              <div key={question.id} className="px-4">
                <QuestionPart request={question} />
              </div>
            ))}

            <TypingIndicator visible={!isIdle} startedAt={generationStartedAt} />

            {/* Scroll anchor */}
            <div ref={messagesEndRef} />
          </div>
        </PartOpenProvider>

        {showScrollToBottom && (
          <div
            data-testid="subtask-scroll-to-bottom-layer"
            className="pointer-events-none sticky bottom-4 z-30 flex justify-end pr-2"
          >
            <ScrollToBottomButton visible={showScrollToBottom} onClick={scrollToBottom} />
          </div>
        )}
      </div>
    </>
  )
}
