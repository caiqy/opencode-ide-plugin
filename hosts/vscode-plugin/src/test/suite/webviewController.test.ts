import * as assert from "assert"
import * as sinon from "sinon"
import * as vscode from "vscode"
import * as globals from "../../globals"
import { bridgeServer } from "../../ui/IdeBridgeServer"
import type { AcpTool, SelectFilesOptions, SelectFilesResult, ReadFilesResult } from "../../ui/IdeBridgeServer"
import { WebviewController, assignIntegratedBrowserGroups, toolGroupFromReference } from "../../ui/WebviewController"
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
      selectFiles: (
        handlers as {
          selectFiles?: (options: SelectFilesOptions) => Promise<SelectFilesResult>
        }
      ).selectFiles,
      readFiles: (
        handlers as {
          readFiles?: (paths: string[]) => Promise<ReadFilesResult>
        }
      ).readFiles,
      storageSet: (
        handlers as {
          storageSet?: (scope: "global" | "workspace" | "mem", key: string, value: string) => Promise<void>
        }
      ).storageSet,
      getAcpCapabilities: (handlers as any).getAcpCapabilities as (() => Promise<any>) | undefined,
      executeAcpTool: (handlers as any).executeAcpTool as
        | ((category: string, toolId: string, parameters: Record<string, unknown>) => Promise<any>)
        | undefined,
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

  test("selectFiles opens openDialog with file mode and returns selected paths", async () => {
    const file1 = vscode.Uri.file("D:/repo/a.ts")
    const file2 = vscode.Uri.file("D:/repo/b.ts")
    const showOpenDialog = sinon.stub(vscode.window, "showOpenDialog").resolves([file1, file2])

    const { controller, selectFiles } = await loadController()
    try {
      assert.ok(selectFiles)
      const result = await selectFiles!({ mode: "file", multiple: true })

      assert.ok(showOpenDialog.calledOnce)
      const options = showOpenDialog.firstCall.args[0]
      assert.strictEqual(options?.canSelectFiles, true)
      assert.strictEqual(options?.canSelectFolders, false)
      assert.strictEqual(options?.canSelectMany, true)
      assert.strictEqual(options?.openLabel, "选择文件")
      assert.deepStrictEqual(result, {
        cancelled: false,
        paths: [file1.fsPath, file2.fsPath],
      })
    } finally {
      controller.dispose()
    }
  })

  test("selectFiles opens openDialog with directory mode and returns directory path", async () => {
    const dir = vscode.Uri.file("D:/repo/src")
    const showOpenDialog = sinon.stub(vscode.window, "showOpenDialog").resolves([dir])

    const { controller, selectFiles } = await loadController()
    try {
      assert.ok(selectFiles)
      const result = await selectFiles!({ mode: "directory", multiple: false })

      assert.ok(showOpenDialog.calledOnce)
      const options = showOpenDialog.firstCall.args[0]
      assert.strictEqual(options?.canSelectFiles, false)
      assert.strictEqual(options?.canSelectFolders, true)
      assert.strictEqual(options?.canSelectMany, false)
      assert.strictEqual(options?.openLabel, "选择文件夹")
      assert.deepStrictEqual(result, {
        cancelled: false,
        paths: [dir.fsPath],
      })
    } finally {
      controller.dispose()
    }
  })

  test("selectFiles returns cancelled when user dismisses dialog", async () => {
    const showOpenDialog = sinon.stub(vscode.window, "showOpenDialog").resolves(undefined)

    const { controller, selectFiles } = await loadController()
    try {
      assert.ok(selectFiles)
      const result = await selectFiles!({ mode: "file" })

      assert.ok(showOpenDialog.calledOnce)
      assert.deepStrictEqual(result, { cancelled: true, paths: [] })
    } finally {
      controller.dispose()
    }
  })

  test("readFiles returns base64 content and per-file errors", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    assert.ok(workspaceFolder)
    const uri = vscode.Uri.joinPath(workspaceFolder.uri, ".gitkeep")
    const missing = "D:/repo/missing-opencode-image.png"

    const { controller, readFiles } = await loadController()
    try {
      assert.ok(readFiles)
      const result = await readFiles!([uri.fsPath, missing])
      const expected = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("base64")

      assert.strictEqual(result.files.length, 2)
      assert.strictEqual(result.files[0].path, uri.fsPath)
      assert.strictEqual(result.files[0].base64, expected)
      assert.strictEqual(result.files[1].path, missing)
      assert.ok(result.files[1].error)
    } finally {
      controller.dispose()
    }
  })

  test("getAcpCapabilities reports integrated_browser as connected", async () => {
    const { controller, getAcpCapabilities } = await loadController()
    try {
      assert.ok(getAcpCapabilities)
      const res = await getAcpCapabilities()
      const browserCategory = res.categories.find((c: any) => c.id === "integrated_browser")
      assert.ok(browserCategory)
      assert.strictEqual(browserCategory.status, "connected")
      assert.strictEqual(browserCategory.tools.length, 1)
      assert.strictEqual(browserCategory.tools[0].id, "openPage")
    } finally {
      controller.dispose()
    }
  })

  test("toolGroupFromReference 解析工具归属分组", () => {
    assert.strictEqual(toolGroupFromReference("ms-python.python/install_python_packages"), "ms-python.python")
    assert.strictEqual(toolGroupFromReference("browser/open_browser_page"), "browser")
    assert.strictEqual(toolGroupFromReference("renderMermaidDiagram"), undefined)
    assert.strictEqual(toolGroupFromReference("/leading"), undefined)
    assert.strictEqual(toolGroupFromReference(undefined), undefined)
  })

  test("assignIntegratedBrowserGroups 让缺少来源的内置浏览器工具跟随同族分组", () => {
    const tools: AcpTool[] = [
      { id: "open_browser_page", name: "open_browser_page", group: "vscodeBrowser" },
      { id: "read_page", name: "read_page", group: "vscodeBrowser" },
      { id: "list_browser_pages", name: "list_browser_pages" },
      { id: "install_python_packages", name: "install_python_packages", group: "ms-python.python" },
      { id: "skill", name: "skill" },
    ]

    assignIntegratedBrowserGroups(tools)

    assert.strictEqual(tools.find((t) => t.id === "list_browser_pages")?.group, "vscodeBrowser")
    assert.strictEqual(tools.find((t) => t.id === "install_python_packages")?.group, "ms-python.python")
    assert.strictEqual(tools.find((t) => t.id === "skill")?.group, undefined)
  })

  test("assignIntegratedBrowserGroups 不覆盖已有分组，无同族分组时保持原样", () => {
    const withGroup: AcpTool[] = [
      { id: "open_browser_page", name: "open_browser_page", group: "vscodeBrowser" },
      { id: "list_browser_pages", name: "list_browser_pages", group: "custom-group" },
    ]
    assignIntegratedBrowserGroups(withGroup)
    assert.strictEqual(withGroup.find((t) => t.id === "list_browser_pages")?.group, "custom-group")

    const noSibling: AcpTool[] = [{ id: "list_browser_pages", name: "list_browser_pages" }]
    assignIntegratedBrowserGroups(noSibling)
    assert.strictEqual(noSibling[0]?.group, undefined)
  })

  test("getAcpCapabilities maps language model tool inputSchema into parametersSchema", async function () {
    const lm = (vscode as any).lm
    if (!lm || !Array.isArray(lm.tools) || lm.tools.length === 0) {
      return this.skip()
    }

    const expected = (lm.tools as vscode.LanguageModelToolInformation[]).filter(
      (tool) =>
        tool && typeof tool.name === "string" && !tool.name.startsWith("vscode_") && !tool.name.startsWith("copilot_"),
    )
    if (expected.length === 0) {
      return this.skip()
    }

    const { controller, getAcpCapabilities } = await loadController()
    try {
      assert.ok(getAcpCapabilities)
      const res = await getAcpCapabilities()
      const category = res.categories.find((item: any) => item.id === "extensions")
      assert.ok(category, "extensions category should exist when lm.tools exposes tools")
      assert.strictEqual(category.tools.length, expected.length)

      for (const tool of expected) {
        const mapped = category.tools.find((item: any) => item.id === tool.name)
        assert.ok(mapped, `missing mapped tool ${tool.name}`)
        assert.deepStrictEqual(
          mapped.parametersSchema,
          (tool.inputSchema as Record<string, unknown>) || { type: "object", properties: {} },
        )
        assert.strictEqual(mapped.group, toolGroupFromReference((tool as any).fullReferenceName))
      }

      // 回归保护：宿主暴露带属性的 schema 时，映射后不能退化成空 schema
      const schemaBearing = expected.filter(
        (tool) => Object.keys(((tool.inputSchema as any)?.properties as object) ?? {}).length > 0,
      )
      if (schemaBearing.length > 0) {
        const mappedBearing = category.tools.filter(
          (item: any) => Object.keys(item.parametersSchema?.properties ?? {}).length > 0,
        )
        assert.strictEqual(mappedBearing.length, schemaBearing.length)
      }
    } finally {
      controller.dispose()
    }
  })

  test("executeAcpTool openPage validates url parameter and security boundaries", async () => {
    const executeCommandStub = sinon.stub(vscode.commands, "executeCommand").resolves()
    const { controller, executeAcpTool } = await loadController()
    try {
      assert.ok(executeAcpTool)

      // 缺少 url
      await assert.rejects(
        () => executeAcpTool("integrated_browser", "openPage", {}),
        /Missing or invalid 'url' parameter/,
      )

      // 空白 url
      await assert.rejects(
        () => executeAcpTool("integrated_browser", "openPage", { url: "   " }),
        /Missing or invalid 'url' parameter/,
      )

      // 格式非法
      await assert.rejects(
        () => executeAcpTool("integrated_browser", "openPage", { url: "not a valid url" }),
        /Invalid URL format/,
      )

      // 不支持的危险协议
      await assert.rejects(
        () => executeAcpTool("integrated_browser", "openPage", { url: "javascript:alert(1)" }),
        /Only http and https protocols are supported/,
      )
      await assert.rejects(
        () => executeAcpTool("integrated_browser", "openPage", { url: "file:///etc/passwd" }),
        /Only http and https protocols are supported/,
      )

      // 断言安全边界：非法 URL 绝不会派发任何 VS Code 命令
      assert.strictEqual(executeCommandStub.called, false)
    } finally {
      controller.dispose()
    }
  })

  test("executeAcpTool openPage executes valid url and returns success", async () => {
    const executeCommandStub = sinon.stub(vscode.commands, "executeCommand").resolves()
    const { controller, executeAcpTool } = await loadController()
    try {
      assert.ok(executeAcpTool)
      const res = await executeAcpTool("integrated_browser", "openPage", {
        url: "https://example.com/test-path?param=1",
      })

      assert.strictEqual(executeCommandStub.calledOnce, true)
      assert.strictEqual(executeCommandStub.firstCall.args[0], "simpleBrowser.show")
      assert.strictEqual(executeCommandStub.firstCall.args[1], "https://example.com/test-path?param=1")
      assert.deepStrictEqual(res, {
        output: "Opened https://example.com/test-path?param=1 in integrated browser",
      })
    } finally {
      controller.dispose()
    }
  })
})
