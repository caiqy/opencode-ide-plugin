import * as assert from "assert"
import * as vscode from "vscode"
import { BackendLauncher } from "../../backend/BackendLauncher"
import { activate, deactivate, getExtensionInstance } from "../../extension"
import { ActivityBarProvider } from "../../ui/ActivityBarProvider"
import { bridgeServer } from "../../ui/IdeBridgeServer"
import { WebviewManager } from "../../ui/WebviewManager"

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
      packageJSON: { version: "test" },
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

  test("extension instance dispose should be idempotent", async () => {
    const calls: string[] = []
    const webview = WebviewManager.prototype.dispose
    const activity = ActivityBarProvider.prototype.dispose
    const backend = BackendLauncher.prototype.terminate
    const bridge = bridgeServer.stop
    const register = vscode.window.registerWebviewViewProvider
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
      vscode.commands.registerCommand = command
      deactivate()
    }
  })

  test("extension dispose should release registered webview provider disposable", async () => {
    const calls: string[] = []
    const activity = ActivityBarProvider.prototype.dispose
    const register = vscode.window.registerWebviewViewProvider
    const command = vscode.commands.registerCommand

    ActivityBarProvider.prototype.dispose = function () {
      calls.push("activity")
    }
    vscode.window.registerWebviewViewProvider = (() => ({
      dispose() {
        calls.push("provider")
      },
    })) as typeof vscode.window.registerWebviewViewProvider
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
      vscode.commands.registerCommand = command
      deactivate()
    }
  })
})
