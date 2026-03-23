import { useEffect, useMemo, useRef, useCallback, useState, type RefObject } from "react"
import type { Message } from "../../../state/MessagesContext"

// ─── JCEF helpers ────────────────────────────────────────────────────────────

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

// ─── Auto-scroll helpers (ported from create-auto-scroll) ────────────────────

const AUTO_TTL = 1500

type AutoMark = { top: number; time: number }

function markAuto(
  container: HTMLElement,
  ref: { current: AutoMark | null },
  timer: { current: ReturnType<typeof setTimeout> | null },
) {
  ref.current = {
    top: Math.max(0, container.scrollHeight - container.clientHeight),
    time: Date.now(),
  }
  if (timer.current) clearTimeout(timer.current)
  timer.current = setTimeout(() => {
    ref.current = null
    timer.current = null
  }, AUTO_TTL)
}

function isAuto(container: HTMLElement, ref: { current: AutoMark | null }): boolean {
  const a = ref.current
  if (!a) return false
  if (Date.now() - a.time > AUTO_TTL) {
    ref.current = null
    return false
  }
  return Math.abs(container.scrollTop - a.top) < 2
}

function distanceFromBottom(container: HTMLElement): number {
  return container.scrollHeight - container.clientHeight - container.scrollTop
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

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

  // ── core state (2 refs replacing the previous 6) ──────────────────────────
  const userScrolled = useRef(false)
  const autoMark = useRef<AutoMark | null>(null)
  const autoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── "scroll to bottom" button ─────────────────────────────────────────────
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)

  // ── helpers ───────────────────────────────────────────────────────────────

  const container = useCallback(
    () => messagesContainerRef.current?.parentElement as HTMLElement | null,
    [messagesContainerRef],
  )

  // Immediately pin to bottom (no animation).
  // ResizeObserver fires after layout, before paint — instant assignment avoids
  // the visible "catch-up" animation you get with scrollIntoView smooth.
  const pinBottom = useCallback(
    (behavior: ScrollBehavior = "auto") => {
      const el = container()
      if (!el) return
      markAuto(el, autoMark, autoTimer)
      if (behavior === "smooth") {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
      } else {
        el.scrollTop = el.scrollHeight
      }
      setShowScrollToBottom(false)
    },
    [container],
  )

  // ── scroll event handler ──────────────────────────────────────────────────

  const handleScroll = useCallback(() => {
    const el = container()
    if (!el) return

    const dist = distanceFromBottom(el)
    const canScroll = el.scrollHeight - el.clientHeight > 1

    // Button visibility: show when more than 8 px from bottom
    setShowScrollToBottom(dist > 8)

    if (!canScroll) {
      userScrolled.current = false
      return
    }

    if (dist < 10) {
      // Arrived at bottom — resume auto-follow
      userScrolled.current = false
      return
    }

    // Ignore scroll events that WE triggered
    if (!userScrolled.current && isAuto(el, autoMark)) {
      // still programmatic — keep following
      pinBottom()
      return
    }

    userScrolled.current = true
  }, [container, pinBottom])

  // ── wheel / touch handlers ────────────────────────────────────────────────

  useEffect(() => {
    const el = container()
    if (!el) return

    const handleWheel = (e: WheelEvent) => {
      // Only treat intentional upward scrolls as user intent.
      // Keep the threshold at < -2 (same as before) to ignore tiny
      // touchpad inertia ticks. Additionally filter out nested scrollable
      // regions (code blocks, tool output) — this is the real fix for root
      // cause #5, not just lowering the threshold.
      if (e.deltaY < -2 && !nestedScrollable(el, e.target)) {
        userScrolled.current = true
      }

      // JCEF wheel multiplier
      if (!multiplier) return
      if (nestedScrollable(el, e.target)) return
      const delta = normalizeDelta(e, el)
      if (!delta) return
      e.preventDefault()
      el.scrollBy({ top: delta * multiplier, behavior: "auto" })
    }

    let lastTouchY: number | undefined
    const handleTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches[0]?.clientY
    }
    const handleTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY
      if (y !== undefined && lastTouchY !== undefined && y > lastTouchY) {
        userScrolled.current = true
      }
      lastTouchY = y
    }

    const opts: AddEventListenerOptions = { passive: !multiplier }
    el.addEventListener("wheel", handleWheel, opts)
    el.addEventListener("touchstart", handleTouchStart, { passive: true })
    el.addEventListener("touchmove", handleTouchMove, { passive: true })
    return () => {
      el.removeEventListener("wheel", handleWheel, opts)
      el.removeEventListener("touchstart", handleTouchStart)
      el.removeEventListener("touchmove", handleTouchMove)
    }
  }, [sessionID, multiplier, container])

  // ── scroll event binding ──────────────────────────────────────────────────

  useEffect(() => {
    const el = container()
    if (!el) return
    el.addEventListener("scroll", handleScroll)
    handleScroll()
    return () => el.removeEventListener("scroll", handleScroll)
  }, [sessionID, handleScroll, container])

  // ── overflow-anchor: disable browser anchoring to avoid conflicts ─────────

  useEffect(() => {
    const el = container()
    if (!el) return
    const prev = el.style.overflowAnchor
    el.style.overflowAnchor = "none"
    return () => {
      el.style.overflowAnchor = prev
    }
  }, [sessionID, container])

  // ── ResizeObserver: primary auto-scroll trigger ───────────────────────────
  // Fires after layout, before paint — correct timing for scrollTop assignment.

  useEffect(() => {
    const el = container()
    const content = tail?.current ?? messagesContainerRef.current
    if (!el || !content) return
    if (typeof ResizeObserver === "undefined") return

    const obs = new ResizeObserver(() => {
      if (settling || userScrolled.current) return
      pinBottom()
    })

    obs.observe(content)
    obs.observe(el)
    return () => obs.disconnect()
  }, [sessionID, settling, tail, container, messagesContainerRef, pinBottom])

  // ── Session reset ─────────────────────────────────────────────────────────

  useEffect(() => {
    userScrolled.current = false
    autoMark.current = null
    if (autoTimer.current) {
      clearTimeout(autoTimer.current)
      autoTimer.current = null
    }
    setShowScrollToBottom(false)
  }, [sessionID])

  // ── User sends new message → force scroll back to bottom ─────────────────

  const messageCount = sortedMessages.length
  const prevMsg = useRef({ count: messageCount, id: sortedMessages.at(-1)?.info.id })

  useEffect(() => {
    const last = sortedMessages.at(-1)
    const changed = prevMsg.current.count < messageCount || prevMsg.current.id !== last?.info.id
    if (changed && last?.info.role === "user") {
      userScrolled.current = false
      pinBottom()
    }
    prevMsg.current = { count: messageCount, id: last?.info.id }
  }, [messageCount, sortedMessages, pinBottom])

  // ── Fallback effect: for environments without ResizeObserver, or when
  //    settling ends — uses scrollSignature as a secondary trigger ─────────

  const scrollSignature = useMemo(() => {
    const last = sortedMessages.at(-1)
    const id = last?.info.id ?? ""
    const parts =
      last?.parts
        .map((part) => {
          const text = (part as { text?: string }).text
          const len = typeof text === "string" ? text.length : 0
          const tool = (part as { state?: { status?: string; output?: string; metadata?: { output?: string } } }).state
          const status = typeof tool?.status === "string" ? tool.status : ""
          const out = typeof tool?.output === "string" ? tool.output.length : 0
          const meta = typeof tool?.metadata?.output === "string" ? tool.metadata.output.length : 0
          return `${part.id}:${part.type}:${len}:${status}:${out}:${meta}`
        })
        .join(",") ?? ""
    return `${id}:${last?.parts.length ?? 0}:${parts}:idle=${isIdle}:think=${isReasoning}:tail=${tailKey}`
  }, [sortedMessages, isIdle, isReasoning, tailKey])

  useEffect(() => {
    if (settling) return
    if (userScrolled.current) return
    pinBottom()
  }, [scrollSignature, settling, sessionID, pinBottom])

  // ── Manual scroll-to-bottom (button) ─────────────────────────────────────

  const scrollToBottom = useCallback(() => {
    userScrolled.current = false
    pinBottom("smooth")
  }, [pinBottom])

  return { messagesEndRef, messagesContainerRef, showScrollToBottom, scrollToBottom }
}
