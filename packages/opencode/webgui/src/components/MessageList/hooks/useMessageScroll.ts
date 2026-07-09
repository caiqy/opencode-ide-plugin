import { useEffect, useLayoutEffect, useMemo, useRef, useCallback, useState, type RefObject } from "react"
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

function distanceFromBottom(container: HTMLElement): number {
  return container.scrollHeight - container.clientHeight - container.scrollTop
}

function editableTarget(target: EventTarget | null) {
  const node = target instanceof HTMLElement ? target : null
  if (!node) return false
  const tag = node.tagName.toLowerCase()
  return tag === "input" || tag === "textarea" || tag === "select" || node.isContentEditable
}

function keyboardScrollIntent(e: KeyboardEvent) {
  if (editableTarget(e.target)) return false
  return e.key === "ArrowUp" || e.key === "PageUp" || e.key === "Home" || (e.key === " " && e.shiftKey)
}

function scrollbarPointerIntent(container: HTMLElement, e: PointerEvent) {
  if (container.scrollHeight <= container.clientHeight + 1) return false
  const rect = container.getBoundingClientRect()
  return e.clientX >= rect.right - 16 && e.clientX <= rect.right + 2
}

const BOTTOM_THRESHOLD = 24
const BOTTOM_SETTLE_THRESHOLD = 6
const PROGRAM_TTL = 800
const USER_INTENT_TTL = 800

type FollowMode = "following" | "detached" | "seeking"
type ScrollCause = "auto-follow" | "button-seek" | "send-message" | "history-restore" | "history-trim" | "jcef-wheel"
type ProgramMark = { cause: ScrollCause; top: number; target: number | null; time: number }

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
  sendRequestKey = 0,
) {
  const multiplier = useMemo(() => readJcefScrollMultiplier(), [])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = box ?? innerRef
  const [containerNode, setContainerNode] = useState<HTMLDivElement | null>(messagesContainerRef.current)

  const mode = useRef<FollowMode>("following")
  const program = useRef<ProgramMark | null>(null)
  const programTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTop = useRef(0)
  const lastHeight = useRef(0)
  const lastClient = useRef(0)
  const lastUserIntent = useRef(0)
  const lastSendRequestKey = useRef(sendRequestKey)
  const lastSessionID = useRef(sessionID)
  // Session changes can temporarily render without the scroll container while
  // MessageList settles; keep one pending pin so the new tab still lands at bottom.
  const pendingSessionPin = useRef(false)
  const allowNextTailFollow = useRef(false)
  // following + !isAtBottom is a deliberate transient: content growth and
  // in-flight programmatic scrolls can move the bottom away for a frame while
  // we still intend to auto-follow on the next layout tick.
  const [view, setView] = useState({ mode: "following" as FollowMode, isAtBottom: true })
  const viewRef = useRef(view)

  // ── helpers ───────────────────────────────────────────────────────────────

  useLayoutEffect(() => {
    const node = messagesContainerRef.current
    if (node !== containerNode) setContainerNode(node)
  })

  const container = useCallback(() => containerNode?.parentElement ?? null, [containerNode])

  const syncLast = useCallback((el: HTMLElement) => {
    lastTop.current = el.scrollTop
    lastHeight.current = el.scrollHeight
    lastClient.current = el.clientHeight
  }, [])

  const commitView = useCallback((nextMode: FollowMode, isAtBottom: boolean) => {
    mode.current = nextMode
    const prev = viewRef.current
    if (prev.mode === nextMode && prev.isAtBottom === isAtBottom) return
    const next = { mode: nextMode, isAtBottom }
    viewRef.current = next
    setView(next)
  }, [])

  const clearProgram = useCallback(() => {
    program.current = null
    if (programTimer.current) {
      clearTimeout(programTimer.current)
      programTimer.current = null
    }
  }, [])

  const markUserIntent = useCallback(() => {
    lastUserIntent.current = Date.now()
  }, [])

  const hasUserIntent = useCallback(() => Date.now() - lastUserIntent.current <= USER_INTENT_TTL, [])

  const update = useCallback(
    (el: HTMLElement, nextMode = mode.current) => {
      const at = distanceFromBottom(el) <= BOTTOM_THRESHOLD
      syncLast(el)
      commitView(at ? "following" : nextMode, at)
    },
    [commitView, syncLast],
  )

  const markProgram = useCallback((cause: ScrollCause, top: number, target: number | null) => {
    program.current = { cause, top, target, time: Date.now() }
    if (programTimer.current) clearTimeout(programTimer.current)
    programTimer.current = setTimeout(() => {
      program.current = null
      programTimer.current = null
    }, PROGRAM_TTL)
  }, [])

  const updateProgramTarget = useCallback((target: number) => {
    const item = program.current
    if (!item) return
    program.current = { ...item, target }
  }, [])

  const getProgram = useCallback(() => {
    const item = program.current
    if (!item) return null
    if (Date.now() - item.time > PROGRAM_TTL) {
      clearProgram()
      return null
    }
    return item
  }, [clearProgram])

  const isTowardProgramTarget = useCallback((item: ProgramMark, prevTop: number, currentTop: number) => {
    if (item.target === null) return true
    const prevDistance = Math.abs(item.target - prevTop)
    const nextDistance = Math.abs(item.target - currentTop)
    return nextDistance <= prevDistance + 1
  }, [])

  const settleAtBottom = useCallback(
    (el: HTMLElement) => {
      const targetTop = Math.max(0, el.scrollHeight - el.clientHeight)
      const gap = targetTop - el.scrollTop
      if (gap > 0.5 && gap <= BOTTOM_SETTLE_THRESHOLD) {
        el.scrollTop = targetTop
      }
      syncLast(el)
      commitView("following", true)
    },
    [commitView, syncLast],
  )

  // Immediately pin to bottom (no animation).
  // ResizeObserver fires after layout, before paint — instant assignment avoids
  // the visible "catch-up" animation you get with scrollIntoView smooth.
  const pinBottom = useCallback(
    (cause: ScrollCause = "auto-follow", behavior: ScrollBehavior = "auto") => {
      const el = container()
      if (!el) return
      const targetTop = Math.max(0, el.scrollHeight - el.clientHeight)
      markProgram(cause, el.scrollTop, targetTop)
      if (cause === "button-seek") {
        commitView("seeking", false)
        el.scrollTo({ top: el.scrollHeight, behavior })
        syncLast(el)
        return
      }
      commitView("following", true)
      if (behavior === "smooth") el.scrollTo({ top: el.scrollHeight, behavior })
      else el.scrollTop = targetTop
      syncLast(el)
    },
    [commitView, container, markProgram, syncLast],
  )

  const followTail = useCallback(
    (el: HTMLElement) => {
      if (mode.current === "following") {
        const hadBottomAnchor =
          allowNextTailFollow.current ||
          lastHeight.current <= 0 ||
          lastClient.current <= 0 ||
          lastHeight.current - lastClient.current - lastTop.current <= BOTTOM_THRESHOLD
        if (!hadBottomAnchor && hasUserIntent()) {
          allowNextTailFollow.current = false
          syncLast(el)
          clearProgram()
          commitView("detached", false)
          return
        }
        allowNextTailFollow.current = false
        pinBottom("auto-follow")
        return
      }
      if (mode.current === "seeking") {
        pinBottom("button-seek", "auto")
      }
    },
    [clearProgram, commitView, hasUserIntent, pinBottom, syncLast],
  )

  const runProgrammaticScroll = useCallback(
    (cause: ScrollCause, fn: (el: HTMLElement) => void) => {
      const el = container()
      if (!el) return
      const startTop = el.scrollTop
      markProgram(cause, startTop, null)
      fn(el)
      updateProgramTarget(el.scrollTop)
      update(el, mode.current)
    },
    [container, markProgram, update, updateProgramTarget],
  )

  // ── scroll event handler ──────────────────────────────────────────────────

  const handleScroll = useCallback(() => {
    const el = container()
    if (!el) return
    const prevTop = lastTop.current
    const prevHeight = lastHeight.current
    const prevClient = lastClient.current
    lastTop.current = el.scrollTop
    lastHeight.current = el.scrollHeight
    lastClient.current = el.clientHeight

    const at = distanceFromBottom(el) <= BOTTOM_THRESHOLD
    const item = getProgram()

    if (at) {
      allowNextTailFollow.current = false
      clearProgram()
      settleAtBottom(el)
      return
    }

    const dimensionsChanged = el.scrollHeight !== prevHeight || el.clientHeight !== prevClient
    const wasAtBottom = prevHeight - prevClient - prevTop <= BOTTOM_THRESHOLD
    const keepsBottomAnchor =
      item?.cause === "send-message" || item?.cause === "auto-follow" || item?.cause === "button-seek"
    if (item?.cause === "button-seek" && !dimensionsChanged && !hasUserIntent()) {
      pinBottom("button-seek", "auto")
      return
    }
    if (item && !dimensionsChanged) {
      // button-seek, history restore/trim and jcef wheel can all overlap with a
      // user's immediate scrollbar/keyboard intervention. While target is pending
      // (the write happened but we have not committed the final target yet), or
      // while the position is still moving toward that target, treat the scroll as
      // programmatic. Once it deviates away, let normal detached handling win.
      if (isTowardProgramTarget(item, prevTop, el.scrollTop)) {
        commitView(mode.current, false)
        return
      }
      if (
        (item.cause === "send-message" || item.cause === "auto-follow") &&
        mode.current === "following" &&
        wasAtBottom &&
        !hasUserIntent()
      ) {
        allowNextTailFollow.current = true
        pinBottom(item.cause)
        return
      }
      clearProgram()
    }

    if (item && dimensionsChanged && !keepsBottomAnchor) {
      commitView("detached", false)
      return
    }

    if (item?.cause === "button-seek" && dimensionsChanged) {
      if (hasUserIntent()) {
        commitView("detached", false)
        return
      }
      pinBottom("button-seek", "auto")
      return
    }

    if (
      mode.current === "following" &&
      wasAtBottom &&
      prevHeight > 0 &&
      prevClient > 0 &&
      dimensionsChanged &&
      !hasUserIntent()
    ) {
      allowNextTailFollow.current = false
      pinBottom("auto-follow")
      return
    }

    commitView("detached", false)
  }, [clearProgram, commitView, container, getProgram, hasUserIntent, isTowardProgramTarget, pinBottom, settleAtBottom])

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
        markUserIntent()
        clearProgram()
        commitView("detached", distanceFromBottom(el) <= BOTTOM_THRESHOLD)
      }

      // JCEF wheel multiplier
      if (!multiplier) return
      if (nestedScrollable(el, e.target)) return
      const delta = normalizeDelta(e, el)
      if (!delta) return
      e.preventDefault()
      runProgrammaticScroll("jcef-wheel", (node) => {
        node.scrollBy({ top: delta * multiplier, behavior: "auto" })
      })
    }

    let lastTouchY: number | undefined
    const handleTouchStart = (e: TouchEvent) => {
      lastTouchY = e.touches[0]?.clientY
    }
    const handleTouchMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY
      if (y !== undefined && lastTouchY !== undefined && y > lastTouchY) {
        markUserIntent()
        clearProgram()
        commitView("detached", distanceFromBottom(el) <= BOTTOM_THRESHOLD)
      }
      lastTouchY = y
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (keyboardScrollIntent(e)) markUserIntent()
    }

    const handlePointerDown = (e: PointerEvent) => {
      if (scrollbarPointerIntent(el, e)) markUserIntent()
    }

    const opts: AddEventListenerOptions = { passive: !multiplier }
    el.addEventListener("wheel", handleWheel, opts)
    el.addEventListener("touchstart", handleTouchStart, { passive: true })
    el.addEventListener("touchmove", handleTouchMove, { passive: true })
    el.addEventListener("pointerdown", handlePointerDown, { passive: true })
    window.addEventListener("keydown", handleKeyDown, { capture: true })
    return () => {
      el.removeEventListener("wheel", handleWheel, opts)
      el.removeEventListener("touchstart", handleTouchStart)
      el.removeEventListener("touchmove", handleTouchMove)
      el.removeEventListener("pointerdown", handlePointerDown)
      window.removeEventListener("keydown", handleKeyDown, { capture: true })
    }
  }, [sessionID, multiplier, clearProgram, commitView, container, markUserIntent, runProgrammaticScroll])

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
    const shell = messagesContainerRef.current
    const tailNode = tail?.current
    if (!el || !shell) return
    if (typeof ResizeObserver === "undefined") return

    const obs = new ResizeObserver(() => {
      if (settling) return
      followTail(el)
    })

    obs.observe(el)
    obs.observe(shell)
    if (tailNode && tailNode !== shell) obs.observe(tailNode)
    return () => obs.disconnect()
  }, [sessionID, settling, tail, container, messagesContainerRef, followTail])

  // ── Session reset ─────────────────────────────────────────────────────────

  useEffect(() => {
    const changed = lastSessionID.current !== sessionID
    if (!changed) return
    lastSessionID.current = sessionID
    mode.current = "following"
    allowNextTailFollow.current = false
    clearProgram()
    lastTop.current = 0
    lastHeight.current = 0
    lastClient.current = 0
    lastUserIntent.current = 0
    if (!sessionID) {
      pendingSessionPin.current = false
      commitView("following", true)
      return
    }
    const el = container()
    if (!el) {
      pendingSessionPin.current = true
      commitView("following", true)
      return
    }
    pendingSessionPin.current = false
    pinBottom("history-restore")
  }, [sessionID, clearProgram, commitView, container, pinBottom])

  useEffect(() => {
    if (!pendingSessionPin.current || !sessionID) return
    if (!container()) return
    pendingSessionPin.current = false
    pinBottom("history-restore")
  }, [sessionID, container, pinBottom])

  useEffect(() => {
    return () => {
      clearProgram()
    }
  }, [clearProgram])

  // ── User sends new message → force scroll back to bottom ─────────────────

  const messageCount = sortedMessages.length
  const prevMsg = useRef({ count: messageCount, id: sortedMessages.at(-1)?.info.id })

  useEffect(() => {
    const last = sortedMessages.at(-1)
    const changed = prevMsg.current.count < messageCount || prevMsg.current.id !== last?.info.id
    if (changed && last?.info.role === "user") {
      mode.current = "following"
      pinBottom("send-message")
    }
    prevMsg.current = { count: messageCount, id: last?.info.id }
  }, [messageCount, sortedMessages, pinBottom])

  useEffect(() => {
    if (lastSendRequestKey.current === sendRequestKey) return
    lastSendRequestKey.current = sendRequestKey
    mode.current = "following"
    pinBottom("send-message")
  }, [pinBottom, sendRequestKey])

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
    const el = container()
    if (!el) return
    if (settling) return
    followTail(el)
  }, [scrollSignature, settling, sessionID, container, followTail])

  // ── Manual scroll-to-bottom (button) ─────────────────────────────────────

  const scrollToBottom = useCallback(() => {
    pinBottom("button-seek", "auto")
  }, [pinBottom])

  return {
    messagesEndRef,
    messagesContainerRef,
    mode: view.mode,
    isAtBottom: view.isAtBottom,
    showScrollToBottom: view.mode === "detached" && !view.isAtBottom,
    scrollToBottom,
    runProgrammaticScroll,
  }
}
