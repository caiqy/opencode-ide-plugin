import * as assert from "assert"
import * as vscode from "vscode"
import { BackendLauncher } from "../../backend/BackendLauncher"
import { activate, deactivate, getExtensionInstance } from "../../extension"
import { getUpdateService } from "../../globals"
import { ActivityBarProvider } from "../../ui/ActivityBarProvider"
import { bridgeServer } from "../../ui/IdeBridgeServer"
import { WebviewManager } from "../../ui/WebviewManager"
import { extensionId } from "../../utils/extensionIdentity"

function getExtension() {
  return vscode.extensions.all.find((item) => item.packageJSON?.name === "opencode-ui")
}

function createState() {
  const map = new Map<string, string>()

  return {
    keys: () => [...map.keys()],
    get: <T>(key: string, value?: T) => (map.has(key) ? (map.get(key) as T) : value),
    update: async (key: string, value: string | undefined) => {
      if (value === undefined) {
        map.delete(key)
        return
      }

      map.set(key, value)
    },
  }
}

function createContext() {
  const ext = getExtension()
  const uri = vscode.Uri.file(ext?.extensionPath ?? process.cwd())

  return {
    subscriptions: [],
    workspaceState: createState(),
    globalState: createState(),
    extensionUri: uri,
    extensionPath: uri.fsPath,
    storageUri: undefined,
    storagePath: undefined,
    globalStorageUri: uri,
    globalStoragePath: uri.fsPath,
    logUri: uri,
    logPath: uri.fsPath,
    extensionMode: vscode.ExtensionMode.Test,
    secrets: {
      get: async () => undefined,
      store: async () => {},
      delete: async () => {},
      onDidChange: () => ({ dispose() {} }),
    },
    environmentVariableCollection: {
      persistent: true,
      replace() {},
      append() {},
      prepend() {},
      get() {
        return undefined
      },
      forEach() {},
      delete() {},
      clear() {},
      description: undefined,
    },
    asAbsolutePath: (value: string) => value,
    extension: {
      id: "test.opencode-ui",
      extensionUri: uri,
      extensionPath: uri.fsPath,
      isActive: false,
      packageJSON: { version: "26.4.1404" },
      exports: undefined,
      activate: async () => {},
      extensionKind: vscode.ExtensionKind.Workspace,
    },
    languageModelAccessInformation: {
      canSendRequest() {
        return false
      },
      onDidChange: () => ({ dispose() {} }),
    },
  } as unknown as vscode.ExtensionContext
}

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start all tests.")

  teardown(() => {
    deactivate()
  })

  test("Extension should be present", () => {
    assert.ok(getExtension())
  })

  test("extension identity helper matches manifest publisher and name", () => {
    const ext = getExtension()

    assert.ok(ext)
    assert.strictEqual(extensionId, `${ext.packageJSON.publisher}.${ext.packageJSON.name}`)
  })

  test("extension instance dispose should be idempotent", async () => {
    const calls: string[] = []
    const webview = WebviewManager.prototype.dispose
    const activity = ActivityBarProvider.prototype.dispose
    const backend = BackendLauncher.prototype.terminate
    const bridge = bridgeServer.stop
    const register = vscode.window.registerWebviewViewProvider
    const registerUriHandler = vscode.window.registerUriHandler
    const command = vscode.commands.registerCommand

    WebviewManager.prototype.dispose = function () {
      calls.push("webview")
    }
    ActivityBarProvider.prototype.dispose = function () {
      calls.push("activity")
    }
    BackendLauncher.prototype.terminate = function () {
      calls.push("backend")
    }
    bridgeServer.stop = () => {
      calls.push("bridge")
    }
    vscode.window.registerWebviewViewProvider = (() => ({
      dispose() {},
    })) as typeof vscode.window.registerWebviewViewProvider
    vscode.window.registerUriHandler = (() => ({
      dispose() {},
    })) as typeof vscode.window.registerUriHandler
    vscode.commands.registerCommand = (() => ({
      dispose() {},
    })) as typeof vscode.commands.registerCommand

    try {
      await activate(createContext())
      const ext = getExtensionInstance()

      assert.ok(ext)

      assert.doesNotThrow(() => {
        ext.dispose()
        ext.dispose()
      })

      assert.deepStrictEqual(calls, ["webview", "activity", "bridge", "backend"])
    } finally {
      WebviewManager.prototype.dispose = webview
      ActivityBarProvider.prototype.dispose = activity
      BackendLauncher.prototype.terminate = backend
      bridgeServer.stop = bridge
      vscode.window.registerWebviewViewProvider = register
      vscode.window.registerUriHandler = registerUriHandler
      vscode.commands.registerCommand = command
      deactivate()
    }
  })

  test("extension dispose should release registered webview provider disposable", async () => {
    const calls: string[] = []
    const activity = ActivityBarProvider.prototype.dispose
    const register = vscode.window.registerWebviewViewProvider
    const registerUriHandler = vscode.window.registerUriHandler
    const command = vscode.commands.registerCommand

    ActivityBarProvider.prototype.dispose = function () {
      calls.push("activity")
    }
    vscode.window.registerWebviewViewProvider = (() => ({
      dispose() {
        calls.push("provider")
      },
    })) as typeof vscode.window.registerWebviewViewProvider
    vscode.window.registerUriHandler = (() => ({
      dispose() {},
    })) as typeof vscode.window.registerUriHandler
    vscode.commands.registerCommand = (() => ({
      dispose() {},
    })) as typeof vscode.commands.registerCommand

    try {
      await activate(createContext())
      const ext = getExtensionInstance()

      assert.ok(ext)

      ext.dispose()

      assert.deepStrictEqual(calls, ["activity", "provider"])
    } finally {
      ActivityBarProvider.prototype.dispose = activity
      vscode.window.registerWebviewViewProvider = register
      vscode.window.registerUriHandler = registerUriHandler
      vscode.commands.registerCommand = command
      deactivate()
    }
  })

  test("extension dispose should release registered URI handler disposable exactly once", async () => {
    const register = vscode.window.registerWebviewViewProvider
    const registerUriHandler = vscode.window.registerUriHandler
    const command = vscode.commands.registerCommand
    let uriHandlerDisposeCalls = 0

    vscode.window.registerWebviewViewProvider = (() => ({
      dispose() {},
    })) as typeof vscode.window.registerWebviewViewProvider
    vscode.window.registerUriHandler = (() => ({
      dispose() {
        uriHandlerDisposeCalls += 1
      },
    })) as typeof vscode.window.registerUriHandler
    vscode.commands.registerCommand = (() => ({
      dispose() {},
    })) as typeof vscode.commands.registerCommand

    try {
      await activate(createContext())
      const ext = getExtensionInstance()

      assert.ok(ext)

      ext.dispose()

      assert.strictEqual(uriHandlerDisposeCalls, 1)
    } finally {
      vscode.window.registerWebviewViewProvider = register
      vscode.window.registerUriHandler = registerUriHandler
      vscode.commands.registerCommand = command
      deactivate()
    }
  })

  test("dispose should continue cleanup after earlier disposer throws", async () => {
    const calls: string[] = []
    const webview = WebviewManager.prototype.dispose
    const activity = ActivityBarProvider.prototype.dispose
    const backend = BackendLauncher.prototype.terminate
    const bridge = bridgeServer.stop
    const register = vscode.window.registerWebviewViewProvider
    const registerUriHandler = vscode.window.registerUriHandler
    const command = vscode.commands.registerCommand

    WebviewManager.prototype.dispose = function () {
      calls.push("webview")
      throw new Error("webview failed")
    }
    ActivityBarProvider.prototype.dispose = function () {
      calls.push("activity")
    }
    BackendLauncher.prototype.terminate = function () {
      calls.push("backend")
    }
    bridgeServer.stop = () => {
      calls.push("bridge")
    }
    vscode.window.registerWebviewViewProvider = (() => ({
      dispose() {},
    })) as typeof vscode.window.registerWebviewViewProvider
    vscode.window.registerUriHandler = (() => ({
      dispose() {},
    })) as typeof vscode.window.registerUriHandler
    vscode.commands.registerCommand = (() => ({
      dispose() {},
    })) as typeof vscode.commands.registerCommand

    try {
      await activate(createContext())
      const ext = getExtensionInstance()

      assert.ok(ext)

      // dispose no longer throws — errors are logged instead
      assert.doesNotThrow(() => {
        ext.dispose()
      })

      assert.deepStrictEqual(calls, ["webview", "activity", "bridge", "backend"])
    } finally {
      WebviewManager.prototype.dispose = webview
      ActivityBarProvider.prototype.dispose = activity
      BackendLauncher.prototype.terminate = backend
      bridgeServer.stop = bridge
      vscode.window.registerWebviewViewProvider = register
      vscode.window.registerUriHandler = registerUriHandler
      vscode.commands.registerCommand = command
      deactivate()
    }
  })

  test("手动检查更新会访问当前项目的 GitHub latest release API", async () => {
    const register = vscode.window.registerWebviewViewProvider
    const registerUriHandler = vscode.window.registerUriHandler
    const command = vscode.commands.registerCommand
    const originalFetch = globalThis.fetch
    const urls: string[] = []

    vscode.window.registerWebviewViewProvider = (() => ({
      dispose() {},
    })) as typeof vscode.window.registerWebviewViewProvider
    vscode.window.registerUriHandler = (() => ({
      dispose() {},
    })) as typeof vscode.window.registerUriHandler
    vscode.commands.registerCommand = (() => ({
      dispose() {},
    })) as typeof vscode.commands.registerCommand
    globalThis.fetch = (async (input) => {
      urls.push(String(input))

      return {
        ok: true,
        status: 200,
        async json() {
          return {
            tag_name: "26.4.1405",
            html_url: "https://github.com/caiqy/opencode-ide-plugin/releases/tag/26.4.1405",
            assets: [
              {
                name: "opencode-vscode-win32-x64-26.4.1405.vsix",
                browser_download_url:
                  "https://github.com/caiqy/opencode-ide-plugin/releases/download/26.4.1405/opencode-vscode-win32-x64-26.4.1405.vsix",
              },
            ],
          }
        },
      } as Response
    }) as typeof fetch

    try {
      await activate(createContext())
      const updateService = getUpdateService()

      assert.ok(updateService)

      const result = await updateService.checkForUpdates()

      assert.deepStrictEqual(result.status, "available")
      assert.deepStrictEqual(urls, ["https://api.github.com/repos/caiqy/opencode-ide-plugin/releases/latest"])
    } finally {
      globalThis.fetch = originalFetch
      vscode.window.registerWebviewViewProvider = register
      vscode.window.registerUriHandler = registerUriHandler
      vscode.commands.registerCommand = command
      deactivate()
    }
  })

  test("system notification URI handler 聚焦 OpenCode 并路由 openSession", async () => {
    const register = vscode.window.registerWebviewViewProvider
    const registerUriHandler = vscode.window.registerUriHandler
    const command = vscode.commands.registerCommand
    const executeCommand = vscode.commands.executeCommand
    const openSession = bridgeServer.openSession
    const executed: string[] = []
    const routed: Array<{ bridgeSessionID: string; sessionID: string }> = []
    let handler: vscode.UriHandler | undefined

    vscode.window.registerWebviewViewProvider = (() => ({
      dispose() {},
    })) as typeof vscode.window.registerWebviewViewProvider
    vscode.window.registerUriHandler = ((uriHandler: vscode.UriHandler) => {
      handler = uriHandler
      return { dispose() {} }
    }) as typeof vscode.window.registerUriHandler
    vscode.commands.registerCommand = (() => ({
      dispose() {},
    })) as typeof vscode.commands.registerCommand
    vscode.commands.executeCommand = (async (commandId: string) => {
      executed.push(commandId)
      return undefined
    }) as typeof vscode.commands.executeCommand
    bridgeServer.openSession = ((bridgeSessionID, sessionID) => {
      routed.push({ bridgeSessionID, sessionID })
      return true
    }) as typeof bridgeServer.openSession

    try {
      await activate(createContext())

      assert.ok(handler)

      await handler.handleUri(
        vscode.Uri.parse(
          "vscode://caiqy.opencode-ui/open-session?bridgeSessionID=bridge-session-1&sessionID=target-session-2",
        ),
      )

      assert.deepStrictEqual(executed, ["workbench.view.extension.opencode"])
      assert.deepStrictEqual(routed, [
        {
          bridgeSessionID: "bridge-session-1",
          sessionID: "target-session-2",
        },
      ])
    } finally {
      vscode.window.registerWebviewViewProvider = register
      vscode.window.registerUriHandler = registerUriHandler
      vscode.commands.registerCommand = command
      vscode.commands.executeCommand = executeCommand
      bridgeServer.openSession = openSession
      deactivate()
    }
  })

  test("system notification URI handler 在原 bridge 失效后路由当前 OpenCode view", async () => {
    const register = vscode.window.registerWebviewViewProvider
    const registerUriHandler = vscode.window.registerUriHandler
    const command = vscode.commands.registerCommand
    const executeCommand = vscode.commands.executeCommand
    const server = bridgeServer
    const openSession = server.openSession
    let handler: vscode.UriHandler | undefined
    let provider: vscode.WebviewViewProvider | undefined
    const routed: string[] = []

    vscode.window.registerWebviewViewProvider = ((_viewID, value) => {
      provider = value
      return { dispose() {} }
    }) as typeof vscode.window.registerWebviewViewProvider
    vscode.window.registerUriHandler = ((uriHandler: vscode.UriHandler) => {
      handler = uriHandler
      return { dispose() {} }
    }) as typeof vscode.window.registerUriHandler
    vscode.commands.registerCommand = (() => ({ dispose() {} })) as typeof vscode.commands.registerCommand
    vscode.commands.executeCommand = (async () => undefined) as typeof vscode.commands.executeCommand
    server.openSession = () => false

    try {
      await activate(createContext())
      assert.ok(handler)
      assert.ok(provider)
      ;(provider as ActivityBarProvider & { openSession: (sessionID: string) => void }).openSession = (sessionID) => {
        routed.push(sessionID)
      }

      await handler.handleUri(
        vscode.Uri.parse(
          "vscode://caiqy.opencode-ui/open-session?bridgeSessionID=disposed-bridge&sessionID=target-session-2",
        ),
      )

      assert.deepStrictEqual(routed, ["target-session-2"])
    } finally {
      vscode.window.registerWebviewViewProvider = register
      vscode.window.registerUriHandler = registerUriHandler
      vscode.commands.registerCommand = command
      vscode.commands.executeCommand = executeCommand
      server.openSession = openSession
      deactivate()
    }
  })

  test("package activates for system notification URIs", () => {
    const manifest = require("../../../../package.json") as { activationEvents?: string[] }

    assert.ok(manifest.activationEvents?.includes("onUri"))
  })
})
