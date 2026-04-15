import * as assert from "assert"
import * as sinon from "sinon"
import * as vscode from "vscode"
import * as globals from "../../globals"
import { bridgeServer } from "../../ui/IdeBridgeServer"
import { WebviewController } from "../../ui/WebviewController"
import { errorHandler } from "../../utils/ErrorHandler"
import { FileMonitor } from "../../utils/FileMonitor"

suite("WebviewController Test Suite", () => {
  teardown(() => {
    sinon.restore()
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
})
