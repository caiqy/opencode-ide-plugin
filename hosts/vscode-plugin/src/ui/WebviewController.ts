import * as vscode from "vscode"
import { BackendConnection } from "../backend/BackendLauncher"
import { SettingsManager } from "../settings/SettingsManager"
import { CommunicationBridge } from "./CommunicationBridge"
import { FileMonitor } from "../utils/FileMonitor"
import { errorHandler } from "../utils/ErrorHandler"
import { PathInserter } from "../utils/PathInserter"
import { getUpdateService, logger } from "../globals"
import type {
  SaveImageResult,
  SelectFilesOptions,
  SelectFilesResult,
  ReadFilesResult,
  AcpCapabilitiesResult,
  AcpCategory,
  AcpTool,
} from "./IdeBridgeServer"
import { bridgeServer } from "./IdeBridgeServer"
import { showSystemNotification } from "./systemNotification"
import { automaticUpdateStorageKey } from "../update/UpdateService"
import { executeDebugTool } from "../debug/DebugTools"
import { isDebugApiAvailable } from "../debug/DebugTracking"

/**
 * 从语言模型工具的 `fullReferenceName`（形如 `扩展id/工具名` 或 `工具集/工具名`）解析归属分组。
 */
export function toolGroupFromReference(fullReferenceName: string | undefined): string | undefined {
  if (!fullReferenceName) return undefined
  const slash = fullReferenceName.lastIndexOf("/")
  return slash > 0 ? fullReferenceName.slice(0, slash) : undefined
}

// VS Code 内置浏览器工具 id；list_browser_pages 未被上游纳入 vscodeBrowser 工具集，
// 缺少 fullReferenceName 前缀，需要跟随同族工具补齐分组。
const INTEGRATED_BROWSER_TOOL_IDS = new Set([
  "open_browser_page",
  "read_page",
  "screenshot_page",
  "navigate_page",
  "click_element",
  "drag_element",
  "hover_element",
  "type_in_page",
  "run_playwright_code",
  "handle_dialog",
  "list_browser_pages",
])

/**
 * 仅在工具自身没有分组时，用同族内置浏览器工具的分组补齐；已有分组和未知工具都不动。
 */
export function assignIntegratedBrowserGroups(tools: AcpTool[]): void {
  const browserGroup = tools.find((tool) => INTEGRATED_BROWSER_TOOL_IDS.has(tool.id) && tool.group)?.group
  if (!browserGroup) return
  for (const tool of tools) {
    if (!tool.group && INTEGRATED_BROWSER_TOOL_IDS.has(tool.id)) {
      tool.group = browserGroup
    }
  }
}

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
          selectFiles: async (options) => this.selectFiles(options),
          readFiles: async (paths) => this.readFiles(paths),
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
          storageSet: async (scope, key, value) => {
            await this.storageSet(scope, key, value)
            if (scope === "global" && key === automaticUpdateStorageKey) {
              updateService?.setAutomaticChecks(value !== "false")
            }
          },
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
          getAcpCapabilities: async () => this.getAcpCapabilities(),
          executeAcpTool: async (category, toolId, parameters) => this.executeAcpTool(category, toolId, parameters),
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
        if (updateService.isAutomaticChecksEnabled?.() !== false) {
          void updateService.checkNow().catch((error) => {
            logger.appendLine(`update check failed for session ${session.sessionId}: ${error}`)
          })
        }
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

  private async selectFiles(options: SelectFilesOptions): Promise<SelectFilesResult> {
    const isDirectory = options.mode === "directory"
    const multiple = options.multiple ?? !isDirectory
    const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri

    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: !isDirectory,
      canSelectFolders: isDirectory,
      canSelectMany: multiple,
      openLabel: isDirectory ? "选择文件夹" : "选择文件",
      defaultUri,
    })

    if (!uris || uris.length === 0) {
      return { cancelled: true, paths: [] }
    }

    return {
      cancelled: false,
      paths: uris.map((uri) => uri.fsPath),
    }
  }

  private async readFiles(paths: string[]): Promise<ReadFilesResult> {
    const files = await Promise.all(
      paths.map(async (path) => {
        try {
          const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(path))
          return { path, base64: Buffer.from(bytes).toString("base64") }
        } catch (e) {
          return { path, error: String(e) }
        }
      }),
    )
    return { files }
  }

  private async getAcpCapabilities(): Promise<AcpCapabilitiesResult> {
    const debugAvailable = isDebugApiAvailable()

    const categories: AcpCategory[] = [
      {
        id: "vscode",
        name: "VS Code",
        description: "导航代码、管理扩展和运行内置 VS Code 命令",
        status: typeof vscode.commands?.executeCommand === "function" ? "connected" : "unavailable",
        tools: [
          {
            id: "executeCommand",
            name: "运行内置命令",
            description: "在 VS Code 中执行已注册的编辑器或扩展命令",
            parametersSchema: {
              type: "object",
              properties: {
                command: { type: "string", description: "VS Code 命令标识符，如 workbench.action.files.save" },
                args: { type: "array", description: "传递给该命令的可选参数列表", items: {} },
              },
              required: ["command"],
            },
          },
          {
            id: "navigateSymbol",
            name: "代码导航",
            description: "跳转工作区符号、查找所有引用与定义",
            parametersSchema: {
              type: "object",
              properties: {
                query: { type: "string", description: "待检索的代码符号名称或关键字" },
              },
              required: ["query"],
            },
          },
          {
            id: "terminal",
            name: "终端控制",
            description: "创建集成终端并运行 Shell 脚本与工具",
            parametersSchema: {
              type: "object",
              properties: {
                command: { type: "string", description: "在终端中执行的 Shell 命令行内容" },
                name: { type: "string", description: "可选终端标题" },
              },
              required: ["command"],
            },
          },
          {
            id: "editor",
            name: "代码编辑与查看",
            description: "打开指定文件、高亮目标代码块或应用代码变更",
            parametersSchema: {
              type: "object",
              properties: {
                path: { type: "string", description: "目标文件的绝对路径或工作区相对路径" },
                line: { type: "integer", description: "可选跳转的目标行号（从 1 开始）" },
              },
              required: ["path"],
            },
          },
          {
            id: "manageExtensions",
            name: "管理扩展",
            description: "获取和检索 VS Code 已安装的插件清单",
            parametersSchema: {
              type: "object",
              properties: {
                includeDisabled: { type: "boolean", description: "是否包含被禁用的插件" },
              },
            },
          },
        ],
      },
      {
        id: "tasks_and_problems",
        name: "任务和问题",
        description: "创建和运行任务，并检查工作区代码问题",
        status:
          typeof vscode.tasks?.executeTask === "function" && typeof vscode.languages?.getDiagnostics === "function"
            ? "connected"
            : "unavailable",
        tools: [
          {
            id: "getDiagnostics",
            name: "检查工作区问题",
            description: "获取当前文件或全局所有语法与类型错误（Problems）",
            parametersSchema: {
              type: "object",
              properties: {
                path: { type: "string", description: "可选文件路径，用于仅筛选该文件的报错诊断" },
              },
            },
          },
          {
            id: "runTask",
            name: "运行构建/测试任务",
            description: "执行 tasks.json 中配置的构建、监视与测试任务",
            parametersSchema: {
              type: "object",
              properties: {
                taskName: { type: "string", description: "要执行的任务确切名称" },
              },
              required: ["taskName"],
            },
          },
          {
            id: "listTasks",
            name: "列出可用任务",
            description: "检索当前工作区已配置的所有任务定义",
            parametersSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            id: "terminateTask",
            name: "终止运行中任务",
            description: "停止当前正在执行的长期任务或监视任务",
            parametersSchema: {
              type: "object",
              properties: {
                taskName: { type: "string", description: "要停止的任务确切名称" },
              },
              required: ["taskName"],
            },
          },
        ],
      },
      {
        id: "debug",
        name: "运行和调试",
        description: debugAvailable
          ? "启动调试会话、管理断点并读取运行时状态"
          : "调试 API 在当前环境中不可用",
        status: debugAvailable ? "connected" : "unavailable",
        tools: [
          {
            id: "listLaunchConfigs",
            name: "列出启动配置",
            description: "读取工作区 .vscode/launch.json 中的静态调试配置列表",
            parametersSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            id: "startDebugging",
            name: "启动调试",
            description: "按名称启动工作区中的调试配置（等价运行和调试面板的运行按钮）",
            parametersSchema: {
              type: "object",
              properties: {
                name: { type: "string", description: "launch.json 中的配置名称" },
              },
              required: ["name"],
            },
          },
          {
            id: "stopDebugging",
            name: "停止调试",
            description: "停止当前活动的调试会话",
            parametersSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            id: "restartDebugging",
            name: "重启调试",
            description: "以当前配置重新启动调试会话",
            parametersSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            id: "getDebugState",
            name: "查询调试状态",
            description: "返回活动调试会话与暂停状态（线程、暂停原因、命中断点）",
            parametersSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            id: "getCallStack",
            name: "读取调用堆栈",
            description: "返回暂停线程的调用堆栈帧（文件、行号与帧 ID）",
            parametersSchema: {
              type: "object",
              properties: {
                threadId: { type: "integer", description: "可选线程 ID；默认使用最近暂停的线程" },
              },
            },
          },
          {
            id: "getVariables",
            name: "读取变量",
            description: "读取栈帧作用域或变量引用的值，可通过返回的 variablesReference 继续展开",
            parametersSchema: {
              type: "object",
              properties: {
                frameId: { type: "integer", description: "栈帧 ID，用于读取该帧的作用域列表" },
                variablesReference: {
                  type: "integer",
                  description: "作用域或变量的引用 ID，用于展开其子变量",
                },
              },
            },
          },
          {
            id: "listBreakpoints",
            name: "列出断点",
            description: "返回当前所有断点及其条件与启用状态",
            parametersSchema: {
              type: "object",
              properties: {},
            },
          },
          {
            id: "addBreakpoints",
            name: "添加断点",
            description: "在指定文件行添加源断点，可设置条件、命中次数或日志消息",
            parametersSchema: {
              type: "object",
              properties: {
                file: { type: "string", description: "目标文件的绝对路径" },
                line: { type: "integer", description: "目标行号（从 1 开始）" },
                condition: { type: "string", description: "可选条件表达式，仅在为真时暂停" },
                hitCondition: { type: "string", description: "可选命中次数条件，如 5" },
                logMessage: { type: "string", description: "可选日志消息，使用 {} 插值表达式" },
              },
              required: ["file", "line"],
            },
          },
          {
            id: "removeBreakpoints",
            name: "删除断点",
            description: "删除指定文件（与行号）匹配的源断点",
            parametersSchema: {
              type: "object",
              properties: {
                file: { type: "string", description: "目标文件的绝对路径" },
                line: { type: "integer", description: "可选行号；省略时删除该文件的全部源断点" },
              },
              required: ["file"],
            },
          },
          {
            id: "controlExecution",
            name: "执行控制",
            description: "对暂停中的调试会话执行继续、单步或暂停",
            parametersSchema: {
              type: "object",
              properties: {
                action: {
                  type: "string",
                  enum: ["continue", "stepOver", "stepIn", "stepOut", "pause"],
                  description: "执行控制动作",
                },
                threadId: { type: "integer", description: "可选线程 ID；默认使用最近暂停的线程" },
              },
              required: ["action"],
            },
          },
          {
            id: "evaluate",
            name: "表达式求值",
            description: "在暂停栈帧上下文中求值表达式（等价监视 / REPL）；会执行代码，请谨慎授权",
            parametersSchema: {
              type: "object",
              properties: {
                expression: { type: "string", description: "要求值的表达式" },
                frameId: { type: "integer", description: "可选栈帧 ID，在该帧上下文中求值" },
                context: { type: "string", description: "可选求值上下文，如 watch、repl、hover" },
              },
              required: ["expression"],
            },
          },
          {
            id: "setExceptionBreakpoints",
            name: "异常断点",
            description: "设置调试适配器的异常断点过滤器（如 raised、uncaught）",
            parametersSchema: {
              type: "object",
              properties: {
                filters: {
                  type: "array",
                  items: { type: "string" },
                  description: "异常断点过滤器 ID 列表；空数组表示清除",
                },
              },
              required: ["filters"],
            },
          },
        ],
      },
    ]

    try {
      const lmTools = (vscode as any).lm?.tools as vscode.LanguageModelToolInformation[] | undefined
      if (Array.isArray(lmTools) && lmTools.length > 0) {
        const extTools: AcpTool[] = []
        for (const t of lmTools) {
          if (!t || typeof t.name !== "string") continue
          const name = t.name
          if (name.startsWith("vscode_") || name.startsWith("copilot_")) continue
          const fullReference = (t as { fullReferenceName?: string }).fullReferenceName
          extTools.push({
            id: name,
            name,
            description: t.description || "",
            group: toolGroupFromReference(fullReference),
            parametersSchema: (t.inputSchema as Record<string, unknown>) || { type: "object", properties: {} },
          })
        }
        if (extTools.length > 0) {
          assignIntegratedBrowserGroups(extTools)
          categories.push({
            id: "extensions",
            name: "扩展工具",
            description: "当前 VS Code 中已安装扩展贡献的语言模型工具",
            status: "connected",
            tools: extTools,
          })
        }
      }
    } catch {
      // Best effort
    }

    return { categories }
  }

  private async executeAcpTool(
    category: string,
    toolId: string,
    parameters: Record<string, unknown>,
  ): Promise<unknown> {
    if (category === "extensions") {
      const lm = (vscode as any).lm
      if (typeof lm?.invokeTool !== "function") {
        throw new Error("vscode.lm.invokeTool is not supported in this VS Code version")
      }
      const tokenSource = new vscode.CancellationTokenSource()
      try {
        const result = await lm.invokeTool(toolId, { input: parameters }, tokenSource.token)
        const parts: string[] = []
        if (result && Array.isArray(result.content)) {
          for (const c of result.content) {
            if (c && typeof c.value === "string") {
              parts.push(c.value)
            } else if (c && typeof c === "string") {
              parts.push(c)
            } else if (c) {
              parts.push(JSON.stringify(c))
            }
          }
        }
        return { output: parts.join("\n") || "Tool executed successfully" }
      } finally {
        tokenSource.dispose()
      }
    }

    if (category === "vscode") {
      switch (toolId) {
        case "executeCommand": {
          const command = parameters.command as string
          if (!command) throw new Error("Missing 'command' parameter")
          const args = Array.isArray(parameters.args) ? parameters.args : []
          const result = await vscode.commands.executeCommand(command, ...args)
          return { output: typeof result === "string" ? result : JSON.stringify(result ?? "Command executed successfully") }
        }
        case "editor": {
          const rawPath = parameters.path as string
          if (!rawPath) throw new Error("Missing 'path' parameter")
          const line = typeof parameters.line === "number" ? parameters.line : 1
          if (this.communicationBridge) {
            await this.communicationBridge.handleOpenFile(line > 0 ? `${rawPath}:${line}` : rawPath)
          }
          return { output: `Opened ${rawPath} at line ${line}` }
        }
        case "terminal": {
          const command = parameters.command as string
          if (!command) throw new Error("Missing 'command' parameter")
          const terminalName = (parameters.name as string) || "OpenCode Terminal"
          let term = vscode.window.terminals.find((t) => t.name === terminalName)
          if (!term) {
            term = vscode.window.createTerminal({ name: terminalName })
          }
          term.show()
          term.sendText(command)
          return { output: `Sent command to terminal "${terminalName}": ${command}` }
        }
        case "manageExtensions": {
          const exts = vscode.extensions.all.map((e) => ({
            id: e.id,
            packageJSON: {
              name: e.packageJSON?.name,
              version: e.packageJSON?.version,
              description: e.packageJSON?.description,
            },
            isActive: e.isActive,
          }))
          return { output: JSON.stringify(exts, null, 2) }
        }
        case "navigateSymbol": {
          const query = parameters.query as string
          if (!query) throw new Error("Missing 'query' parameter")
          const symbols = await vscode.commands.executeCommand("vscode.executeWorkspaceSymbolProvider", query)
          return { output: JSON.stringify(symbols ?? [], null, 2) }
        }
        default:
          throw new Error(`Unsupported tool in vscode category: ${toolId}`)
      }
    }

    if (category === "tasks_and_problems") {
      switch (toolId) {
        case "getDiagnostics": {
          const filterPath = parameters.path as string | undefined
          const allDiagnostics = vscode.languages.getDiagnostics()
          const results: Array<{ uri: string; diagnostics: unknown[] }> = []
          for (const [uri, diags] of allDiagnostics) {
            if (diags.length === 0) continue
            if (filterPath && !uri.fsPath.includes(filterPath)) continue
            results.push({
              uri: uri.fsPath,
              diagnostics: diags.map((d) => ({
                message: d.message,
                severity: d.severity,
                range: {
                  start: { line: d.range.start.line, character: d.range.start.character },
                  end: { line: d.range.end.line, character: d.range.end.character },
                },
                source: d.source,
                code: d.code,
              })),
            })
          }
          return { output: JSON.stringify(results, null, 2) }
        }
        case "listTasks": {
          const tasks = await vscode.tasks.fetchTasks()
          return {
            output: JSON.stringify(
              tasks.map((t) => ({ name: t.name, source: t.source, group: t.group?.id })),
              null,
              2,
            ),
          }
        }
        case "runTask": {
          const taskName = parameters.taskName as string
          if (!taskName) throw new Error("Missing 'taskName' parameter")
          const tasks = await vscode.tasks.fetchTasks()
          const task = tasks.find((t) => t.name === taskName)
          if (!task) throw new Error(`Task not found: ${taskName}`)
          const execution = await vscode.tasks.executeTask(task)
          return { output: `Task "${taskName}" started (execution: ${execution ? "active" : "unknown"})` }
        }
        case "terminateTask": {
          const taskName = parameters.taskName as string
          if (!taskName) throw new Error("Missing 'taskName' parameter")
          const executions = vscode.tasks.taskExecutions
          const execution = executions.find((e) => e.task.name === taskName)
          if (!execution) throw new Error(`Running task not found: ${taskName}`)
          execution.terminate()
          return { output: `Terminated task: ${taskName}` }
        }
        default:
          throw new Error(`Unsupported tool in tasks_and_problems category: ${toolId}`)
      }
    }

    if (category === "debug") {
      return executeDebugTool(toolId, parameters)
    }

    throw new Error(`Unsupported ACP category: ${category}`)
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
