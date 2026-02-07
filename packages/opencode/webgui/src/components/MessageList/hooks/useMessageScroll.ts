import { useEffect, useMemo, useRef, useCallback } from "react"
import type { Message } from "../../../state/MessagesContext"

export function useMessageScroll(
  sessionID: string | null | undefined,
  sortedMessages: Message[],
  isIdle: boolean,
  isReasoning: boolean,
) {
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const isUserAtBottomRef = useRef(true)
  const hasInitializedRef = useRef(false)

  const scrollSignature = useMemo(() => {
    const messagesSignature = sortedMessages
      .map((message) => {
        const partsSignature = message.parts
          .map((part) => {
            const base = `${part.id}:${part.type}`
            const textValue = (part as { text?: string }).text
            const length = typeof textValue === "string" ? textValue.length : 0
            const toolState = (part as { state?: { status?: string; output?: string; metadata?: { output?: string } } })
              .state
            const status = typeof toolState?.status === "string" ? toolState.status : ""
            const outputLength = typeof toolState?.output === "string" ? toolState.output.length : 0
            const metadataOutputLength =
              typeof toolState?.metadata?.output === "string" ? toolState.metadata.output.length : 0
            return `${base}:${length}:${status}:${outputLength}:${metadataOutputLength}`
          })
          .join(",")
        return `${message.info.id}:${message.parts.length}:${partsSignature}`
      })
      .join("|")
    // Include idle and reasoning states so indicator appearance/disappearance triggers scroll
    return `${messagesSignature}:idle=${isIdle}:think=${isReasoning}`
  }, [sortedMessages, isIdle, isReasoning])

  const updateScrollState = useCallback(() => {
    const container = messagesContainerRef.current?.parentElement as HTMLElement | null
    if (!container) return
    const distance = container.scrollHeight - container.clientHeight - container.scrollTop
    const threshold = 48
    const isNearBottom = distance <= threshold
    isUserAtBottomRef.current = isNearBottom
  }, [])

  useEffect(() => {
    const container = messagesContainerRef.current?.parentElement as HTMLElement | null
    if (!container) return
    const handleScroll = () => {
      updateScrollState()
    }
    container.addEventListener("scroll", handleScroll)
    updateScrollState()
    return () => {
      container.removeEventListener("scroll", handleScroll)
    }
  }, [sessionID, updateScrollState])

  useEffect(() => {
    const anchor = messagesEndRef.current
    if (!anchor) return
    const shouldScroll = isUserAtBottomRef.current || !hasInitializedRef.current
    if (!shouldScroll) return
    const behavior: ScrollBehavior = hasInitializedRef.current ? "smooth" : "auto"
    anchor.scrollIntoView({ behavior, block: "end" })
    hasInitializedRef.current = true
    isUserAtBottomRef.current = true
  }, [scrollSignature, sessionID])

  return { messagesEndRef, messagesContainerRef }
}
