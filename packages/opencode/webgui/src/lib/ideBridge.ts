type Message = {
  id?: string
  replyTo?: string
  type: string
  payload?: any
  timestamp?: number
  ok?: boolean
  error?: string
}

type Handler = (message: Message) => void

class IdeBridge {
  ready = false
  private queue: string[] = []
  private handlers: Set<Handler> = new Set()
  private pending = new Map<string, { resolve: (m: Message) => void; reject: (e: any) => void }>()
  private flushTimer: number | null = null

  isInstalled(): boolean {
    return typeof (window as any).__ideBridgeSend === "function" || (window.parent && window.parent !== window)
  }

  init() {
    const onMessage = (ev: MessageEvent) => {
      const msg = ev.data as Message
      this.dispatch(msg)
    }
    window.addEventListener("message", onMessage)
    ;(window as any).__ideBridgeOnMessage = (m: any) => {
      try {
        this.dispatch(typeof m === "string" ? JSON.parse(m) : m)
      } catch {}
      if (!this.ready) this.flush()
    }
  }

  private dispatch(msg: Message) {
    if (msg && msg.replyTo) {
      const p = this.pending.get(msg.replyTo)
      if (p) {
        this.pending.delete(msg.replyTo)
        p.resolve(msg)
        return
      }
    }
    this.handlers.forEach((h) => {
      try {
        h(msg)
      } catch {}
    })
  }

  on(handler: Handler) {
    this.handlers.add(handler)
  }
  off(handler: Handler) {
    this.handlers.delete(handler)
  }

  send(msg: Message) {
    const s = typeof msg === "string" ? String(msg) : JSON.stringify(msg)
    const fn = (window as any).__ideBridgeSend
    if (typeof fn === "function") {
      fn(s)
      return
    }
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "__ideBridgeSend", json: s }, "*")
        return
      }
    } catch {}
    this.queue.push(s)
    this.ensureFlushScheduled()
  }

  request<T = any>(type: string, payload?: any): Promise<Message & { result?: T }> {
    return new Promise((resolve, reject) => {
      try {
        const id = String(Date.now()) + Math.random().toString(36).slice(2)
        this.pending.set(id, { resolve, reject })
        this.send({ id, type, payload, timestamp: Date.now() })
      } catch (e) {
        reject(e)
      }
    })
  }

  private ensureFlushScheduled() {
    if (this.flushTimer !== null) return
    const attempt = () => {
      const fn = (window as any).__ideBridgeSend
      if (typeof fn === "function") {
        this.flush()
        if (this.flushTimer !== null) {
          window.clearTimeout(this.flushTimer)
          this.flushTimer = null
        }
        return
      }
      this.flushTimer = window.setTimeout(attempt, 100)
    }
    this.flushTimer = window.setTimeout(attempt, 0)
  }

  flush() {
    this.ready = true
    const q = this.queue.splice(0, this.queue.length)
    const fn = (window as any).__ideBridgeSend
    for (const s of q) {
      try {
        if (typeof fn === "function") fn(s)
        else if (window.parent && window.parent !== window)
          window.parent.postMessage({ type: "__ideBridgeSend", json: s }, "*")
      } catch {}
    }
  }
}

export const ideBridge = new IdeBridge()

export function reloadPath(path: string, operation: "write" | "edit" | "apply_patch") {
  if (!ideBridge.isInstalled()) return
  ideBridge.send({ type: "reloadPath", payload: { path, operation } })
}
