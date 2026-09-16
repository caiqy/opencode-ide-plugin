import { Context, Effect, Layer } from "effect"

export interface AcpToolDefinition {
  id: string
  name: string
  description?: string
  enabled?: boolean
  parametersSchema?: Record<string, unknown>
}

export interface AcpCategoryDefinition {
  id: string
  name: string
  description?: string
  status?: "connected" | "disabled" | "unavailable"
  enabled?: boolean
  tools: AcpToolDefinition[]
}

export interface IdeAcpCapabilitiesResult {
  categories: AcpCategoryDefinition[]
}

export interface Interface {
  readonly isConfigured: () => boolean
  readonly register: (url: string, token: string) => void
  readonly getCapabilities: () => Effect.Effect<IdeAcpCapabilitiesResult | null>
  readonly executeTool: (
    category: string,
    toolId: string,
    parameters: Record<string, unknown>,
    abortSignal?: AbortSignal,
  ) => Effect.Effect<{ output: string }>
}

export function isValidBridgeUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr)
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return false
    const hostname = parsed.hostname.toLowerCase()
    const isLoopback =
      hostname === "127.0.0.1" ||
      hostname === "localhost" ||
      hostname === "[::1]" ||
      hostname === "::1"
    const isValidProtocol = parsed.protocol === "http:" || parsed.protocol === "https:"
    const isValidPath = /^\/idebridge\/[a-zA-Z0-9_-]+$/.test(parsed.pathname)
    return isLoopback && isValidProtocol && isValidPath
  } catch {
    return false
  }
}

class HostBridgeClient {
  private url?: string
  private token?: string
  private pending = new Map<
    string,
    {
      resolve: (value: any) => void
      reject: (err: Error) => void
      timer: NodeJS.Timeout
    }
  >()
  private abortController?: AbortController
  private capabilitiesCache: IdeAcpCapabilitiesResult | null = null
  private connecting = false
  private readyResolver?: () => void
  private readyPromise?: Promise<void>

  constructor() {
    const envUrl = process.env.OPENCODE_IDE_BRIDGE_URL
    const envToken = process.env.OPENCODE_IDE_BRIDGE_TOKEN
    if (envUrl && envToken && isValidBridgeUrl(envUrl) && envToken.trim()) {
      this.url = envUrl
      this.token = envToken.trim()
    }
  }

  isConfigured(): boolean {
    return Boolean(this.url && this.token)
  }

  register(url: string, token: string): void {
    if (!isValidBridgeUrl(url) || !token || typeof token !== "string" || !token.trim()) {
      return
    }
    if (this.url !== url || this.token !== token) {
      this.disconnect()
    }
    this.url = url
    this.token = token.trim()
    this.capabilitiesCache = null
  }

  private disconnect(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = undefined
    }
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error("[IdeHostBridge] Disconnected from host"))
    }
    this.pending.clear()
    this.connecting = false
    this.readyPromise = undefined
    this.readyResolver = undefined
  }

  private async ensureConnected(): Promise<void> {
    if (!this.url || !this.token) return
    if (this.readyPromise) return this.readyPromise

    this.connecting = true
    const sseUrl = `${this.url.replace(/\/+$/, "")}/events?token=${encodeURIComponent(this.token)}`
    const controller = new AbortController()
    this.abortController = controller

    this.readyPromise = new Promise<void>((resolve) => {
      this.readyResolver = resolve
      // 最多等待 3 秒超时，超时也继续向下发送，防止卡死
      setTimeout(() => resolve(), 3000)
    })

    void (async () => {
      try {
        const res = await fetch(sseUrl, {
          signal: controller.signal,
          headers: { Accept: "text/event-stream" },
        })
        this.connecting = false
        if (!res.ok || !res.body) {
          this.abortController = undefined
          this.readyResolver?.()
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        let resolvedReady = false

        while (!controller.signal.aborted) {
          const { done, value } = await reader.read()
          if (done) break

          if (!resolvedReady) {
            resolvedReady = true
            this.readyResolver?.()
          }

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() || ""

          for (const rawLine of lines) {
            const line = rawLine.trim()
            if (!line.startsWith("data:")) continue
            const dataStr = line.slice(5).trim()
            if (!dataStr) continue
            try {
              const msg = JSON.parse(dataStr)
              if (msg && typeof msg.replyTo === "string") {
                const p = this.pending.get(msg.replyTo)
                if (p) {
                  clearTimeout(p.timer)
                  this.pending.delete(msg.replyTo)
                  if (msg.ok === false) {
                    p.reject(new Error(msg.error || `[IdeHostBridge] Request failed`))
                  } else {
                    p.resolve(msg.result)
                  }
                }
              }
            } catch {
              // Ignore non-json or malformed SSE line
            }
          }
        }
      } catch {
        // SSE disconnected, allow reconnect on next request
      } finally {
        this.abortController = undefined
        this.connecting = false
        this.readyPromise = undefined
        this.readyResolver = undefined
      }
    })()

    return this.readyPromise
  }

  async request<T>(
    type: string,
    payload: Record<string, unknown> = {},
    timeoutMs = 30000,
    abortSignal?: AbortSignal,
  ): Promise<T> {
    if (abortSignal?.aborted) {
      throw new Error(`[IdeHostBridge] Request aborted before sending: ${type}`)
    }
    if (!this.url || !this.token) {
      throw new Error("[IdeHostBridge] Host bridge is not configured")
    }

    await this.ensureConnected()

    const id = `acp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const sendUrl = `${this.url.replace(/\/+$/, "")}/send?token=${encodeURIComponent(this.token)}`

    let settled = false
    let cleanup = () => {}

    const promise = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        settle(new Error(`[IdeHostBridge] Request timed out after ${timeoutMs}ms: ${type}`))
      }, timeoutMs)

      const onAbort = () => {
        settle(new Error(`[IdeHostBridge] Request aborted: ${type}`))
      }

      if (abortSignal) {
        abortSignal.addEventListener("abort", onAbort, { once: true })
      }

      cleanup = () => {
        clearTimeout(timer)
        if (abortSignal) abortSignal.removeEventListener("abort", onAbort)
        this.pending.delete(id)
      }

      const settle = (err: Error | null, result?: any) => {
        if (settled) return
        settled = true
        cleanup()
        if (err) {
          reject(err)
        } else {
          resolve(result)
        }
      }

      this.pending.set(id, {
        resolve: (val) => settle(null, val),
        reject: (err) => settle(err),
        timer,
      })
    })

    // 在发送请求前预先接管 rejection，防止异步竞争导致的 unhandledRejection
    const handledPromise = promise.then(
      (val) => val,
      (err) => Promise.reject(err),
    )

    try {
      const response = await fetch(sendUrl, {
        method: "POST",
        signal: abortSignal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          type,
          payload,
          timestamp: Date.now(),
        }),
      })

      if (!response.ok) {
        const p = this.pending.get(id)
        if (p) p.reject(new Error(`[IdeHostBridge] Send failed with HTTP status ${response.status}`))
      }
    } catch (err: any) {
      const p = this.pending.get(id)
      if (p) p.reject(err instanceof Error ? err : new Error(String(err)))
    }

    return handledPromise
  }

  async getCapabilities(): Promise<IdeAcpCapabilitiesResult | null> {
    if (!this.isConfigured()) return null
    if (this.capabilitiesCache) return this.capabilitiesCache

    try {
      const res = await this.request<IdeAcpCapabilitiesResult>("getAcpCapabilities", {}, 10000)
      if (res && Array.isArray(res.categories)) {
        this.capabilitiesCache = res
        return res
      }
      return null
    } catch {
      return null
    }
  }

  async executeTool(
    category: string,
    toolId: string,
    parameters: Record<string, unknown>,
    abortSignal?: AbortSignal,
  ): Promise<{ output: string }> {
    const res = await this.request<{ output?: string } | string>(
      "executeAcpTool",
      { category, toolId, parameters },
      60000,
      abortSignal,
    )

    if (typeof res === "string") {
      return { output: res }
    }
    if (res && typeof res.output === "string") {
      return { output: res.output }
    }
    return { output: JSON.stringify(res ?? "Tool executed successfully") }
  }
}

const clientInstance = new HostBridgeClient()

export class Service extends Context.Service<Service, Interface>()("@opencode/IdeHostBridge") {}

export const defaultService: Interface = {
  isConfigured: () => clientInstance.isConfigured(),
  register: (url: string, token: string) => clientInstance.register(url, token),
  getCapabilities: () => Effect.promise(() => clientInstance.getCapabilities()),
  executeTool: (category: string, toolId: string, parameters: Record<string, unknown>, abortSignal?: AbortSignal) =>
    Effect.promise(() => clientInstance.executeTool(category, toolId, parameters, abortSignal)),
}

export const layer = Layer.succeed(Service, defaultService)

export const defaultLayer = layer

export * as IdeHostBridge from "./host-bridge"
