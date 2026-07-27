import * as vscode from "vscode"
import { BackendConnection } from "../backend/BackendLauncher"
import { SettingsManager } from "../settings/SettingsManager"
import { CommunicationBridge } from "./CommunicationBridge"
import { FileMonitor } from "../utils/FileMonitor"
import { errorHandler } from "../utils/ErrorHandler"
import { PathInserter } from "../utils/PathInserter"
import { getUpdateService, logger } from "../globals"
import type { SaveImageResult } from "./IdeBridgeServer"
import { bridgeServer } from "./IdeBridgeServer"
import { showSystemNotification } from "./systemNotification"

/**
 * Shared webview controller to manage common UI lifecycle and messaging
 * Used by both WebviewManager (editor tab) and ActivityBarProvider (view tab)
 */
export interface WebviewControllerOptions {
  webview: vscode.Webview
  context: vscode.ExtensionContext
  settingsManager?: SettingsManager
  storageGet: (scope: "global" | "workspace" | "mem", keys: string[]) => Promise<Record<string, string | undefined>>
  storageSet: (scope: "global" | "workspace" | "mem", key: string, value: string) => Promise<void>
  readFile?: (uri: vscode.Uri) => Thenable<Uint8Array>
  writeFile?: (uri: vscode.Uri, content: Uint8Array) => Thenable<void>
}

export class WebviewController {
  private webview: vscode.Webview
  private context: vscode.ExtensionContext
  private settingsManager?: SettingsManager
  private communicationBridge?: CommunicationBridge
  private fileMonitor?: FileMonitor
  private connection?: BackendConnection
  private disposables: vscode.Disposable[] = []
  private bridgeSessionId: string | null = null
  private storageGet: (
    scope: "global" | "workspace" | "mem",
    keys: string[],
  ) => Promise<Record<string, string | undefined>>
  private storageSet: (scope: "global" | "workspace" | "mem", key: string, value: string) => Promise<void>
  private readFile: (uri: vscode.Uri) => Thenable<Uint8Array>
  private writeFile: (uri: vscode.Uri, content: Uint8Array) => Thenable<void>
  private uiBaseUrl?: string
  private disposed = false

  constructor(opts: WebviewControllerOptions) {
    this.webview = opts.webview
    this.context = opts.context
    this.settingsManager = opts.settingsManager
    this.storageGet = opts.storageGet
    this.storageSet = opts.storageSet
    this.readFile = opts.readFile ?? ((uri) => vscode.workspace.fs.readFile(uri))
    this.writeFile = opts.writeFile ?? ((uri, content) => vscode.workspace.fs.writeFile(uri, content))
  }

  getCommunicationBridge(): CommunicationBridge | undefined {
    return this.communicationBridge
  }

  openSession(sessionID: string): boolean {
    if (!this.bridgeSessionId) return false
    return bridgeServer.openSession(this.bridgeSessionId, sessionID)
  }

  /**
   * Detect the well-known Chromium Service Worker InvalidState error that
   * affects VS Code webviews (upstream: microsoft/vscode#125993).
   * Exposed as static so callers can implement their own retry loops.
   */
  static isServiceWorkerInvalidStateError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return (
      message.includes("Could not register service worker") ||
      message.includes("Failed to register a ServiceWorker") ||
      message.toLowerCase().includes("document is in an invalid state")
    )
  }

  /**
   * Retry deadline for SW InvalidState errors (ms).
   * Chromium's SW registration can stay broken for several seconds after rapid
   * webview dispose/recreate cycles, so we keep retrying with exponential
   * backoff until this deadline is reached.
   */
  private static readonly SW_RETRY_DEADLINE_MS = 30_000
  private static readonly SW_RETRY_INITIAL_DELAY_MS = 200
  private static readonly SW_RETRY_MAX_DELAY_MS = 3_000

  private ensureLoadNotDisposed(): void {
    if (this.disposed) {
      throw new Error("WebviewController.load cancelled: controller disposed")
    }
  }

  private async setHtmlWithRetry(html: string): Promise<void> {
    // When webviews are disposed/recreated rapidly (e.g. quick project switching),
    // VS Code may throw a transient SW registration InvalidStateError during webview init.
    // We retry with exponential backoff for up to 30 seconds to ride out the Chromium bug.
    const deadline = Date.now() + WebviewController.SW_RETRY_DEADLINE_MS
    let delay = WebviewController.SW_RETRY_INITIAL_DELAY_MS
    let attempt = 0

    while (true) {
      if (this.disposed) return
      attempt++
      try {
        this.webview.html = html
        if (attempt > 1) {
          logger.appendLine(`webview.html assignment succeeded on attempt ${attempt}`)
        }
        return
      } catch (error) {
        const remaining = deadline - Date.now()
        if (!WebviewController.isServiceWorkerInvalidStateError(error) || remaining <= 0) {
          throw error
        }
        const actualDelay = Math.min(delay, remaining)
        logger.appendLine(
          `webview.html assignment failed (attempt ${attempt}) due to transient SW InvalidState; ` +
            `retrying in ${actualDelay}ms (${Math.round(remaining / 1000)}s remaining)`,
        )
        await new Promise((resolve) => setTimeout(resolve, actualDelay))
        delay = Math.min(delay * 2, WebviewController.SW_RETRY_MAX_DELAY_MS)
      }
    }
  }

  async load(connection: BackendConnection): Promise<void> {
    this.connection = connection
    this.disposed = false
    const updateService = getUpdateService()
    let attachedSessionId: string | null = null
    let startedFileMonitor = false

    try {
      // Initialize communication bridge
      this.communicationBridge = new CommunicationBridge({
        webview: this.webview,
        context: this.context,
      })

      // Configure callbacks for extended message handling

      this.communicationBridge.setReadUrisCallback(async (uris: string[]) => {
        await this.handleReadUris(uris)
      })

      // Make PathInserter aware of the active communication bridge
      // NOTE: PathInserter is now set by container visibility (editor panel / sidebar).

      // Create bridge session with handlers from CommunicationBridge
      const session = await bridgeServer.createSession(
        {
          openFile: (p) => this.communicationBridge!.handleOpenFile(p),
          openUrl: (url) => this.communicationBridge!.handleOpenUrl(url),
          reloadPath: (p) => this.communicationBridge!.handleReloadPath(p),
          clipboardWrite: async (text) => {
            await vscode.env.clipboard.writeText(text)
          },
          saveImage: async (url, filename) => this.saveImage(url, filename),
          restartHost: async () => {
            await vscode.commands.executeCommand("workbench.action.reloadWindow").then(
              () => undefined,
              (e) => logger.appendLine(`restartHost reload failed: ${e}`),
            )
          },
          showSystemNotification: async (sessionID, title, body) => {
            if (!this.bridgeSessionId) {
              logger.appendLine(`system notification skipped without bridge session: ${sessionID}`)
              return
            }

            await showSystemNotification({
              bridgeSessionID: this.bridgeSessionId,
              sessionID,
              title,
              body,
              extensionUri: this.context.extensionUri,
            })
          },
          storageGet: this.storageGet,
          storageSet: this.storageSet,
          getExtensionVersion: async () => {
            return { version: this.context.extension.packageJSON.version }
          },
          checkForUpdates: updateService
            ? async () => {
                return (await updateService.checkForUpdates()) as Record<string, unknown>
              }
            : undefined,
          getUpdateInfo: updateService
            ? async () => {
                return updateService.getUpdateInfo() as Record<string, unknown>
              }
            : undefined,
          installUpdate: updateService
            ? async (version) => {
                await updateService.installUpdate(version)
              }
            : undefined,
        },
        {
          restartMode: "window",
        },
      )
      this.bridgeSessionId = session.sessionId
      this.ensureLoadNotDisposed()
      if (updateService) {
        updateService.attachSession(session.sessionId, (type, payload) => {
          bridgeServer.send(session.sessionId, {
            type,
            payload,
          })
        })
        attachedSessionId = session.sessionId
        void updateService.checkNow().catch((error) => {
          logger.appendLine(`update check failed for session ${session.sessionId}: ${error}`)
        })
      }

      // Tell CommunicationBridge to route ideBridge messages through SSE
      this.communicationBridge.setBridgeSession(session.sessionId, bridgeServer)
      this.ensureLoadNotDisposed()

      // Initialize file monitor (best effort)
      try {
        this.fileMonitor = new FileMonitor()
        this.fileMonitor.startMonitoring((files: string[], current?: string) => {
          try {
            if (this.bridgeSessionId) {
              // Normalize paths for cross-platform consistency (especially Windows)
              const normalizedFiles = files.map((f) => this.normalizePath(f)).filter((f): f is string => f !== null)
              const normalizedCurrent = current ? this.normalizePath(current) : undefined
              bridgeServer.send(this.bridgeSessionId, {
                type: "updateOpenedFiles",
                payload: { openedFiles: normalizedFiles, currentFile: normalizedCurrent },
              })
            }
          } catch (e) {
            logger.appendLine(`updateOpenedFiles failed: ${e}`)
          }
        })
        startedFileMonitor = true
      } catch (e) {
        logger.appendLine(`FileMonitor init failed: ${e}`)
      }
      this.ensureLoadNotDisposed()

      // Use asExternalUri for Remote-SSH compatibility
      const externalUi = await vscode.env.asExternalUri(vscode.Uri.parse(connection.uiBase))
      this.uiBaseUrl = externalUi.toString()
      this.ensureLoadNotDisposed()
      const externalBridge = await vscode.env.asExternalUri(vscode.Uri.parse(session.baseUrl))
      this.ensureLoadNotDisposed()

      // Build iframe src with bridge params
      const uiUrlWithMode = this.buildUiUrlWithMode(externalUi.toString())
      const iframeSrc = `${uiUrlWithMode}&ideBridge=${encodeURIComponent(externalBridge.toString())}&ideBridgeToken=${encodeURIComponent(session.token)}`

      // Extract origins for dynamic CSP (Remote-SSH compatibility)
      const uiOrigin = new URL(externalUi.toString()).origin
      const bridgeOrigin = new URL(externalBridge.toString()).origin

      const html = await this.generateHtmlContent(iframeSrc, { uiOrigin, bridgeOrigin })
      this.ensureLoadNotDisposed()
      await this.setHtmlWithRetry(html)

      // Message handling is now done entirely by CommunicationBridge
    } catch (error) {
      this.rollbackFailedLoad({
        attachedSessionId,
        startedFileMonitor,
        updateService,
      })

      // If we were disposed while loading (common during rapid project switching),
      // treat as a cancellation and avoid surfacing an error toast.
      if (this.disposed) {
        logger.appendLine(`WebviewController.load cancelled (disposed during load): ${error}`)
        return
      }
      await errorHandler.handleWebviewLoadError(error instanceof Error ? error : new Error(String(error)), {
        connection,
      })
      throw error
    }
  }

  private rollbackFailedLoad(input: {
    attachedSessionId: string | null
    startedFileMonitor: boolean
    updateService?: ReturnType<typeof getUpdateService>
  }): void {
    if (input.startedFileMonitor) {
      try {
        this.fileMonitor?.stopMonitoring()
      } catch {}
      this.fileMonitor = undefined
    }

    if (input.attachedSessionId) {
      try {
        input.updateService?.detachSession(input.attachedSessionId)
      } catch {}
    }

    if (this.bridgeSessionId) {
      try {
        bridgeServer.removeSession(this.bridgeSessionId)
      } catch {}
      this.bridgeSessionId = null
    }

    try {
      this.communicationBridge?.dispose()
    } catch {}
    this.communicationBridge = undefined
    this.uiBaseUrl = undefined
  }

  private async handleReadUris(uris: string[]): Promise<void> {
    try {
      logger.appendLine(`Reading ${uris.length} URIs from webview request`)

      // Separate files and directories for proper handling
      const filePaths: string[] = []
      const directoryPaths: string[] = []

      const results = await Promise.all(
        uris.map(async (u) => {
          try {
            const uri = vscode.Uri.parse(u)
            // For non-file URIs (e.g. vscode-remote://ssh-remote+host/path),
            // fsPath includes the authority as a UNC prefix (//ssh-remote+host/path)
            // which is not a valid filesystem path. Use uri.path instead.
            const filePath = uri.scheme === "file" ? uri.fsPath : uri.path
            // For vscode.workspace.fs operations, keep the original URI so the
            // remote extension host resolves the file on the correct machine
            // (works for file://, vscode-remote://, wsl://, etc.)
            const fileUri = uri

            try {
              const stat = await vscode.workspace.fs.stat(fileUri)
              if (stat.type === vscode.FileType.File) {
                filePaths.push(filePath)
              } else if (stat.type === vscode.FileType.Directory) {
                directoryPaths.push(filePath)
              }
            } catch {
              // If stat fails, assume it's a file
              filePaths.push(filePath)
            }

            // Create webview-safe URI for direct display
            const webviewUri = this.webview.asWebviewUri(fileUri)

            // Optionally read file contents as base64 for fallback
            let data: string | undefined
            try {
              const buf = await vscode.workspace.fs.readFile(fileUri)
              data = Buffer.from(buf).toString("base64")
            } catch {
              // File reading failed, but webviewUri might still work
            }

            return {
              uri: u,
              ok: true,
              webviewUri: String(webviewUri),
              data,
            }
          } catch (err) {
            return {
              uri: u,
              ok: false,
              error: String(err),
            }
          }
        }),
      )

      // Send results back to webview for display
      this.webview.postMessage({
        type: "readUrisResult",
        results,
        filePaths,
        directoryPaths,
      })

      logger.appendLine(
        `Processed ${results.length} URIs: ${filePaths.length} files, ${directoryPaths.length} directories`,
      )
    } catch (error) {
      logger.appendLine(`Error handling readUris: ${error}`)

      // Send error response
      this.webview.postMessage({
        type: "readUrisResult",
        results: uris.map((uri) => ({
          uri,
          ok: false,
          error: "Failed to process URI request",
        })),
      })
    }
  }

  private async saveImage(url: string, filename: string): Promise<SaveImageResult> {
    const name = filename.split(/[\\/]/).filter(Boolean).pop() || filename
    const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri
      ? vscode.Uri.joinPath(vscode.workspace.workspaceFolders[0].uri, name)
      : undefined
    const target = await vscode.window.showSaveDialog({
      defaultUri,
      saveLabel: "Save Image",
    })

    if (!target) {
      return { cancelled: true }
    }

    const bytes = url.startsWith("data:") ? this.readDataUrl(url) : await this.fetchBytes(url)
    await this.writeFile(target, bytes)
    return { cancelled: false }
  }

  private readDataUrl(url: string): Uint8Array {
    const comma = url.indexOf(",")
    if (comma < 0 || !url.startsWith("data:")) {
      throw new Error("Unsupported data URL")
    }

    const meta = url.slice(5, comma).split(";")
    if (!meta.slice(1).some((part) => part.trim().toLowerCase() === "base64")) {
      throw new Error("Unsupported data URL")
    }

    const data = url.slice(comma + 1)
    if (!this.isValidBase64(data)) {
      throw new Error("Invalid base64 data URL")
    }

    return Uint8Array.from(Buffer.from(data, "base64"))
  }

  private async fetchBytes(url: string): Promise<Uint8Array> {
    if (typeof globalThis.fetch !== "function") {
      throw new Error("fetch is not available")
    }

    const response = await globalThis.fetch(this.resolveImageUrl(url))
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`)
    }

    return new Uint8Array(await response.arrayBuffer())
  }

  private resolveImageUrl(url: string): string {
    try {
      return new URL(url).toString()
    } catch {}

    if (!this.uiBaseUrl) {
      return url
    }

    return new URL(url, this.uiBaseUrl).toString()
  }

  private isValidBase64(value: string): boolean {
    if (value.length === 0) {
      return true
    }

    if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
      return false
    }

    return Buffer.from(value, "base64").toString("base64") === value
  }

  private buildUiUrlWithMode(base: string): string {
    let uiMode = "Terminal"
    try {
      const config = vscode.workspace.getConfiguration("opencode")
      uiMode = config.get<string>("uiMode", "Terminal")
    } catch {}
    return base.includes("?") ? `${base}&mode=${uiMode}` : `${base}?mode=${uiMode}`
  }

  private async generateHtmlContent(
    uiUrl: string,
    origins: { uiOrigin: string; bridgeOrigin: string },
  ): Promise<string> {
    const htmlUri = vscode.Uri.joinPath(this.context.extensionUri, "resources", "webview", "index.html")
    const bytes = await this.readFile(htmlUri)
    let html = Buffer.from(bytes).toString("utf8")

    // Build dynamic CSP origins - include both specific origins and localhost fallbacks
    const cspOrigins = this.buildCspOrigins(origins.uiOrigin, origins.bridgeOrigin)

    html = html
      .replace(/\$\{uiUrl\}/g, uiUrl)
      .replace(/\$\{cspSource\}/g, this.webview.cspSource)
      .replace(/\$\{cspOrigins\}/g, cspOrigins)

    return html
  }

  private buildCspOrigins(uiOrigin: string, bridgeOrigin: string): string {
    // Collect unique origins, always include localhost fallbacks for compatibility
    const origins = new Set<string>([
      "http://127.0.0.1:*",
      "https://127.0.0.1:*",
      "http://localhost:*",
      "https://localhost:*",
    ])

    // Add the actual resolved origins (handles Remote-SSH tunnels, codespaces, etc.)
    for (const origin of [uiOrigin, bridgeOrigin]) {
      try {
        const url = new URL(origin)
        // Add with wildcard port for flexibility
        origins.add(`${url.protocol}//${url.hostname}:*`)
        // Also add the exact origin
        origins.add(origin)
      } catch {
        // Skip invalid origins
      }
    }

    return Array.from(origins).join(" ")
  }

  private normalizePath(rawPath: string): string | null {
    try {
      if (!rawPath || rawPath.trim().length === 0) return null
      let p = rawPath.trim()
      if (p.startsWith("file://")) {
        p = vscode.Uri.parse(p).fsPath
      }
      // Normalize and convert to POSIX style for consistency
      const path = require("path")
      return path.normalize(p).split(path.sep).join("/")
    } catch {
      return null
    }
  }

  dispose(): void {
    this.disposed = true
    try {
      this.fileMonitor?.stopMonitoring()
    } catch {}
    try {
      this.communicationBridge?.dispose()
    } catch {}
    // NOTE: container owns PathInserter pointer
    if (this.bridgeSessionId) {
      getUpdateService()?.detachSession(this.bridgeSessionId)
      bridgeServer.removeSession(this.bridgeSessionId)
      this.bridgeSessionId = null
    }
    for (const d of this.disposables) {
      try {
        d.dispose()
      } catch {}
    }
    this.disposables = []
    this.communicationBridge = undefined
    this.fileMonitor = undefined
    this.connection = undefined
    this.uiBaseUrl = undefined
  }
}
