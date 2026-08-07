type Message = {
  id?: string
  replyTo?: string
  type: string
  payload?: unknown
  timestamp?: number
  ok?: boolean
  error?: string
}

export type StorageScope = "global" | "workspace" | "mem"

type Handler = (message: Message) => void

type Pending = {
  resolve: (m: Message) => void
  reject: (e: unknown) => void
  timer?: ReturnType<typeof setTimeout>
  retry?: ReturnType<typeof setTimeout>
}

// Parse URL params once at module load
const params = new URLSearchParams(window.location.search)
const bridgeBase = params.get("ideBridge")
const token = params.get("ideBridgeToken")

class IdeBridge {
  ready = false
  customApi = true
  minVersion: string | null = null
  restartMode: "window" | "ide" | null = null
  private queue: Message[] = []
  private handlers: Set<Handler> = new Set()
  private pending = new Map<string, Pending>()
  private eventSource: EventSource | null = null
  private reconnectDelay = 1000
  private readonly maxReconnectDelay = 30000
  private readonly timeout: Partial<Record<string, number>> = {
    getUpdateInfo: 5000,
    checkForUpdates: 15000,
    restartHost: 5000,
    storageSet: 5000,
  }
  private reconnectScheduled = false
  private connectErrorLogged = false

  isInstalled(): boolean {
    return !!(bridgeBase && token)
  }

  init() {
    this.connect()
  }

  private connect() {
    if (!bridgeBase || !token) return

    const url = `${bridgeBase}/events?token=${encodeURIComponent(token)}`
    try {
      this.eventSource = new EventSource(url)
    } catch (e) {
      console.warn("[ideBridge] Failed to create EventSource", { bridgeBase }, e)
      this.ready = false
      this.scheduleReconnect()
      return
    }

    this.eventSource.addEventListener("connected", (ev: MessageEvent) => {
      try {
        const data = JSON.parse(String(ev.data))
        if (typeof data.customApi === "boolean") {
          this.customApi = data.customApi
        }
        if (typeof data.minVersion === "string") {
          this.minVersion = data.minVersion
        }
        this.restartMode = data.restartMode === "window" || data.restartMode === "ide" ? data.restartMode : null
      } catch {
        return
      }
      try {
        window.dispatchEvent(new Event("opencode:idebridge-connected"))
      } catch {
        return
      }
    })

    this.eventSource.onopen = () => {
      this.ready = true
      this.reconnectDelay = 1000
      this.connectErrorLogged = false
      console.log("[ideBridge] Connected", { bridgeBase })
      this.flushQueue()
    }

    this.eventSource.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data) as Message
        this.dispatch(msg)
      } catch (e) {
        console.warn("[ideBridge] Failed to parse SSE message:", e)
      }
    }

    this.eventSource.onerror = () => {
      if (!this.connectErrorLogged) {
        this.connectErrorLogged = true
        console.warn("[ideBridge] Connection error", {
          bridgeBase,
          readyState: this.eventSource?.readyState,
        })
      }
      this.ready = false
      this.rejectPending(new Error("[ideBridge] Bridge disconnected"))
      this.scheduleReconnect()
    }
  }

  onReady(handler: () => void) {
    const run = () => {
      try {
        handler()
      } catch {
        return
      }
    }

    if (this.ready) {
      run()
      return () => {}
    }

    const listener = () => run()
    window.addEventListener("opencode:idebridge-ready", listener)
    return () => window.removeEventListener("opencode:idebridge-ready", listener)
  }

  private scheduleReconnect() {
    if (this.reconnectScheduled) return
    this.reconnectScheduled = true
    this.eventSource?.close()
    this.eventSource = null
    setTimeout(() => {
      this.reconnectScheduled = false
      this.connect()
    }, this.reconnectDelay)
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay)
  }

  private dispatch(msg: Message) {
    if (msg && msg.replyTo) {
      const p = this.pending.get(msg.replyTo)
      if (p) {
        this.clearPending(msg.replyTo)
        if (msg.ok === false) {
          p.reject(new Error(msg.error || "[ideBridge] Request failed"))
          return
        }
        p.resolve(msg)
        return
      }
    }
    this.handlers.forEach((h) => {
      try {
        h(msg)
      } catch {
        return
      }
    })
  }

  on(handler: Handler) {
    this.handlers.add(handler)
  }

  off(handler: Handler) {
    this.handlers.delete(handler)
  }

  send(msg: Message) {
    if (!bridgeBase || !token) {
      console.warn("[ideBridge] Bridge not configured, ignoring send:", msg.type)
      return
    }

    if (!this.ready) {
      this.queue.push(msg)
      return
    }

    this.doSend(msg)
  }

  sendTransient(msg: Message) {
    if (!bridgeBase || !token || !this.ready) return false
    this.doSend(msg, 0, false)
    return true
  }

  private async doSend(msg: Message, retryCount = 0, allowRetry = true) {
    if (!bridgeBase || !token) return

    try {
      const response = await fetch(`${bridgeBase}/send?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(msg),
      })

      if (!response.ok) {
        console.warn("[ideBridge] Send failed with status:", response.status)
        if (allowRetry && response.status >= 500 && retryCount < 3) {
          this.requeueWithBackoff(msg, retryCount)
          return
        }
        this.rejectRequest(msg, new Error(`[ideBridge] Send failed with status: ${response.status}`))
      }
    } catch (e) {
      console.warn("[ideBridge] Send failed:", e)
      if (allowRetry && retryCount < 3) {
        this.requeueWithBackoff(msg, retryCount)
        return
      }
      this.rejectRequest(msg, e)
    }
  }

  private requeueWithBackoff(msg: Message, retryCount: number) {
    const delay = Math.min(1000 * Math.pow(2, retryCount), 10000)
    const run = () => {
      if (msg.id) {
        const p = this.pending.get(msg.id)
        if (!p) return
        delete p.retry
      }
      if (this.ready) {
        this.doSend(msg, retryCount + 1)
        return
      }
      if (!msg.id || this.pending.has(msg.id)) {
        this.queue.push(msg)
      }
    }
    const timer = setTimeout(run, delay)
    if (!msg.id) return
    const p = this.pending.get(msg.id)
    if (!p) {
      clearTimeout(timer)
      return
    }
    if (p.retry) clearTimeout(p.retry)
    p.retry = timer
  }

  request<T = unknown>(type: string, payload?: unknown): Promise<Message & { result?: T }> {
    return new Promise((resolve, reject) => {
      if (!this.isInstalled()) {
        reject(new Error("[ideBridge] Bridge not installed"))
        return
      }
      const id = String(Date.now()) + Math.random().toString(36).slice(2)
      try {
        const ms = this.timeout[type]
        const timer = ms
          ? setTimeout(() => {
              this.clearPending(id)
              reject(new Error(`[ideBridge] Request timed out: ${type}`))
            }, ms)
          : undefined
        this.pending.set(id, { resolve, reject, timer })
        this.send({ id, type, payload, timestamp: Date.now() })
      } catch (e) {
        this.clearPending(id)
        reject(e)
      }
    })
  }

  private clearPending(id: string) {
    const p = this.pending.get(id)
    if (!p) return
    if (p.timer) clearTimeout(p.timer)
    if (p.retry) clearTimeout(p.retry)
    this.queue = this.queue.filter((msg) => msg.id !== id)
    this.pending.delete(id)
  }

  private rejectPending(err: Error) {
    const list = [...this.pending.entries()]
    const ids = new Set(list.map(([id]) => id))
    this.queue = this.queue.filter((msg) => !msg.id || !ids.has(msg.id))
    this.pending.clear()
    list.forEach(([, p]) => {
      if (p.timer) clearTimeout(p.timer)
      if (p.retry) clearTimeout(p.retry)
      p.reject(err)
    })
  }

  private rejectRequest(msg: Message, err: unknown) {
    if (!msg.id) return
    const p = this.pending.get(msg.id)
    if (!p) return
    this.clearPending(msg.id)
    p.reject(err)
  }

  private flushQueue() {
    const q = this.queue.splice(0, this.queue.length)
    for (const msg of q) {
      this.doSend(msg)
    }

    try {
      window.dispatchEvent(new Event("opencode:idebridge-ready"))
    } catch {
      return
    }
  }

  async storageGet(scope: StorageScope, keys: string[]): Promise<Record<string, string | undefined> | null> {
    try {
      const res = await this.request<Record<string, string | undefined>>("storageGet", { scope, keys })
      const result = res.result
      if (!result || typeof result !== "object") return {}
      return result
    } catch {
      return null
    }
  }

  async storageSet(scope: StorageScope, key: string, value: string): Promise<boolean> {
    try {
      const res = await this.request("storageSet", { scope, key, value })
      return !!res.ok
    } catch {
      return false
    }
  }
}

export const ideBridge = new IdeBridge()

export function reloadPath(path: string, operation: "write" | "edit" | "apply_patch") {
  if (!ideBridge.isInstalled()) return
  ideBridge.send({ type: "reloadPath", payload: { path, operation } })
}
