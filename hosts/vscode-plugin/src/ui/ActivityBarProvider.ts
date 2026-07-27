import * as vscode from "vscode"
import { BackendConnection, BackendLauncher } from "../backend/BackendLauncher"
import { SettingsManager } from "../settings/SettingsManager"
import { errorHandler } from "../utils/ErrorHandler"
import { WebviewController } from "./WebviewController"
import { logger } from "../globals"
import { PathInserter } from "../utils/PathInserter"
import { loading } from "./loading"

function withCacheBuster(url: string, version: string): string {
  if (url.includes("v=")) {
    return url
  }

  const sep = url.includes("?") ? "&" : "?"
  return `${url}${sep}v=${encodeURIComponent(version)}`
}

/**
 * Webview view provider for the OpenCode activity bar view.
 */
export class ActivityBarProvider implements vscode.WebviewViewProvider {
  dispose(): void {
    try {
      this.controller?.dispose()
    } catch {}
    this.controller = undefined
    this.view = undefined
    this.pendingSessionID = undefined
    this.loadGeneration++
  }
  private context: vscode.ExtensionContext
  private backendLauncher: BackendLauncher
  private settingsManager: SettingsManager

  private connection?: BackendConnection
  private controller?: WebviewController
  private view?: vscode.WebviewView
  private mem = new Map<string, string>()
  private loadGeneration = 0
  private pendingSessionID?: string

  constructor(context: vscode.ExtensionContext, backendLauncher: BackendLauncher, settingsManager: SettingsManager) {
    this.context = context
    this.backendLauncher = backendLauncher
    this.settingsManager = settingsManager
  }

  /** Deadline for retrying SW InvalidState errors across full load() cycles (ms). */
  private static readonly SW_LOAD_RETRY_DEADLINE_MS = 30_000
  private static readonly SW_LOAD_RETRY_INITIAL_DELAY_MS = 500
  private static readonly SW_LOAD_RETRY_MAX_DELAY_MS = 4_000

  openSession(sessionID: string): void {
    if (this.controller?.openSession(sessionID)) {
      this.pendingSessionID = undefined
      return
    }
    this.pendingSessionID = sessionID
  }

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    logger.appendLine("resolveWebviewView called - initializing or reinitializing webview")

    const myGeneration = ++this.loadGeneration

    // When webview is moved between sidebars, VS Code destroys the old webview
    // and calls resolveWebviewView with a new WebviewView instance.
    // We need to dispose the old controller and reinitialize with the new webview.
    if (this.controller) {
      logger.appendLine("Disposing existing controller for webview reinitialization")
      try {
        this.controller.dispose()
      } catch {}
      this.controller = undefined
    }

    // Store reference to current view
    this.view = webviewView

    // Listen for the webview being disposed (e.g., when moved or closed)
    webviewView.onDidDispose(() => {
      logger.appendLine("WebviewView disposed")
      this.loadGeneration++
      const bridge = this.controller?.getCommunicationBridge()
      if (this.controller) {
        try {
          this.controller.dispose()
        } catch {}
        this.controller = undefined
      }

      // Remove this bridge from PathInserter registry; it will fall back to another if available
      try {
        if (bridge) {
          PathInserter.removeCommunicationBridge(bridge)
        }
      } catch {}
      this.view = undefined
    })

    // Configure webview options
    // WebviewView does not support retainContextWhenHidden in code.
    // Use package.json contributes.views or registration options instead.
    webviewView.webview.options = {
      enableScripts: true,
      enableCommandUris: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "resources"),
        vscode.Uri.joinPath(this.context.extensionUri, "out"),
      ],
    }

    webviewView.webview.html = loading("Starting OpenCode...", "Initializing backend...")

    // Track view visibility/activeness for command routing
    webviewView.onDidChangeVisibility(() => {
      if (!webviewView.visible) return
      const bridge = this.controller?.getCommunicationBridge()
      if (bridge) PathInserter.setCommunicationBridge(bridge)
    })

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Starting OpenCode...",
        cancellable: false,
      },
      async (progress) => {
        try {
          if (myGeneration !== this.loadGeneration) {
            logger.appendLine("Webview resolve cancelled before start (generation changed)")
            return
          }
          // Reuse existing backend connection if available (e.g., when webview is moved between sidebars)
          if (!this.connection) {
            progress.report({ increment: 0, message: "Launching backend..." })
            webviewView.webview.html = loading("Starting OpenCode...", "Launching backend...")
            const connection = await this.backendLauncher.launchBackend()
            this.connection = connection

            // Cache busting: force web UI reload after extension updates
            connection.uiBase = withCacheBuster(connection.uiBase, this.context.extension.packageJSON.version)
          } else {
            logger.appendLine("Reusing existing backend connection for webview reinitialization")
            progress.report({ increment: 0, message: "Reconnecting to backend..." })
            webviewView.webview.html = loading("Starting OpenCode...", "Reconnecting to backend...")
          }

          progress.report({ increment: 50, message: "Loading web UI..." })

          // Retry the full controller.load() cycle when it fails due to the
          // transient Chromium SW InvalidState bug (microsoft/vscode#125993).
          // setHtmlWithRetry handles inner retries; this outer loop covers
          // failures that occur *before* the HTML assignment (e.g. during
          // bridge/session setup that touches the webview).
          const loadDeadline = Date.now() + ActivityBarProvider.SW_LOAD_RETRY_DEADLINE_MS
          let loadDelay = ActivityBarProvider.SW_LOAD_RETRY_INITIAL_DELAY_MS
          let loadAttempt = 0

          while (true) {
            if (myGeneration !== this.loadGeneration) {
              logger.appendLine("Webview resolve cancelled before web UI load (generation changed)")
              return
            }
            loadAttempt++
            try {
              // Dispose previous controller attempt if any
              if (this.controller) {
                try {
                  this.controller.dispose()
                } catch {}
                this.controller = undefined
              }
              this.controller = new WebviewController({
                webview: webviewView.webview,
                context: this.context,
                settingsManager: this.settingsManager,
                storageGet: async (scope, keys) => {
                  const result: Record<string, string | undefined> = {}
                  if (scope === "mem") {
                    for (const key of keys) {
                      result[key] = this.mem.get(key)
                    }
                    return result
                  }
                  const state = scope === "workspace" ? this.context.workspaceState : this.context.globalState
                  for (const key of keys) {
                    result[key] = state.get<string>(key)
                  }
                  return result
                },
                storageSet: async (scope, key, value) => {
                  if (scope === "mem") {
                    this.mem.set(key, value)
                    return
                  }
                  const state = scope === "workspace" ? this.context.workspaceState : this.context.globalState
                  await state.update(key, value)
                },
              })
              await this.controller.load(this.connection)
              if (loadAttempt > 1) {
                logger.appendLine(`Webview load succeeded on attempt ${loadAttempt}`)
              }
              break // success
            } catch (error) {
              const remaining = loadDeadline - Date.now()
              if (!WebviewController.isServiceWorkerInvalidStateError(error) || remaining <= 0) {
                throw error
              }
              const actualDelay = Math.min(loadDelay, remaining)
              logger.appendLine(
                `Webview load failed (attempt ${loadAttempt}) due to SW InvalidState; ` +
                  `retrying in ${actualDelay}ms (${Math.round(remaining / 1000)}s remaining)`,
              )
              await new Promise((resolve) => setTimeout(resolve, actualDelay))
              loadDelay = Math.min(loadDelay * 2, ActivityBarProvider.SW_LOAD_RETRY_MAX_DELAY_MS)
            }
          }

          if (myGeneration !== this.loadGeneration) {
            logger.appendLine("Webview resolve finished but generation changed; disposing newly created controller")
            try {
              this.controller.dispose()
            } catch {}
            this.controller = undefined
            return
          }

          if (this.pendingSessionID) this.openSession(this.pendingSessionID)

          // Prefer routing commands to this view when visible
          if (webviewView.visible) {
            const bridge = this.controller.getCommunicationBridge()
            if (bridge) PathInserter.setCommunicationBridge(bridge)
          }

          // no-op

          progress.report({ increment: 100, message: "Ready!" })
          logger.appendLine("Webview initialization complete")
        } catch (error) {
          if (myGeneration !== this.loadGeneration) {
            logger.appendLine(`Webview resolve aborted (generation changed): ${error}`)
            return
          }
          await errorHandler.handleWebviewLoadError(error instanceof Error ? error : new Error(String(error)))
          throw error
        }
      },
    )
  }
}
