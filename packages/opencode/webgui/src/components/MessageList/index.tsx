import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react"
import { useMessages } from "../../state/MessagesContext"
import { useSession } from "../../state/SessionContext"
import { TypingIndicator } from "../TypingIndicator"
import { ConfirmModal } from "../ConfirmModal"
import { EmptyState } from "./EmptyState"
import { MessageRow } from "./MessageRow"
import { computeAllTurnMetas } from "./turnMeta"
import { RevertBanner } from "./RevertBanner"
import { RevertSummary } from "./RevertSummary"
import { QuestionPart } from "./Parts/QuestionPart"
import { useMessageScroll } from "./hooks/useMessageScroll"
import { useMessageActions } from "./hooks/useMessageActions"
import { useTopTrim } from "./hooks/useTopTrim"
import { useHistoryBlocks } from "./hooks/useHistoryBlocks"
import { PartOpenProvider, type PartOpenItem } from "./PartOpenContext"
import { ScrollToBottomButton } from "./ScrollToBottomButton"
import { mergeReasoningParts } from "./utils"

interface MessageListProps {
  sessionID?: string | null
  onUndoToInput?: (value: string) => void
  sendRequestKey?: number
}

function useSettle(id: string | null | undefined, ref: RefObject<HTMLDivElement | null>, count: number) {
  const prev = useRef<string | null | undefined>(undefined)
  const box = useRef(count)
  const [state, setState] = useState(false)
  const changed = prev.current !== id

  box.current = count

  useEffect(() => {
    prev.current = id
  }, [id])

  useLayoutEffect(() => {
    if (!id) {
      setState(false)
      return
    }

    let frame = 0
    let same = 0
    let left = 12
    let last = ""

    setState(true)

    const tick = () => {
      const parent = ref.current?.parentElement as HTMLElement | null
      const next = `${box.current}:${parent?.scrollHeight ?? -1}:${parent?.clientHeight ?? -1}`
      same = next === last ? same + 1 : 0
      last = next
      left -= 1
      if (same >= 1 || left <= 0) {
        setState(false)
        return
      }
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
    }
  }, [count, id, ref])

  return changed || state
}

export function MessageList({ sessionID, onUndoToInput, sendRequestKey = 0 }: MessageListProps) {
  const {
    getMessagesBySession,
    getQuestionsBySession,
    getSessionPagination,
    getSessionCursor = () => undefined,
    loadOlder,
    permissions = [],
  } = useMessages()
  const { isIdle, isReasoning, currentSession, sessionStatusReady } = useSession()
  const box = useRef<HTMLDivElement>(null)
  const tailRef = useRef<HTMLDivElement>(null)
  const automaticCursorRef = useRef<string | null>(null)

  const pendingQuestions = useMemo(
    () => (sessionID ? getQuestionsBySession(sessionID) : []),
    [getQuestionsBySession, sessionID],
  )
  const sessionMessages = useMemo(
    () => (sessionID ? getMessagesBySession(sessionID) : []),
    [getMessagesBySession, sessionID],
  )
  const sortedMessages = useMemo(() => {
    return [...sessionMessages].sort((a, b) => a.info.time.created - b.info.time.created)
  }, [sessionMessages])

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

  // Inline revert handling: if session has a revert boundary, hide messages at/after it
  const revertBoundaryID = currentSession?.revert?.messageID
  const page = sessionID
    ? getSessionPagination(sessionID)
    : { ready: false, latestLoading: false, olderLoading: false, olderError: false, complete: false }
  const revertBoundaryIndex = revertBoundaryID
    ? sortedMessages.findIndex((message) => message.info.id === revertBoundaryID)
    : -1
  const cursor = sessionID ? getSessionCursor(sessionID) : undefined
  const automaticCursorKey = sessionID && revertBoundaryID && cursor ? `${sessionID}:${revertBoundaryID}:${cursor}` : null

  useEffect(() => {
    if (!sessionID || !revertBoundaryID || revertBoundaryIndex >= 0) return
    if (page.complete || page.olderLoading || page.olderError) return
    if (automaticCursorKey && automaticCursorRef.current === automaticCursorKey) return
    automaticCursorRef.current = automaticCursorKey
    void loadOlder(sessionID)
  }, [
    automaticCursorKey,
    loadOlder,
    page.complete,
    page.olderError,
    page.olderLoading,
    revertBoundaryID,
    revertBoundaryIndex,
    sessionID,
  ])

  const visibleMessages = useMemo(() => {
    if (!revertBoundaryID) return sortedMessages
    if (revertBoundaryIndex < 0) return []
    return sortedMessages.slice(0, revertBoundaryIndex)
  }, [revertBoundaryID, revertBoundaryIndex, sortedMessages])
  const typing = !isIdle && !isReasoning
  const sessionInterrupted = Boolean(sessionID && sessionStatusReady && isIdle)
  const blocks = useHistoryBlocks({
    sessionID,
    messages: visibleMessages,
    questions: pendingQuestions,
    permissions,
    isTyping: typing,
  })
  const settling = useSettle(sessionID, box, sortedMessages.length)
  const tailMessages = useMemo(() => {
    return blocks.tail.flatMap((item) => (item.kind === "tail-message" ? [item.msg] : []))
  }, [blocks.tail])
  const tailKey = useMemo(() => blocks.tail.map((item) => `${item.kind}:${item.id}`).join(","), [blocks.tail])
  const ids = useMemo(() => visibleMessages.map((item) => item.info.id), [visibleMessages])
  const { messagesEndRef, messagesContainerRef, mode, showScrollToBottom, scrollToBottom, runProgrammaticScroll } =
    useMessageScroll(
      sessionID,
      tailMessages,
      isIdle,
      isReasoning,
      settling,
      box,
      tailRef,
      revertBoundaryID ? `${tailKey}:revert:${revertBoundaryID}` : tailKey,
      sendRequestKey,
    )

  const trim = useTopTrim({
    sessionID,
    items: blocks.history,
    ids,
    loading: page.olderLoading,
    paused: settling,
    preserveScrollAnchor: mode === "detached",
    ref: messagesContainerRef,
    runProgrammaticScroll,
  })

  useLayoutEffect(() => {
    const parent = messagesContainerRef.current?.parentElement as HTMLElement | null
    if (!parent) return
    const prev = parent.style.overflowAnchor
    parent.style.overflowAnchor = "none"
    return () => {
      parent.style.overflowAnchor = prev
    }
  }, [messagesContainerRef, sessionID])

  const items = useMemo(() => {
    return visibleMessages.flatMap((msg): PartOpenItem[] => {
      return mergeReasoningParts(msg.parts).flatMap((part): PartOpenItem[] => {
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
  }, [visibleMessages])

  const lastMessageID = visibleMessages.at(-1)?.info.id
  const turnMetas = useMemo(() => computeAllTurnMetas(visibleMessages), [visibleMessages])

  const renderRow = useCallback(
    (
      message: (typeof visibleMessages)[number],
      trim?: (node: HTMLDivElement | null) => void,
      kind?: "history-message" | "history-summary" | "tail-message",
    ) => {
      const isSummaryAssistant =
        !revertBoundaryID &&
        (kind === "history-summary" ||
          ((message.info as { summary?: boolean }).summary === true && kind === "tail-message"))

      return (
        <div key={message.info.id} ref={trim} data-testid="trim-row" className="flow-root">
          {isSummaryAssistant && (
            <div className="flex items-center py-4">
              <div className="flex-1 border-t border-dashed border-gray-300 dark:border-gray-700" />
              <span className="mx-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">会话已在此精简</span>
              <div className="flex-1 border-t border-dashed border-gray-300 dark:border-gray-700" />
            </div>
          )}
          <MessageRow
            message={message}
            onFork={handleForkStart}
            onRevert={handleRevert}
            revertBusy={isRevertBusy}
            sessionID={sessionID || undefined}
            isLast={message.info.id === lastMessageID}
            showMeta={!!turnMetas.get(message.info.id)}
            turnDurationMs={turnMetas.get(message.info.id)?.turnDurationMs}
            sessionInterrupted={sessionInterrupted}
          />
        </div>
      )
    },
    [handleForkStart, handleRevert, isRevertBusy, lastMessageID, revertBoundaryID, sessionID, sessionInterrupted, turnMetas],
  )

  const rows = useMemo(() => {
    return trim.visible.map((item) => renderRow(item.msg, trim.row(item.id), item.kind))
  }, [renderRow, trim])

  const tail = useMemo(() => {
    return blocks.tail.map((item) => {
      if (item.kind === "tail-message") return renderRow(item.msg, trim.row(item.id), item.kind)
      if (item.kind === "tail-question") {
        return (
          <div key={item.id} className="px-4">
            <QuestionPart request={item.question} />
          </div>
        )
      }
      return typing ? <TypingIndicator key={item.id} visible /> : null
    })
  }, [blocks.tail, renderRow, trim, typing])

  const bar = useMemo(() => {
    if (!page.ready) return null
    if (page.complete) return null
    if (page.olderError) return { text: "加载失败，点击重试", disabled: false }
    if (page.olderLoading) return { text: "正在加载…", disabled: true }
    return { text: "加载更早消息", disabled: false }
  }, [page.complete, page.olderError, page.olderLoading, page.ready])

  const onOlder = useCallback(() => {
    if (!sessionID || !bar || bar.disabled) return
    trim.preparePrepend()
    void loadOlder(sessionID)
  }, [bar, loadOlder, sessionID, trim])

  if (!sessionID || (visibleMessages.length === 0 && blocks.tail.length === 0 && !currentSession?.revert?.messageID)) {
    return <EmptyState />
  }

  return (
    <>
      <div data-testid="message-scroll-shell" ref={messagesContainerRef} className="min-h-full">
        <PartOpenProvider items={items}>
          <div data-testid="message-scroll-root" className="flex flex-col gap-4">
            <div data-testid="history-zone">
              <div ref={trim.topRef} />
              <div data-testid="history-trim-spacer" style={{ height: trim.top }} />
              {bar && (
                <button
                  data-testid="history-load-bar"
                  type="button"
                  disabled={bar.disabled}
                  onClick={onOlder}
                  className="flex w-full items-center justify-center px-4 py-2 text-sm text-gray-500 dark:text-gray-400"
                >
                  {bar.text}
                </button>
              )}
              <div data-testid="history-rows" className="flex flex-col gap-3">
                {rows}
              </div>
            </div>
            {/* Revert banner (pinned to top of scroll area) */}
            {currentSession?.revert?.messageID && (
              <RevertBanner onRedo={handleRedoClick} onRestore={handleRestoreClick} isRevertBusy={isRevertBusy} />
            )}

            {revertBoundaryID && (
              <RevertSummary onRedo={handleRedoClick} onRestore={handleRestoreClick} isRevertBusy={isRevertBusy} />
            )}

            <div ref={tailRef} data-testid="tail-zone">
              <div data-testid="tail-rows" className="flex flex-col gap-3">
                {tail}
              </div>
              <div data-testid="tail-anchor" ref={messagesEndRef} />
            </div>
          </div>
        </PartOpenProvider>
      </div>

      {showScrollToBottom && (
        <div
          data-testid="scroll-to-bottom-layer"
          className="pointer-events-none sticky bottom-0 z-30 flex h-0 justify-end pr-2"
        >
          <div data-testid="scroll-to-bottom-offset" className="-translate-y-[calc(100%+2rem)]">
            <ScrollToBottomButton visible={showScrollToBottom} onClick={scrollToBottom} />
          </div>
        </div>
      )}

      {/* Fork confirmation modal */}
      <ConfirmModal
        isOpen={!!forkConfirm}
        onClose={() => setForkConfirm(null)}
        onConfirm={handleForkConfirm}
        title="从此处新建会话"
        message="要基于截至此处的消息新建会话吗？这会复制当前对话历史。"
        confirmText="新建"
        cancelText="取消"
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
            ? "撤销会话变更"
            : revertAction?.type === "redo"
              ? "重做会话变更"
              : revertAction?.type === "restore"
                ? "恢复全部变更"
                : ""
        }
        message={
          revertAction?.type === "undo"
            ? "要撤销此消息之后的消息和文件变更吗？"
            : revertAction?.type === "redo"
              ? "要重做下一批已撤销的消息和文件变更吗？"
              : revertAction?.type === "restore"
                ? "要恢复此前已撤销的全部消息和文件变更吗？"
                : ""
        }
        confirmText={
          revertAction?.type === "undo"
            ? "撤销"
            : revertAction?.type === "redo"
              ? "重做"
              : revertAction?.type === "restore"
                ? "恢复"
                : "确认"
        }
        cancelText="取消"
        variant="warning"
        isLoading={isRevertBusy}
      />
    </>
  )
}
