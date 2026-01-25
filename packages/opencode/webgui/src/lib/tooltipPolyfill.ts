import { ideBridge } from "./ideBridge"

const state = {
  active: false,
  observer: null as MutationObserver | null,
  tip: null as HTMLDivElement | null,
  target: null as HTMLElement | null,
  cleanup: null as (() => void) | null,
  timer: null as number | null,
}

function syncElement(el: Element) {
  if (!(el instanceof HTMLElement)) return
  const title = el.getAttribute("title")
  if (!title) return
  if (el.getAttribute("data-tip") === title) return
  el.setAttribute("data-tip", title)
}

function syncAll() {
  document.querySelectorAll("[title]").forEach(syncElement)
}

function getTipEl(): HTMLDivElement {
  if (state.tip) return state.tip
  const el = document.createElement("div")
  el.id = "oc-tip"
  el.setAttribute("role", "tooltip")
  el.hidden = true
  document.body.appendChild(el)
  state.tip = el
  return el
}

function clamp(value: number, min: number, max: number) {
  if (value < min) return min
  if (value > max) return max
  return value
}

function isVisible(el: Element | null) {
  if (!el) return false
  if (!(el instanceof HTMLElement)) return false
  const style = window.getComputedStyle(el)
  if (style.display === "none") return false
  if (style.visibility === "hidden") return false
  return true
}

function findTarget(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null
  const el = node.closest?.("[data-tip]")
  if (!el) return null
  if (!(el instanceof HTMLElement)) return null
  if (!isVisible(el)) return null
  const tip = el.getAttribute("data-tip")
  if (!tip || tip.trim().length === 0) return null
  return el
}

function setText(el: HTMLDivElement, value: string) {
  // Keep it text-only (no HTML injection) and preserve basic spacing.
  el.textContent = value
}

function place(el: HTMLDivElement, anchor: HTMLElement) {
  const rect = anchor.getBoundingClientRect()
  const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0)
  const vh = Math.max(document.documentElement.clientHeight, window.innerHeight || 0)
  const margin = 8

  el.style.maxWidth = `min(320px, ${Math.max(0, vw - margin * 2)}px)`

  // Measure after maxWidth applies.
  el.style.left = "0px"
  el.style.top = "0px"
  const w = el.offsetWidth
  const h = el.offsetHeight

  const center = rect.left + rect.width / 2
  const left = clamp(center - w / 2, margin, vw - margin - w)

  const preferBelow = true
  const belowTop = rect.bottom + 6
  const aboveTop = rect.top - h - 6
  const top = preferBelow
    ? belowTop + h + margin <= vh
      ? belowTop
      : aboveTop >= margin
        ? aboveTop
        : Math.max(margin, belowTop)
    : aboveTop >= margin
      ? aboveTop
      : belowTop + h + margin <= vh
        ? belowTop
        : Math.max(margin, belowTop)

  el.style.left = `${Math.round(left)}px`
  el.style.top = `${Math.round(top)}px`
}

function show(target: HTMLElement) {
  const value = target.getAttribute("data-tip")
  if (!value || value.trim().length === 0) return

  const tip = getTipEl()
  setText(tip, value)

  // Prevent native tooltip from also firing (in case it works).
  const title = target.getAttribute("title")
  if (title && !target.hasAttribute("data-oc-title")) {
    target.setAttribute("data-oc-title", title)
    target.removeAttribute("title")
  }

  tip.hidden = false
  place(tip, target)
  state.target = target
}

function hide() {
  if (state.timer != null) {
    window.clearTimeout(state.timer)
    state.timer = null
  }

  const tip = state.tip
  if (tip) tip.hidden = true

  const target = state.target
  if (target) {
    const title = target.getAttribute("data-oc-title")
    if (title != null) {
      target.setAttribute("title", title)
      target.removeAttribute("data-oc-title")
    }
  }
  state.target = null
}

function installRuntime() {
  if (state.cleanup) return

  const scheduleShow = (next: HTMLElement) => {
    if (state.timer != null) window.clearTimeout(state.timer)
    state.timer = window.setTimeout(() => {
      state.timer = null
      if (!state.active) return
      if (state.target !== next) return
      show(next)
    }, 500)
  }

  const onOver = (ev: Event) => {
    if (!state.active) return
    const next = findTarget(ev.target)
    if (!next) return
    if (state.target === next) return
    state.target = next
    scheduleShow(next)
  }

  const onOut = (ev: MouseEvent) => {
    if (!state.active) return
    const current = state.target
    if (!current) return

    const related = ev.relatedTarget
    if (related instanceof Node && current.contains(related)) return

    const next = findTarget(related)
    if (next) {
      state.target = next
      scheduleShow(next)
      return
    }
    hide()
  }

  const onFocusIn = (ev: FocusEvent) => {
    if (!state.active) return
    const next = findTarget(ev.target)
    if (!next) return
    state.target = next
    scheduleShow(next)
  }

  const onFocusOut = (ev: FocusEvent) => {
    if (!state.active) return
    const next = findTarget(ev.relatedTarget)
    if (next) {
      state.target = next
      scheduleShow(next)
      return
    }
    hide()
  }

  const onScrollResize = () => {
    if (!state.active) return
    const tip = state.tip
    const target = state.target
    if (!tip || tip.hidden) return
    if (!target) return
    place(tip, target)
  }

  document.addEventListener("mouseover", onOver, true)
  document.addEventListener("mouseout", onOut, true)
  document.addEventListener("focusin", onFocusIn, true)
  document.addEventListener("focusout", onFocusOut, true)
  window.addEventListener("scroll", onScrollResize, true)
  window.addEventListener("resize", onScrollResize)

  state.cleanup = () => {
    document.removeEventListener("mouseover", onOver, true)
    document.removeEventListener("mouseout", onOut, true)
    document.removeEventListener("focusin", onFocusIn, true)
    document.removeEventListener("focusout", onFocusOut, true)
    window.removeEventListener("scroll", onScrollResize, true)
    window.removeEventListener("resize", onScrollResize)
    if (state.timer != null) {
      window.clearTimeout(state.timer)
      state.timer = null
    }
  }
}

export function setTooltipPolyfill(enabled: boolean) {
  if (typeof document === "undefined") return

  state.active = enabled
  document.documentElement.classList.toggle("tip-polyfill", enabled)

  if (!enabled) {
    state.observer?.disconnect()
    state.observer = null
    state.cleanup?.()
    state.cleanup = null
    hide()
    return
  }

  syncAll()
  installRuntime()

  if (state.observer) return
  state.observer = new MutationObserver((mutations) => {
    if (!state.active) return
    for (const m of mutations) {
      if (m.type === "attributes") {
        if (m.attributeName === "title") syncElement(m.target as Element)
        continue
      }
      for (const n of m.addedNodes) {
        if (!(n instanceof Element)) continue
        if (n.hasAttribute("title")) syncElement(n)
        n.querySelectorAll?.("[title]").forEach(syncElement)
      }
    }
  })

  state.observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["title"],
  })
}

export function installTooltipPolyfillBridge() {
  ideBridge.on((msg) => {
    if (!msg || typeof msg !== "object") return
    if (msg.type !== "setTooltipPolyfill") return
    const enabled = msg.payload?.enabled
    setTooltipPolyfill(enabled === true)
  })
}
