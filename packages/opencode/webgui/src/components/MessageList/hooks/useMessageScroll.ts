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

const BOTTOM_THRESHOLD = 24
const PROGRAM_TTL = 800

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
) {
  const multiplier = useMemo(() => readJcefScrollMultiplier(), [])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = box ?? innerRef
  const [containerNode, setContainerNode] = useState<HTMLDivElement | null>(messagesContainerRef.current)

  const mode = useRef<FollowMode>("following")
  const program = useRef<ProgramMark | null>(null)
  const programTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seekTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastTop = useRef(0)
  const lastHeight = useRef(0)
  const lastClient = useRef(0)
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

  const update = useCallback((el: HTMLElement, nextMode = mode.current) => {
    const at = distanceFromBottom(el) <= BOTTOM_THRESHOLD
    syncLast(el)
    commitView(at ? "following" : nextMode, at)
  }, [commitView, syncLast])

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

  const clearSeek = useCallback(() => {
    if (seekTimer.current) {
      clearTimeout(seekTimer.current)
      seekTimer.current = null
    }
  }, [])

  const isTowardProgramTarget = useCallback((item: ProgramMark, prevTop: number, currentTop: number) => {
    if (item.target === null) return true
    const prevDistance = Math.abs(item.target - prevTop)
    const nextDistance = Math.abs(item.target - currentTop)
    return nextDistance <= prevDistance + 1
  }, [])

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
        clearSeek()
        seekTimer.current = setTimeout(() => {
          const current = container()
          if (!current) return
          if (distanceFromBottom(current) <= BOTTOM_THRESHOLD) {
            clearProgram()
            commitView("following", true)
          }
          seekTimer.current = null
        }, 700)
        el.scrollTo({ top: el.scrollHeight, behavior })
        return
      }
      commitView("following", true)
      if (behavior === "smooth") el.scrollTo({ top: el.scrollHeight, behavior })
      else el.scrollTop = targetTop
      syncLast(el)
    },
    [clearProgram, clearSeek, commitView, container, markProgram, syncLast],
  )

  const followTail = useCallback(
    (el: HTMLElement) => {
      if (mode.current === "following") {
        const hadBottomAnchor =
          allowNextTailFollow.current ||
          lastHeight.current <= 0 ||
          lastClient.current <= 0 ||
          lastHeight.current - lastClient.current - lastTop.current <= BOTTOM_THRESHOLD
        if (!hadBottomAnchor) {
          allowNextTailFollow.current = false
          syncLast(el)
          clearProgram()
          clearSeek()
          commitView("detached", false)
          return
        }
        allowNextTailFollow.current = false
        pinBottom("auto-follow")
        return
      }
      if (mode.current === "seeking") {
        pinBottom("button-seek", "smooth")
      }
    },
    [clearProgram, clearSeek, commitView, pinBottom, syncLast],
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

    if (at) {
      allowNextTailFollow.current = false
      clearProgram()
      clearSeek()
      commitView("following", true)
      return
    }

    const dimensionsChanged = el.scrollHeight !== prevHeight || el.clientHeight !== prevClient
    const item = getProgram()
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
      clearProgram()
    }

    const wasAtBottom = prevHeight - prevClient - prevTop <= BOTTOM_THRESHOLD
    if (
      mode.current === "following" &&
      wasAtBottom &&
      prevHeight > 0 &&
      prevClient > 0 &&
      dimensionsChanged &&
      el.scrollTop >= prevTop
    ) {
      allowNextTailFollow.current = true
      commitView("following", false)
      return
    }

    clearSeek()
    commitView("detached", false)
  }, [clearProgram, clearSeek, commitView, container, getProgram, isTowardProgramTarget])

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
        clearSeek()
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
        clearSeek()
        clearProgram()
        commitView("detached", distanceFromBottom(el) <= BOTTOM_THRESHOLD)
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
  }, [sessionID, multiplier, clearProgram, clearSeek, commitView, container, runProgrammaticScroll])

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
      if (settling) return
      followTail(el)
    })

    obs.observe(content)
    obs.observe(el)
    return () => obs.disconnect()
  }, [sessionID, settling, tail, container, messagesContainerRef, followTail])

  // ── Session reset ─────────────────────────────────────────────────────────

  useEffect(() => {
    mode.current = "following"
    allowNextTailFollow.current = false
    clearProgram()
    lastTop.current = 0
    lastHeight.current = 0
    lastClient.current = 0
    clearSeek()
    commitView("following", true)
  }, [sessionID, clearProgram, clearSeek, commitView])

  useEffect(() => {
    return () => {
      clearProgram()
      clearSeek()
    }
  }, [clearProgram, clearSeek])

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
    pinBottom("button-seek", "smooth")
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
