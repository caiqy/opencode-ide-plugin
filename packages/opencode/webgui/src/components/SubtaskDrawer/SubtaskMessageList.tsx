import { useMemo } from "react"
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

interface SubtaskMessageListProps {
  sessionID?: string | null
}

export function SubtaskMessageList({ sessionID }: SubtaskMessageListProps) {
  const { getMessagesBySession, getQuestionsBySession } = useMessages()
  const { isSessionIdle, isSessionReasoning } = useSession()

  const pendingQuestions = sessionID ? getQuestionsBySession(sessionID) : []

  const sessionMessages = sessionID ? getMessagesBySession(sessionID) : []

  const sortedMessages = [...sessionMessages].sort((a, b) => a.info.time.created - b.info.time.created)

  const isIdle = sessionID ? isSessionIdle(sessionID) : true
  const isReasoning = sessionID ? isSessionReasoning(sessionID) : false

  const { messagesEndRef, messagesContainerRef, showScrollToBottom, scrollToBottom } = useMessageScroll(
    sessionID,
    sortedMessages,
    isIdle,
    isReasoning,
  )

  const turnMetas = useMemo(() => computeAllTurnMetas(sortedMessages), [sortedMessages])

  if (!sessionID) {
    return <EmptyState />
  }

  if (sortedMessages.length === 0 && pendingQuestions.length === 0) {
    return <EmptyState />
  }

  const items: PartOpenItem[] = sortedMessages.flatMap((msg): PartOpenItem[] => {
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

  const lastMessageID = sortedMessages.at(-1)?.info.id

  return (
    <>
      <div ref={messagesContainerRef} className="min-h-full">
        <PartOpenProvider items={items}>
          <div className="space-y-4">
            {sortedMessages.map((message) => (
              <MessageRow
                key={message.info.id}
                message={message}
                sessionID={sessionID}
                isLast={message.info.id === lastMessageID}
                showMeta={!!turnMetas.get(message.info.id)}
                turnDurationMs={turnMetas.get(message.info.id)?.turnDurationMs}
              />
            ))}

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

        <ScrollToBottomButton visible={showScrollToBottom} onClick={scrollToBottom} />
      </div>
    </>
  )
}
