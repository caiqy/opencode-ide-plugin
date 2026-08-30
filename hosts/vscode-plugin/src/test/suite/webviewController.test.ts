import * as assert from "assert"
import * as sinon from "sinon"
import * as vscode from "vscode"
import * as globals from "../../globals"
import { bridgeServer } from "../../ui/IdeBridgeServer"
import { WebviewController } from "../../ui/WebviewController"
import { errorHandler } from "../../utils/ErrorHandler"
import { FileMonitor } from "../../utils/FileMonitor"
import { testResponse } from "./fetchResponse"
import { automaticUpdateStorageKey, type UpdateService } from "../../update/UpdateService"

suite("WebviewController Test Suite", () => {
  teardown(() => {
    sinon.restore()
  })

  async function loadController(
    options: {
      uiBase?: string
      updateService?: ReturnType<typeof updateServiceStub>
      storageSet?: (scope: "global" | "workspace" | "mem", key: string, value: string) => Promise<void>
    } = {},
  ) {
    let handlers: unknown
    let receiveMessage: ((message: any) => unknown) | undefined
    const writeFile = sinon.stub().resolves()
    const bridgeSend = sinon.stub(bridgeServer, "send").returns(undefined)
    const webview = {
      html: "",
      cspSource: "vscode-webview:",
      asWebviewUri: sinon.stub().callsFake((uri: vscode.Uri) => uri),
      onDidReceiveMessage: sinon.stub().callsFake((handler: (message: any) => unknown) => {
        receiveMessage = handler
        return { dispose: sinon.spy() }
      }),
      postMessage: sinon.stub().resolves(true),
    } as unknown as vscode.Webview & { html: string }

    sinon
      .stub(globals, "getUpdateService")
      .returns(options.updateService as unknown as UpdateService | undefined)
    sinon.stub(bridgeServer, "createSession").callsFake(async (input) => {
      handlers = input
      return {
        sessionId: "session-save-image",
        baseUrl: "http://127.0.0.1:4000/idebridge/session-save-image",
        token: "token-save-image",
      }
    })
    sinon.stub(FileMonitor.prototype, "startMonitoring").callsFake(() => undefined)
    sinon.stub(FileMonitor.prototype, "stopMonitoring").callsFake(() => undefined)
    sinon.stub(vscode.env, "asExternalUri").callsFake(async (uri: vscode.Uri) => uri)
    const context = {
      extensionUri: vscode.Uri.file("D:/test-extension"),
      extension: { packageJSON: { version: "1.0.0" } },
    } as unknown as vscode.ExtensionContext

    const controller = new WebviewController({
      webview,
      context,
      storageGet: async () => ({}),
      storageSet: options.storageSet ?? (async () => undefined),
      readFile: async () => Buffer.from("<html>${uiUrl}${cspSource}${cspOrigins}</html>"),
      writeFile,
    })

    await controller.load({
      uiBase: options.uiBase ?? "http://127.0.0.1:4096/app",
    } as any)

    return {
      controller,
      webview,
      bridgeSend,
      writeFile,
      receiveMessage: (message: any) => receiveMessage?.(message),
      saveImage: (handlers as { saveImage?: (url: string, filename: string) => Promise<{ cancelled: boolean }> })
        .saveImage,
      storageSet: (
        handlers as {
          storageSet?: (scope: "global" | "workspace" | "mem", key: string, value: string) => Promise<void>
        }
      ).storageSet,
    }
  }

  function updateServiceStub() {
    return {
      attachSession: sinon.spy(),
      detachSession: sinon.spy(),
      checkNow: sinon.stub().resolves(null),
      checkForUpdates: sinon.stub().resolves({ status: "up-to-date", currentVersion: "1.0.0" }),
      getUpdateInfo: sinon.stub().returns({ latest: null, hasUpdate: false }),
      installUpdate: sinon.stub().resolves(),
      isAutomaticChecksEnabled: sinon.stub().returns(false),
      setAutomaticChecks: sinon.spy(),
    }
  }

  test("readUris 只把解析结果返回 webview，不通过 bridge 直接插入", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    assert.ok(workspaceFolder)
    const uri = vscode.Uri.joinPath(workspaceFolder.uri, ".gitkeep")
    const { controller, webview, bridgeSend, receiveMessage } = await loadController()

    await receiveMessage({ type: "readUris", uris: [uri.toString()] })

    const message = (webview.postMessage as unknown as sinon.SinonStub)
      .getCalls()
      .map((call) => call.args[0])
      .find((value) => value.type === "readUrisResult")
    assert.ok(message)
    assert.deepStrictEqual(message.results, [
      {
        uri: uri.toString(),
        ok: true,
        webviewUri: uri.toString(),
        data: Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("base64"),
      },
    ])
    assert.deepStrictEqual(message.filePaths, [uri.fsPath])
    assert.deepStrictEqual(message.directoryPaths, [])
    assert.ok(!bridgeSend.calledWithMatch("session-save-image", sinon.match({ type: "insertPaths" })))

    controller.dispose()
  })

  test("保存插件自动更新设置后立即更新调度状态", async () => {
    const updateService = updateServiceStub()
    const persist = sinon.stub().resolves()
    const { controller, storageSet } = await loadController({ updateService, storageSet: persist })

    assert.ok(storageSet)
    await storageSet!("global", automaticUpdateStorageKey, "false")

    assert.ok(persist.calledOnceWithExactly("global", automaticUpdateStorageKey, "false"))
    assert.ok(updateService.setAutomaticChecks.calledOnceWithExactly(false))
    controller.dispose()
  })

  test("load 过程中若先 dispose 再 await 失败，仍会回滚已延后创建的资源", async () => {
    const updateService = {
      attachSession: sinon.spy(),
      detachSession: sinon.spy(),
      checkNow: sinon.stub().resolves(null),
      getUpdateInfo: sinon.stub().returns({ latest: null, hasUpdate: false }),
      installUpdate: sinon.stub().resolves(),
    }

    let resolveSession: ((value: { sessionId: string; baseUrl: string; token: string }) => void) | undefined
    const createSession = sinon.stub(bridgeServer, "createSession").callsFake(
      () =>
        new Promise((resolve) => {
          resolveSession = resolve
        }),
    )
    const removeSession = sinon.stub(bridgeServer, "removeSession")
    sinon.stub(globals, "getUpdateService").returns(updateService as any)
    const handleLoadError = sinon.stub(errorHandler, "handleWebviewLoadError").resolves()
    const startMonitoring = sinon.stub(FileMonitor.prototype, "startMonitoring").callsFake(() => undefined)
    const stopMonitoring = sinon.stub(FileMonitor.prototype, "stopMonitoring").callsFake(() => undefined)

    sinon.stub(vscode.env, "asExternalUri").rejects(new Error("cancelled after dispose"))

    const webview = {
      html: "",
      cspSource: "vscode-webview:",
      asWebviewUri: sinon.stub().callsFake((uri: vscode.Uri) => uri),
      onDidReceiveMessage: sinon.stub().returns({ dispose: sinon.spy() }),
      postMessage: sinon.stub().resolves(true),
    } as unknown as vscode.Webview

    const context = {
      extensionUri: vscode.Uri.file("D:/test-extension"),
    } as vscode.ExtensionContext

    const controller = new WebviewController({
      webview,
      context,
      storageGet: async () => ({}),
      storageSet: async () => undefined,
    })

    const load = controller.load({
      uiBase: "http://127.0.0.1:4096/app",
    } as any)

    controller.dispose()
    resolveSession?.({
      sessionId: "session-disposed",
      baseUrl: "http://127.0.0.1:4000/idebridge/session-disposed",
      token: "token-disposed",
    })

    await load

    assert.ok(createSession.calledOnce)
    assert.ok(updateService.attachSession.notCalled)
    assert.ok(startMonitoring.notCalled)
    assert.ok(stopMonitoring.notCalled)
    assert.ok(removeSession.calledOnceWithExactly("session-disposed"))
    assert.ok(updateService.detachSession.notCalled)
    assert.ok(handleLoadError.notCalled)
  })

  test("load 中途失败时会回滚 bridge session、update attach 和 file monitor", async () => {
    const updateService = {
      attachSession: sinon.spy(),
      detachSession: sinon.spy(),
      checkNow: sinon.stub().resolves(null),
      getUpdateInfo: sinon.stub().returns({ latest: null, hasUpdate: false }),
      installUpdate: sinon.stub().resolves(),
    }

    const createSession = sinon.stub(bridgeServer, "createSession").resolves({
      sessionId: "session-1",
      baseUrl: "http://127.0.0.1:4000/idebridge/session-1",
      token: "token-1",
    })
    const removeSession = sinon.stub(bridgeServer, "removeSession")
    sinon.stub(globals, "getUpdateService").returns(updateService as any)
    const handleLoadError = sinon.stub(errorHandler, "handleWebviewLoadError").resolves()
    const startMonitoring = sinon.stub(FileMonitor.prototype, "startMonitoring").callsFake(() => undefined)
    const stopMonitoring = sinon.stub(FileMonitor.prototype, "stopMonitoring").callsFake(() => undefined)

    const asExternalUri = sinon.stub(vscode.env, "asExternalUri")
    asExternalUri.onFirstCall().resolves(vscode.Uri.parse("http://127.0.0.1:4096/app"))
    asExternalUri.onSecondCall().rejects(new Error("bridge uri failed"))

    const webview = {
      html: "",
      cspSource: "vscode-webview:",
      asWebviewUri: sinon.stub().callsFake((uri: vscode.Uri) => uri),
      onDidReceiveMessage: sinon.stub().returns({ dispose: sinon.spy() }),
      postMessage: sinon.stub().resolves(true),
    } as unknown as vscode.Webview

    const context = {
      extensionUri: vscode.Uri.file("D:/test-extension"),
    } as vscode.ExtensionContext

    const controller = new WebviewController({
      webview,
      context,
      storageGet: async () => ({}),
      storageSet: async () => undefined,
    })

    await assert.rejects(
      () =>
        controller.load({
          uiBase: "http://127.0.0.1:4096/app",
        } as any),
      /bridge uri failed/,
    )

    assert.ok(createSession.calledOnce)
    assert.deepStrictEqual(updateService.attachSession.firstCall?.args[0], "session-1")
    assert.ok(startMonitoring.calledOnce)
    assert.ok(stopMonitoring.calledOnce)
    assert.ok(removeSession.calledOnceWithExactly("session-1"))
    assert.ok(updateService.detachSession.calledOnceWithExactly("session-1"))
    assert.ok(handleLoadError.calledOnce)
  })

  test("load wires a saveImage handler that decodes data URLs and writes the selected file", async () => {
    const target = vscode.Uri.file("D:/tmp/opencode-data-url.png")
    const showSaveDialog = sinon.stub(vscode.window, "showSaveDialog").resolves(target)

    const { controller, saveImage, writeFile } = await loadController()

    assert.ok(saveImage)

    const result = await saveImage!("data:image/png;base64,aGVsbG8=", "copied-image.png")

    assert.ok(showSaveDialog.calledOnce)
    assert.ok(writeFile.calledOnce)
    assert.strictEqual(writeFile.firstCall.args[0].toString(), target.toString())
    assert.strictEqual(Buffer.from(writeFile.firstCall.args[1]).toString("utf8"), "hello")
    assert.deepStrictEqual(result, { cancelled: false })

    controller.dispose()
  })

  test("load wires a saveImage handler that fetches remote URLs before writing", async () => {
    const target = vscode.Uri.file("D:/tmp/opencode-remote-url.png")
    const originalFetch = globalThis.fetch
    const showSaveDialog = sinon.stub(vscode.window, "showSaveDialog").resolves(target)
    globalThis.fetch = (async (input) => {
      assert.strictEqual(String(input), "https://example.com/image.png")
      return testResponse(Buffer.from("remote-image"), { status: 200 })
    }) as typeof fetch

    try {
      const { controller, saveImage, writeFile } = await loadController()

      assert.ok(saveImage)

      const result = await saveImage!("https://example.com/image.png", "remote-image.png")

      assert.ok(showSaveDialog.calledOnce)
      assert.ok(writeFile.calledOnce)
      assert.strictEqual(writeFile.firstCall.args[0].toString(), target.toString())
      assert.strictEqual(Buffer.from(writeFile.firstCall.args[1]).toString("utf8"), "remote-image")
      assert.deepStrictEqual(result, { cancelled: false })

      controller.dispose()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("saveImage resolves generated-image relative URLs against the web UI base", async () => {
    const target = vscode.Uri.file("D:/tmp/opencode-relative-url.png")
    const originalFetch = globalThis.fetch
    const showSaveDialog = sinon.stub(vscode.window, "showSaveDialog").resolves(target)
    globalThis.fetch = (async (input) => {
      assert.strictEqual(
        String(input),
        "http://127.0.0.1:4096/generated-image?path=.opencode%2Fgenerated-images%2Ffoo.png",
      )
      return testResponse(Buffer.from("relative-image"), { status: 200 })
    }) as typeof fetch

    try {
      const { controller, saveImage, writeFile } = await loadController()

      assert.ok(saveImage)

      const result = await saveImage!(
        "/generated-image?path=.opencode%2Fgenerated-images%2Ffoo.png",
        "relative-image.png",
      )

      assert.ok(showSaveDialog.calledOnce)
      assert.ok(writeFile.calledOnce)
      assert.strictEqual(Buffer.from(writeFile.firstCall.args[1]).toString("utf8"), "relative-image")
      assert.deepStrictEqual(result, { cancelled: false })

      controller.dispose()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test("saveImage rejects non-base64 data URLs and does not write a file", async () => {
    const target = vscode.Uri.file("D:/tmp/opencode-invalid-data-url.png")
    sinon.stub(vscode.window, "showSaveDialog").resolves(target)

    const { controller, saveImage, writeFile } = await loadController()

    await assert.rejects(() => saveImage!("data:image/png,hello", "invalid-data-url.png"), /Unsupported data URL/)
    assert.ok(writeFile.notCalled)

    controller.dispose()
  })

  test("saveImage rejects invalid base64 data URLs and does not write a file", async () => {
    const target = vscode.Uri.file("D:/tmp/opencode-invalid-base64.png")
    sinon.stub(vscode.window, "showSaveDialog").resolves(target)

    const { controller, saveImage, writeFile } = await loadController()

    await assert.rejects(() => saveImage!("data:image/png;base64,%%%", "invalid-base64.png"), /Invalid base64 data URL/)
    assert.ok(writeFile.notCalled)

    controller.dispose()
  })

  test("saveImage returns early when the user cancels the save dialog", async () => {
    const originalFetch = globalThis.fetch
    const fetchCalls: string[] = []
    globalThis.fetch = (async (input) => {
      fetchCalls.push(String(input))
      return new Response(Buffer.from("unexpected"), { status: 200 })
    }) as typeof fetch
    sinon.stub(vscode.window, "showSaveDialog").resolves(undefined)

    try {
      const { controller, saveImage, writeFile } = await loadController()

      assert.ok(saveImage)

      const result = await saveImage!("https://example.com/cancelled-image.png", "cancelled-image.png")

      assert.ok(writeFile.notCalled)
      assert.deepStrictEqual(fetchCalls, [])
      assert.deepStrictEqual(result, { cancelled: true })

      controller.dispose()
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
