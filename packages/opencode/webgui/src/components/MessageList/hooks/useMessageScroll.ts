import { useEffect, useMemo, useRef, useCallback, useState } from "react"
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
  const lastScrollTopRef = useRef<number | null>(null)
  // Tracks user intent to scroll away (set by wheel/touch/scrollbar/keyboard)
  const userScrolledRef = useRef(false)
  // Flag: true while a programmatic smooth-scroll is in progress
  const isProgrammaticScrollRef = useRef(false)
  // Safety timeout to clear the programmatic flag if scroll never reaches bottom
  const programmaticTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reactive state for "scroll to bottom" button visibility
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)

  const scrollSignature = useMemo(() => {
    const lastMessage = sortedMessages.at(-1)
    const lastMessageID = lastMessage?.info.id ?? ""
    const lastPartsSignature =
      lastMessage?.parts
        .map((part) => {
          const base = `${part.id}:${part.type}`
          const textValue = (part as { text?: string }).text
          const textLength = typeof textValue === "string" ? textValue.length : 0
          const toolState = (part as { state?: { status?: string; output?: string; metadata?: { output?: string } } })
            .state
          const status = typeof toolState?.status === "string" ? toolState.status : ""
          const outputLength = typeof toolState?.output === "string" ? toolState.output.length : 0
          const metadataOutputLength =
            typeof toolState?.metadata?.output === "string" ? toolState.metadata.output.length : 0
          return `${base}:${textLength}:${status}:${outputLength}:${metadataOutputLength}`
        })
        .join(",") ?? ""
    // Include idle and reasoning states so indicator appearance/disappearance triggers scroll
    return `${sortedMessages.length}:${lastMessageID}:${lastMessage?.parts.length ?? 0}:${lastPartsSignature}:idle=${isIdle}:think=${isReasoning}`
  }, [sortedMessages, isIdle, isReasoning])

  const clearProgrammaticFlag = useCallback(() => {
    isProgrammaticScrollRef.current = false
    if (programmaticTimeoutRef.current) {
      clearTimeout(programmaticTimeoutRef.current)
      programmaticTimeoutRef.current = null
    }
  }, [])

  const updateScrollState = useCallback(() => {
    const container = messagesContainerRef.current?.parentElement as HTMLElement | null
    if (!container) return

    const currentScrollTop = container.scrollTop
    const previousScrollTop = lastScrollTopRef.current
    const movedUp = previousScrollTop !== null && currentScrollTop < previousScrollTop - 1
    lastScrollTopRef.current = currentScrollTop

    const distance = container.scrollHeight - container.clientHeight - container.scrollTop
    const nearBottomThreshold = 48
    const atBottomThreshold = 8
    const isNearBottom = distance <= nearBottomThreshold
    const isAtBottom = distance <= atBottomThreshold
    isUserAtBottomRef.current = isNearBottom

    // Update reactive button visibility
    setShowScrollToBottom(!isAtBottom)

    if (isProgrammaticScrollRef.current) {
      // Programmatic scroll reached bottom → clear the flag
      if (isNearBottom) {
        clearProgrammaticFlag()
      }
    } else {
      // Not a programmatic scroll:
      // - If near bottom, user scrolled back → clear userScrolled
      // - If far from bottom AND already initialized, user scrolled away → set userScrolled
      if (isAtBottom) {
        userScrolledRef.current = false
      } else if (hasInitializedRef.current && movedUp) {
        userScrolledRef.current = true
      }
    }
  }, [clearProgrammaticFlag])

  const performScrollToBottom = useCallback(
    (behavior: ScrollBehavior) => {
      const anchor = messagesEndRef.current
      if (!anchor) return

      isProgrammaticScrollRef.current = true
      if (programmaticTimeoutRef.current) clearTimeout(programmaticTimeoutRef.current)
      const timeoutMs = behavior === "smooth" ? 1000 : 120
      programmaticTimeoutRef.current = setTimeout(clearProgrammaticFlag, timeoutMs)

      anchor.scrollIntoView({ behavior, block: "end" })
      hasInitializedRef.current = true
      isUserAtBottomRef.current = true
      setShowScrollToBottom(false)
    },
    [clearProgrammaticFlag],
  )

  // Manual scroll-to-bottom triggered by button click
  const scrollToBottom = useCallback(() => {
    userScrolledRef.current = false
    isUserAtBottomRef.current = true
    performScrollToBottom("smooth")
  }, [performScrollToBottom])

  // Reset scroll state on session change
  useEffect(() => {
    userScrolledRef.current = false
    isUserAtBottomRef.current = true
    hasInitializedRef.current = false
    lastScrollTopRef.current = null
    setShowScrollToBottom(false)
    clearProgrammaticFlag()
  }, [sessionID, clearProgrammaticFlag])

  // Reset scroll when a new user message appears (user just sent input)
  const messageCount = sortedMessages.length
  const prevMessageCountRef = useRef(messageCount)

  useEffect(() => {
    if (messageCount > prevMessageCountRef.current) {
      const lastMsg = sortedMessages.at(-1)
      if (lastMsg?.info.role === "user") {
        userScrolledRef.current = false
        isUserAtBottomRef.current = true
      }
    }
    prevMessageCountRef.current = messageCount
  }, [messageCount, sortedMessages])

  // Detect explicit user scroll-up gestures (wheel / touch)
  useEffect(() => {
    const container = messagesContainerRef.current?.parentElement as HTMLElement | null
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      // Ignore tiny accidental scrolls; only treat intentional upward wheel as user scroll
      if (e.deltaY < -2) {
        userScrolledRef.current = true
      }
    }

    let lastTouchY: number | undefined
    const handleTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches[0]?.clientY
    }
    const handleTouchMove = (e: TouchEvent) => {
      const currentY = e.touches[0]?.clientY
      if (currentY !== undefined && lastTouchY !== undefined && currentY > lastTouchY) {
        // Finger moving down = scrolling up
        userScrolledRef.current = true
      }
      lastTouchY = currentY
    }

    container.addEventListener("wheel", handleWheel, { passive: true })
    container.addEventListener("touchstart", handleTouchStart, { passive: true })
    container.addEventListener("touchmove", handleTouchMove, { passive: true })
    return () => {
      container.removeEventListener("wheel", handleWheel)
      container.removeEventListener("touchstart", handleTouchStart)
      container.removeEventListener("touchmove", handleTouchMove)
    }
  }, [sessionID])

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
    const container = messagesContainerRef.current?.parentElement as HTMLElement | null
    const content = messagesContainerRef.current
    if (!container || !content) return
    if (typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver(() => {
      updateScrollState()
      if (userScrolledRef.current) return
      performScrollToBottom("auto")
    })

    observer.observe(container)
    observer.observe(content)

    return () => {
      observer.disconnect()
    }
  }, [sessionID, updateScrollState, performScrollToBottom])

  useEffect(() => {
    const anchor = messagesEndRef.current
    if (!anchor) return
    const shouldScroll = !userScrolledRef.current || !hasInitializedRef.current
    if (!shouldScroll) return
    const behavior: ScrollBehavior = hasInitializedRef.current ? "smooth" : "auto"
    performScrollToBottom(behavior)
  }, [scrollSignature, sessionID, performScrollToBottom])

  return { messagesEndRef, messagesContainerRef, showScrollToBottom, scrollToBottom }
}
