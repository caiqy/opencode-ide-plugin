import * as vscode from "vscode"
import { BackendConnection } from "../backend/BackendLauncher"
import { SettingsManager } from "../settings/SettingsManager"
import { CommunicationBridge } from "./CommunicationBridge"
import { FileMonitor } from "../utils/FileMonitor"
import { errorHandler } from "../utils/ErrorHandler"
import { PathInserter } from "../utils/PathInserter"
import { logger } from "../globals"
import { bridgeServer } from "./IdeBridgeServer"

/**
 * Shared webview controller to manage common UI lifecycle and messaging
 * Used by both WebviewManager (editor tab) and ActivityBarProvider (view tab)
 */
export interface WebviewControllerOptions {
  webview: vscode.Webview
  context: vscode.ExtensionContext
  settingsManager?: SettingsManager
  uiGetState?: () => Promise<any>
  uiSetState?: (state: any) => Promise<void>
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
  private uiGetState?: () => Promise<any>
  private uiSetState?: (state: any) => Promise<void>
  private disposed = false

  constructor(opts: WebviewControllerOptions) {
    this.webview = opts.webview
    this.context = opts.context
    this.settingsManager = opts.settingsManager
    this.uiGetState = opts.uiGetState
    this.uiSetState = opts.uiSetState
  }

  getCommunicationBridge(): CommunicationBridge | undefined {
    return this.communicationBridge
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
          uiGetState: this.uiGetState,
          uiSetState: this.uiSetState,
          storageGet: async (keys: string[]) => {
            const result: Record<string, string | undefined> = {}
            for (const key of keys) {
              result[key] = this.context.globalState.get<string>(key)
            }
            return result
          },
          storageSet: async (key: string, value: string) => {
            await this.context.globalState.update(key, value)
          },
        },
        {
          minVersion: vscode.workspace.getConfiguration("opencode").get<string>("minVersion", "1.1.1"),
        },
      )
      this.bridgeSessionId = session.sessionId

      // Tell CommunicationBridge to route ideBridge messages through SSE
      this.communicationBridge.setBridgeSession(session.sessionId, bridgeServer)

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
      } catch (e) {
        logger.appendLine(`FileMonitor init failed: ${e}`)
      }

      // Use asExternalUri for Remote-SSH compatibility
      const externalUi = await vscode.env.asExternalUri(vscode.Uri.parse(connection.uiBase))
      const externalBridge = await vscode.env.asExternalUri(vscode.Uri.parse(session.baseUrl))

      // Build iframe src with bridge params
      const uiUrlWithMode = this.buildUiUrlWithMode(externalUi.toString())
      const iframeSrc = `${uiUrlWithMode}&ideBridge=${encodeURIComponent(externalBridge.toString())}&ideBridgeToken=${encodeURIComponent(session.token)}`

      // Extract origins for dynamic CSP (Remote-SSH compatibility)
      const uiOrigin = new URL(externalUi.toString()).origin
      const bridgeOrigin = new URL(externalBridge.toString()).origin

      const html = await this.generateHtmlContent(iframeSrc, { uiOrigin, bridgeOrigin })
      await this.setHtmlWithRetry(html)

      // Message handling is now done entirely by CommunicationBridge
    } catch (error) {
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
      })

      // IMPORTANT: Call insertPaths for files and pastePath for directories
      if (this.communicationBridge) {
        if (filePaths.length > 0) {
          this.communicationBridge.insertPaths(filePaths)
          logger.appendLine(`Called insertPaths with ${filePaths.length} files`)
        }

        for (const dirPath of directoryPaths) {
          this.communicationBridge.pastePath(dirPath)
          logger.appendLine(`Called pastePath for directory: ${dirPath}`)
        }
      } else {
        logger.appendLine("Warning: No communication bridge available to call insertPaths/pastePath")
      }

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
    const bytes = await vscode.workspace.fs.readFile(htmlUri)
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
  }
}
