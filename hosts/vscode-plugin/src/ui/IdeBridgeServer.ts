import * as http from "http"
import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { logger } from "../globals"

export interface SessionHandlers {
  openFile: (path: string) => Promise<void>
  openUrl: (url: string) => Promise<void>
  reloadPath: (path: string) => Promise<void>
  clipboardWrite: (text: string) => Promise<void>
  saveImage?: (url: string, filename: string) => Promise<SaveImageResult | void>
  restartHost?: () => Promise<void>
  showSystemNotification?: (sessionID: string, title: string, body: string) => Promise<void>
  storageGet?: (scope: StorageScope, keys: string[]) => Promise<Record<string, string | undefined>>
  storageSet?: (scope: StorageScope, key: string, value: string) => Promise<void>
  getExtensionVersion?: () => Promise<Record<string, unknown>>
  checkForUpdates?: () => Promise<Record<string, unknown>>
  getUpdateInfo?: () => Promise<Record<string, unknown>>
  installUpdate?: (version: string) => Promise<void>
}

export interface SaveImageResult {
  cancelled: boolean
}

type StorageScope = "global" | "workspace" | "mem"

interface SessionMetadata {
  minVersion?: string
  restartMode?: "window" | "ide"
}

interface Session {
  id: string
  token: string
  handlers: SessionHandlers
  metadata: SessionMetadata
  sseClients: Set<http.ServerResponse>
  pendingOpenSessionID?: string
}

interface Message {
  id?: string
  replyTo?: string
  type?: string
  payload?: any
  ok?: boolean
  error?: string
  timestamp: number
}

class IdeBridgeServer {
  private server: http.Server | null = null
  private port: number = 0
  private sessions: Map<string, Session> = new Map()
  private keepaliveInterval: NodeJS.Timeout | null = null
  private starting: Promise<void> | null = null

  async start(): Promise<void> {
    if (this.starting) return this.starting
    if (this.server) return

    this.starting = new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res))
      this.server.listen(0, "127.0.0.1", () => {
        const addr = this.server!.address()
        if (addr && typeof addr !== "string") {
          this.port = addr.port
          console.log(`IdeBridgeServer started on port ${this.port}`)

          // Start keepalive timer to prevent tunnel timeouts
          if (!this.keepaliveInterval) {
            this.keepaliveInterval = setInterval(() => this.sendKeepaliveToAll(), 15000)
          }

          this.starting = null
          resolve()
        } else {
          this.server?.close()
          this.server = null
          this.port = 0
          this.starting = null
          reject(new Error("Failed to get server port"))
        }
      })
      this.server.on("error", (e) => {
        this.server?.close()
        this.server = null
        this.port = 0
        this.starting = null
        logger.appendLine(`IdeBridgeServer error: ${e}`)
        reject(e)
      })
    })
    return this.starting
  }

  stop(): void {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval)
      this.keepaliveInterval = null
    }
    this.server?.close()
    this.server = null
    this.port = 0
    this.starting = null
    this.sessions.forEach((session) => {
      session.sseClients.forEach((res) => res.end())
    })
    this.sessions.clear()
  }

  async createSession(
    handlers: SessionHandlers,
    metadata: SessionMetadata = {},
  ): Promise<{ sessionId: string; baseUrl: string; token: string }> {
    await this.start() // ensure server is running

    const sessionId = crypto.randomUUID()
    const token = crypto.randomUUID()

    this.sessions.set(sessionId, {
      id: sessionId,
      token,
      handlers,
      metadata,
      sseClients: new Set(),
    })

    return {
      sessionId,
      baseUrl: `http://127.0.0.1:${this.port}/idebridge/${sessionId}`,
      token,
    }
  }

  removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      // Close all SSE clients
      session.sseClients.forEach((res) => res.end())
      this.sessions.delete(sessionId)
    }
  }

  send(sessionId: string, message: Omit<Message, "timestamp">): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    const msg: Message = { ...message, timestamp: Date.now() }
    this.broadcastSSE(session, JSON.stringify(msg))
  }

  openSession(bridgeSessionID: string, sessionID: string): boolean {
    const session = this.sessions.get(bridgeSessionID)
    if (!session) return false
    if (session.sseClients.size === 0) {
      session.pendingOpenSessionID = sessionID
      return true
    }

    this.send(bridgeSessionID, {
      type: "openSession",
      payload: { sessionID },
    })
    return true
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    res.setHeader("Access-Control-Allow-Headers", "Content-Type")

    if (req.method === "OPTIONS") {
      res.writeHead(204)
      res.end()
      return
    }

    // Parse URL: /idebridge/{sessionId}/{action}?token=...
    const url = new URL(req.url || "/", `http://127.0.0.1:${this.port}`)
    const pathParts = url.pathname.split("/").filter(Boolean)

    if (pathParts.length < 3 || pathParts[0] !== "idebridge") {
      res.writeHead(404)
      res.end()
      return
    }

    const sessionId = pathParts[1]
    const action = pathParts[2]
    const token = url.searchParams.get("token")
    const session = this.sessions.get(sessionId)

    if (!session || session.token !== token) {
      logger.appendLine(`IdeBridgeServer unauthorized: sessionId=${sessionId} action=${action}`)
      res.writeHead(401)
      res.end()
      return
    }

    switch (action) {
      case "events":
        this.handleSSE(req, res, session)
        break
      case "send":
        this.handleSend(req, res, session)
        break
      default:
        res.writeHead(404)
        res.end()
    }
  }

  private handleSSE(req: http.IncomingMessage, res: http.ServerResponse, session: Session): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no", // Disable nginx/proxy buffering
    })

    session.sseClients.add(res)

    // Send initial connected event with optional metadata
    try {
      const data: Record<string, any> = {}
      if (session.metadata.minVersion) data.minVersion = session.metadata.minVersion
      if (session.metadata.restartMode) data.restartMode = session.metadata.restartMode
      const connected = JSON.stringify(data)
      res.write(`event: connected\ndata: ${connected}\n\n`)
      if (session.pendingOpenSessionID) {
        const sessionID = session.pendingOpenSessionID
        session.pendingOpenSessionID = undefined
        this.openSession(session.id, sessionID)
      }
    } catch (e) {
      logger.appendLine(`IdeBridgeServer failed to init SSE: ${e}`)
    }

    // Handle client disconnect
    req.on("close", () => {
      session.sseClients.delete(res)
    })
  }

  private async handleSend(req: http.IncomingMessage, res: http.ServerResponse, session: Session): Promise<void> {
    if (req.method !== "POST") {
      res.writeHead(405)
      res.end()
      return
    }

    let msg: Message | undefined
    try {
      const body = await this.readBody(req)
      msg = JSON.parse(body)
      if (!msg) {
        throw new Error("Missing message")
      }

      const type = msg.type
      const id = msg.id
      const payload = msg.payload

      switch (type) {
        case "openFile":
          if (payload?.path) {
            await session.handlers.openFile(payload.path)
            this.replyOk(session, id)
          } else {
            this.replyError(session, id, "Missing path")
          }
          break

        case "openUrl":
          if (payload?.url) {
            await session.handlers.openUrl(payload.url)
            this.replyOk(session, id)
          } else {
            this.replyError(session, id, "Missing url")
          }
          break

        case "reloadPath":
          if (payload?.path) {
            await session.handlers.reloadPath(payload.path)
            this.replyOk(session, id)
          } else {
            this.replyError(session, id, "Missing path")
          }
          break

        case "clipboardWrite":
          if (typeof payload?.text === "string") {
            await session.handlers.clipboardWrite(payload.text)
            this.replyOk(session, id)
          } else {
            this.replyError(session, id, "Missing text")
          }
          break

        case "saveImage":
          if (!session.handlers.saveImage) {
            this.replyError(session, id, "saveImage not supported")
            break
          }
          if (
            typeof payload?.url !== "string" ||
            typeof payload?.filename !== "string" ||
            payload.url.trim().length === 0 ||
            payload.filename.trim().length === 0
          ) {
            this.replyError(session, id, "Missing url or filename")
            break
          }
          const result = (await session.handlers.saveImage(payload.url, payload.filename)) ?? { cancelled: false }
          this.replyOk(session, id, result)
          break

        case "restartHost":
          if (!session.handlers.restartHost) {
            this.replyError(session, id, "restartHost not supported")
            break
          }
          // Reply before executing reload so the client receives OK
          // before the extension host tears down the transport.
          this.replyOk(session, id)
          setTimeout(() => {
            void session.handlers.restartHost!().catch((e) => {
              logger.appendLine(`[${session.id}] restartHost failed after reply: ${e}`)
            })
          }, 0)
          break

        case "showSystemNotification":
          if (!session.handlers.showSystemNotification) {
            this.replyError(session, id, "showSystemNotification not supported")
            break
          }
          if (
            typeof payload?.sessionID !== "string" ||
            typeof payload?.title !== "string" ||
            typeof payload?.body !== "string" ||
            !payload.sessionID.trim() ||
            !payload.title.trim() ||
            !payload.body.trim()
          ) {
            this.replyError(session, id, "Missing sessionID, title, or body")
            break
          }
          await session.handlers.showSystemNotification(
            payload.sessionID.trim(),
            payload.title.trim(),
            payload.body.trim(),
          )
          this.replyOk(session, id)
          break

        case "ensureAndOpenFile": {
          if (typeof payload?.path !== "string") {
            this.replyError(session, id, "Missing path")
            break
          }
          try {
            const raw = payload.path.trim()
            if (!raw) {
              this.replyError(session, id, "Missing path")
              break
            }

            let target = raw
            if (/^~($|[\\/])/.test(target)) {
              target = path.join(os.homedir(), target.slice(1))
            }

            fs.mkdirSync(path.dirname(target), { recursive: true })
            if (!fs.existsSync(target)) {
              fs.writeFileSync(target, "")
            }
            await session.handlers.openFile(target)
            this.replyOk(session, id)
          } catch (e) {
            this.replyError(session, id, `ensureAndOpenFile failed: ${e}`)
          }
          break
        }

        case "storageGet": {
          if (!session.handlers.storageGet) {
            this.replyError(session, id, "storageGet not supported")
            break
          }
          const scope = payload?.scope
          if (scope !== "global" && scope !== "workspace" && scope !== "mem") {
            this.replyError(session, id, "Invalid scope")
            break
          }
          const keys: string[] = Array.isArray(payload?.keys) ? payload.keys : []
          const storageResult = await session.handlers.storageGet(scope, keys)
          if (id) {
            this.broadcastSSE(
              session,
              JSON.stringify({
                replyTo: id,
                ok: true,
                result: storageResult,
                timestamp: Date.now(),
              }),
            )
          }
          break
        }

        case "storageSet": {
          if (!session.handlers.storageSet) {
            this.replyError(session, id, "storageSet not supported")
            break
          }
          const scope = payload?.scope
          if (scope !== "global" && scope !== "workspace" && scope !== "mem") {
            this.replyError(session, id, "Invalid scope")
            break
          }
          if (typeof payload?.key === "string" && typeof payload?.value === "string") {
            await session.handlers.storageSet(scope, payload.key, payload.value)
            this.replyOk(session, id)
          } else {
            this.replyError(session, id, "Missing key or value")
          }
          break
        }

        case "getUpdateInfo": {
          if (!session.handlers.getUpdateInfo) {
            this.replyError(session, id, "getUpdateInfo not supported")
            break
          }
          const updateInfo = await session.handlers.getUpdateInfo()
          if (id) {
            this.broadcastSSE(
              session,
              JSON.stringify({
                replyTo: id,
                ok: true,
                result: updateInfo,
                timestamp: Date.now(),
              }),
            )
          }
          break
        }

        case "getExtensionVersion": {
          if (!session.handlers.getExtensionVersion) {
            this.replyError(session, id, "getExtensionVersion not supported")
            break
          }
          const result = await session.handlers.getExtensionVersion()
          if (id) {
            this.broadcastSSE(
              session,
              JSON.stringify({
                replyTo: id,
                ok: true,
                result,
                timestamp: Date.now(),
              }),
            )
          }
          break
        }

        case "checkForUpdates": {
          if (!session.handlers.checkForUpdates) {
            this.replyError(session, id, "checkForUpdates not supported")
            break
          }
          const result = await session.handlers.checkForUpdates()
          if (id) {
            this.broadcastSSE(
              session,
              JSON.stringify({
                replyTo: id,
                ok: true,
                result,
                timestamp: Date.now(),
              }),
            )
          }
          break
        }

        case "installUpdate": {
          if (!session.handlers.installUpdate) {
            this.replyError(session, id, "installUpdate not supported")
            break
          }
          if (typeof payload?.version !== "string" || payload.version.trim().length === 0) {
            this.replyError(session, id, "Missing version")
            break
          }
          await session.handlers.installUpdate(payload.version)
          this.replyOk(session, id)
          break
        }

        default:
          this.replyError(session, id, "unsupported message type")
      }

      res.writeHead(204)
    } catch (e) {
      if (msg?.id) {
        this.replyError(session, msg.id, `${msg.type || "request"} failed: ${e}`)
      }
      logger.appendLine(`[${session.id}] handleSend error (msg=${msg?.id ?? "?"}): ${e}`)
      res.writeHead(400)
    }
    res.end()
  }

  private replyOk(session: Session, id?: string, result?: unknown): void {
    if (!id) return
    this.broadcastSSE(
      session,
      JSON.stringify({
        replyTo: id,
        ok: true,
        ...(result === undefined ? {} : { result }),
        timestamp: Date.now(),
      }),
    )
  }

  private replyError(session: Session, id: string | undefined, error: string): void {
    if (!id) return
    this.broadcastSSE(
      session,
      JSON.stringify({
        replyTo: id,
        ok: false,
        error,
        timestamp: Date.now(),
      }),
    )
  }

  private sendKeepaliveToAll(): void {
    this.sessions.forEach((session) => {
      const deadClients: http.ServerResponse[] = []
      session.sseClients.forEach((client) => {
        try {
          client.write(": ping\n\n")
        } catch {
          deadClients.push(client)
        }
      })
      deadClients.forEach((client) => {
        session.sseClients.delete(client)
        try {
          client.end()
        } catch {}
      })
    })
  }

  private broadcastSSE(session: Session, json: string): void {
    const deadClients: http.ServerResponse[] = []

    session.sseClients.forEach((client) => {
      try {
        client.write(`event: message\ndata: ${json}\n\n`)
      } catch {
        deadClients.push(client)
      }
    })

    deadClients.forEach((client) => {
      session.sseClients.delete(client)
      try {
        client.end()
      } catch {}
    })
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = ""
      req.on("data", (chunk) => (body += chunk))
      req.on("end", () => resolve(body))
      req.on("error", reject)
    })
  }
}

// Singleton instance
export const bridgeServer = new IdeBridgeServer()
