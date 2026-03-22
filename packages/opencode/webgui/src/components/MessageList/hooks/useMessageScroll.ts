import { useEffect, useMemo, useRef, useCallback, useState, type RefObject } from "react"
import type { Message } from "../../../state/MessagesContext"

function readJcefScrollMultiplier() {
  if (typeof window === "undefined") return
  const value = new URLSearchParams(window.location.search).get("jcefScrollMultiplier")
  if (!value) return
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return
  return parsed
}

function normalizeDelta(e: WheelEvent, container: HTMLElement) {
  if (e.deltaMode === 1) return e.deltaY * 16
  if (e.deltaMode === 2) return e.deltaY * container.clientHeight
  return e.deltaY
}

function nestedScrollable(container: HTMLElement, target: EventTarget | null) {
  let node = target instanceof HTMLElement ? target : undefined
  while (node && node !== container) {
    const style = window.getComputedStyle(node)
    const overflow = style.overflowY
    if (
      (overflow === "auto" || overflow === "scroll" || overflow === "overlay") &&
      node.scrollHeight > node.clientHeight + 1
    ) {
      return true
    }
    node = node.parentElement ?? undefined
  }
  return false
}

export function useMessageScroll(
  sessionID: string | null | undefined,
  sortedMessages: Message[],
  isIdle: boolean,
  isReasoning: boolean,
  settling = false,
  box?: RefObject<HTMLDivElement | null>,
  tail?: RefObject<HTMLDivElement | null>,
  tailKey = "",
) {
  const multiplier = useMemo(() => readJcefScrollMultiplier(), [])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = box ?? innerRef
  const isUserAtBottomRef = useRef(true)
  const hasInitializedRef = useRef(false)
  const lastScrollTopRef = useRef<number | null>(null)
  // Tracks user intent to scroll away (set by wheel/touch/scrollbar/keyboard)
  const userScrolledRef = useRef(false)
  // Flag: true while a programmatic smooth-scroll is in progress
  const isProgrammaticScrollRef = useRef(false)
  // Safety timeout to clear the programmatic flag if scroll never reaches bottom
  const programmaticTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const resumeRef = useRef(false)
  const resumeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

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
    return `${lastMessageID}:${lastMessage?.parts.length ?? 0}:${lastPartsSignature}:idle=${isIdle}:think=${isReasoning}:tail=${tailKey}`
  }, [sortedMessages, isIdle, isReasoning, tailKey])

  const clearProgrammaticFlag = useCallback(() => {
    isProgrammaticScrollRef.current = false
    if (programmaticTimeoutRef.current) {
      clearTimeout(programmaticTimeoutRef.current)
      programmaticTimeoutRef.current = null
    }
  }, [])

  const clearResume = useCallback(() => {
    resumeRef.current = false
    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current)
      resumeTimeoutRef.current = null
    }
  }, [])

  const updateScrollState = useCallback(() => {
    const container = messagesContainerRef.current?.parentElement as HTMLElement | null
    if (!container) return

    const currentScrollTop = container.scrollTop
    const previousScrollTop = lastScrollTopRef.current
    const movedUp = previousScrollTop !== null && currentScrollTop < previousScrollTop - 1
    lastScrollTopRef.current = currentScrollTop

    const tailDistance = (() => {
      const anchor = messagesEndRef.current
      if (!anchor) return
      const box = container.getBoundingClientRect()
      const next = anchor.getBoundingClientRect()
      if (next.top === 0 && next.bottom === 0 && box.top === 0 && box.bottom === 0) return
      return next.bottom - box.bottom
    })()
    const distance = tailDistance ?? container.scrollHeight - container.clientHeight - container.scrollTop
    const nearBottomThreshold = 48
    const atBottomThreshold = 8
    const isNearBottom = distance <= nearBottomThreshold
    const isAtBottom = distance <= atBottomThreshold
    isUserAtBottomRef.current = isNearBottom

    // Update reactive button visibility
    setShowScrollToBottom(isProgrammaticScrollRef.current ? false : !isAtBottom)

    if (isProgrammaticScrollRef.current) {
      if (!isNearBottom && hasInitializedRef.current && movedUp) {
        userScrolledRef.current = true
        clearProgrammaticFlag()
        setShowScrollToBottom(!isAtBottom)
        return
      }

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
    clearResume()
  }, [sessionID, clearProgrammaticFlag, clearResume])

  useEffect(() => {
    if (!settling) return
    if (resumeTimeoutRef.current) {
      clearTimeout(resumeTimeoutRef.current)
      resumeTimeoutRef.current = null
    }
    resumeRef.current = true
  }, [settling])

  // Reset scroll when a new user message appears (user just sent input)
  const messageCount = sortedMessages.length
  const prevMessageRef = useRef({ count: messageCount, id: sortedMessages.at(-1)?.info.id })

  useEffect(() => {
    const last = sortedMessages.at(-1)
    const next = prevMessageRef.current.count < messageCount || prevMessageRef.current.id !== last?.info.id
    if (next && last?.info.role === "user") {
      userScrolledRef.current = false
      isUserAtBottomRef.current = true
    }
    prevMessageRef.current = { count: messageCount, id: last?.info.id }
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

      if (!multiplier) return
      if (nestedScrollable(container, e.target)) return
      const delta = normalizeDelta(e, container)
      if (!delta) return
      e.preventDefault()
      container.scrollBy({ top: delta * multiplier, behavior: "auto" })
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

    const wheelOptions: AddEventListenerOptions = { passive: !multiplier }
    container.addEventListener("wheel", handleWheel, wheelOptions)
    container.addEventListener("touchstart", handleTouchStart, { passive: true })
    container.addEventListener("touchmove", handleTouchMove, { passive: true })
    return () => {
      container.removeEventListener("wheel", handleWheel, wheelOptions)
      container.removeEventListener("touchstart", handleTouchStart)
      container.removeEventListener("touchmove", handleTouchMove)
    }
  }, [sessionID, multiplier])

  useEffect(() => {
    const container = messagesContainerRef.current?.parentElement as HTMLElement | null
    if (!container) return
    const prev = container.style.overflowAnchor
    container.style.overflowAnchor = "none"
    return () => {
      container.style.overflowAnchor = prev
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
    const content = tail?.current ?? messagesContainerRef.current
    if (!container || !content) return
    if (typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver(() => {
      updateScrollState()
      if (settling || userScrolledRef.current || resumeRef.current) return
      performScrollToBottom("auto")
    })

    observer.observe(content)
    observer.observe(container)

    return () => {
      observer.disconnect()
    }
  }, [sessionID, settling, tail, updateScrollState, performScrollToBottom])

  useEffect(() => {
    const anchor = messagesEndRef.current
    if (!anchor) return
    if (settling) return
    const shouldScroll = !userScrolledRef.current || !hasInitializedRef.current
    if (!shouldScroll) {
      clearResume()
      return
    }
    const behavior: ScrollBehavior = resumeRef.current || !hasInitializedRef.current ? "auto" : "smooth"
    performScrollToBottom(behavior)
    if (!resumeRef.current) return
    if (resumeTimeoutRef.current) clearTimeout(resumeTimeoutRef.current)
    resumeTimeoutRef.current = setTimeout(() => {
      resumeTimeoutRef.current = null
      resumeRef.current = false
    }, 0)
  }, [clearResume, scrollSignature, sessionID, performScrollToBottom, settling])

  return { messagesEndRef, messagesContainerRef, showScrollToBottom, scrollToBottom }
}
