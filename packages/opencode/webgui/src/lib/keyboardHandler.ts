type KeyPayload = {
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  code: string
  key: string
  hasSelection: boolean
  inEditable: boolean
}

function isIframe(): boolean {
  try {
    return window.parent !== window
  } catch {
    return false
  }
}

function isEditableElement(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLInputElement) return !el.readOnly && !el.disabled
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled
  if (el instanceof HTMLElement) {
    if (el.isContentEditable) return true
    if (el.closest('[contenteditable="true"]')) return true
  }
  return false
}

function selectionLengthInInput(el: Element | null): number {
  if (!el) return 0
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? 0
    const end = el.selectionEnd ?? 0
    return Math.abs(end - start)
  }
  return 0
}

function hasDomSelection(): boolean {
  const sel = window.getSelection?.()
  if (!sel) return false
  if (sel.isCollapsed) return false
  return (sel.toString() || "").length > 0
}

function computeState(): { inEditable: boolean; hasSelection: boolean; active: Element | null } {
  const active = document.activeElement
  const inEditable = isEditableElement(active)
  const hasSelection = selectionLengthInInput(active) > 0 || hasDomSelection()
  return { inEditable, hasSelection, active }
}

function forwardToParent(type: "keydown-event" | "keyup-event", payload: KeyPayload) {
  try {
    if (!isIframe()) return
    window.parent.postMessage({ type, payload }, "*")
  } catch {}
}

function stop(ev: KeyboardEvent) {
  ev.preventDefault()
  ev.stopPropagation()
  try {
    ev.stopImmediatePropagation()
  } catch {}
}

function dispatchPasteText(target: Element | null, text: string): boolean {
  try {
    const ev = new CustomEvent("opencode:paste-text", {
      detail: { text },
      bubbles: true,
      cancelable: true,
    })
    ;(target ?? document.body).dispatchEvent(ev)
    return ev.defaultPrevented
  } catch {
    return false
  }
}

export class KeyboardHandler {
  private onKeyDown: ((ev: KeyboardEvent) => void) | null = null
  private onKeyUp: ((ev: KeyboardEvent) => void) | null = null
  private onMessage: ((ev: MessageEvent) => void) | null = null

  constructor() {
    this.install()
  }

  private install() {
    if (!isIframe()) return

    this.onMessage = (ev: MessageEvent) => {
      const msg = ev.data as any
      if (!msg || typeof msg !== "object") return
      if (msg.type !== "setParentOrigin") return
      // We currently postMessage with '*' targetOrigin; parent validates our origin.
      // Keeping this handler allows a future tighten-up without breaking protocol.
    }
    window.addEventListener("message", this.onMessage)

    this.onKeyDown = (ev: KeyboardEvent) => {
      const mod = ev.metaKey || ev.ctrlKey
      const { inEditable, hasSelection, active } = computeState()

      if (mod && (ev.code === "KeyC" || ev.code === "KeyX" || ev.code === "KeyV")) {
        // Only take over clipboard shortcuts when the iframe is the intended target.
        // Otherwise, let VSCode handle them (forwarded below).
        if (inEditable || hasSelection) {
          if (ev.code === "KeyC") {
            try {
              document.execCommand("copy")
            } catch {}
            stop(ev)
            return
          }

          if (ev.code === "KeyX") {
            try {
              document.execCommand("cut")
            } catch {}
            stop(ev)
            return
          }

          if (ev.code === "KeyV") {
            const insert = async () => {
              try {
                const clip = navigator.clipboard
                if (clip?.readText) {
                  const text = await clip.readText()
                  if (text) {
                    const handled = dispatchPasteText(active, text)
                    if (handled) return
                    try {
                      document.execCommand("insertText", false, text)
                    } catch {}
                    return
                  }
                }
              } catch {}
              try {
                document.execCommand("paste")
              } catch {}
            }
            stop(ev)
            void insert()
            return
          }
        }
      }

      if (mod && ev.code === "KeyA" && inEditable) {
        try {
          document.execCommand("selectAll")
        } catch {}
        stop(ev)
        return
      }

      if (mod && ev.code === "KeyZ" && inEditable) {
        try {
          document.execCommand(ev.shiftKey ? "redo" : "undo")
        } catch {}
        stop(ev)
        return
      }

      const payload: KeyPayload = {
        ctrlKey: ev.ctrlKey,
        metaKey: ev.metaKey,
        shiftKey: ev.shiftKey,
        altKey: ev.altKey,
        code: ev.code,
        key: ev.key,
        hasSelection,
        inEditable,
      }
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) forwardToParent("keydown-event", payload)
    }

    this.onKeyUp = (ev: KeyboardEvent) => {
      const { inEditable, hasSelection } = computeState()
      const payload: KeyPayload = {
        ctrlKey: ev.ctrlKey,
        metaKey: ev.metaKey,
        shiftKey: ev.shiftKey,
        altKey: ev.altKey,
        code: ev.code,
        key: ev.key,
        hasSelection,
        inEditable,
      }
      if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.altKey) forwardToParent("keyup-event", payload)
    }

    // Capture phase so we run before VSCode webview eats the event.
    window.addEventListener("keydown", this.onKeyDown, true)
    window.addEventListener("keyup", this.onKeyUp, true)
  }

  destroy() {
    if (this.onMessage) window.removeEventListener("message", this.onMessage)
    if (this.onKeyDown) window.removeEventListener("keydown", this.onKeyDown, true)
    if (this.onKeyUp) window.removeEventListener("keyup", this.onKeyUp, true)
    this.onMessage = null
    this.onKeyDown = null
    this.onKeyUp = null
  }
}

let instance: KeyboardHandler | null = null

export function initKeyboardHandler() {
  if (instance) return instance
  instance = new KeyboardHandler()
  return instance
}

export function destroyKeyboardHandler() {
  instance?.destroy()
  instance = null
}
