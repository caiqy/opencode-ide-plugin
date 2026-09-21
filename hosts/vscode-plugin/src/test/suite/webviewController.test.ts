import * as assert from "assert"
import * as sinon from "sinon"
import * as vscode from "vscode"
import * as globals from "../../globals"
import { bridgeServer } from "../../ui/IdeBridgeServer"
import type { AcpTool, SelectFilesOptions, SelectFilesResult, ReadFilesResult } from "../../ui/IdeBridgeServer"
import { WebviewController, assignIntegratedBrowserGroups, toolGroupFromReference } from "../../ui/WebviewController"
import { debugStateStore } from "../../debug/DebugTracking"
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

  test("getAcpCapabilities 不再上报集成浏览器能力", async () => {
    const { controller, getAcpCapabilities } = await loadController()
    try {
      assert.ok(getAcpCapabilities)
      const res = await getAcpCapabilities()
      assert.strictEqual(
        res.categories.find((c: any) => c.id === "integrated_browser"),
        undefined,
      )
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

  test("executeAcpTool 拒绝已移除的集成浏览器类别且不派发命令", async () => {
    const executeCommandStub = sinon.stub(vscode.commands, "executeCommand").resolves()
    const { controller, executeAcpTool } = await loadController()
    try {
      assert.ok(executeAcpTool)

      await assert.rejects(
        () => executeAcpTool("integrated_browser", "openPage", { url: "https://example.com/test-path?param=1" }),
        /Unsupported ACP category: integrated_browser/,
      )

      assert.strictEqual(executeCommandStub.called, false)
    } finally {
      controller.dispose()
    }
  })

  test("getAcpCapabilities 上报运行和调试大类与完整工具集", async () => {
    const { controller, getAcpCapabilities } = await loadController()
    try {
      assert.ok(getAcpCapabilities)
      const res = await getAcpCapabilities()
      const category = res.categories.find((item: any) => item.id === "debug")
      assert.ok(category, "debug category should be reported")
      assert.strictEqual(category.name, "运行和调试")
      assert.strictEqual(category.status, "connected")

      assert.deepStrictEqual(
        category.tools.map((tool: any) => tool.id),
        [
          "listLaunchConfigs",
          "startDebugging",
          "stopDebugging",
          "restartDebugging",
          "getDebugState",
          "getCallStack",
          "getVariables",
          "listBreakpoints",
          "addBreakpoints",
          "removeBreakpoints",
          "controlExecution",
          "evaluate",
          "setExceptionBreakpoints",
        ],
      )
      for (const tool of category.tools) {
        assert.ok(tool.parametersSchema, `${tool.id} should expose parametersSchema`)
        assert.strictEqual(typeof tool.name, "string")
        assert.ok(tool.name.length > 0)
      }
    } finally {
      controller.dispose()
    }
  })

  test("executeAcpTool 调试工具无会话与非法参数时返回明确错误", async () => {
    const { controller, executeAcpTool } = await loadController()
    try {
      assert.ok(executeAcpTool)

      const configs = JSON.parse(((await executeAcpTool("debug", "listLaunchConfigs", {})) as { output: string }).output)
      assert.ok(Array.isArray(configs))

      await assert.rejects(() => executeAcpTool("debug", "startDebugging", {}), /Missing or invalid 'name' parameter/)
      await assert.rejects(() => executeAcpTool("debug", "stopDebugging", {}), /No active debug session/)
      await assert.rejects(() => executeAcpTool("debug", "restartDebugging", {}), /No active debug session/)
      await assert.rejects(() => executeAcpTool("debug", "getCallStack", {}), /No active debug session/)
      await assert.rejects(() => executeAcpTool("debug", "getVariables", {}), /No active debug session/)
      await assert.rejects(
        () => executeAcpTool("debug", "addBreakpoints", { file: "D:/repo/missing.ts" }),
        /Missing or invalid 'line' parameter/,
      )
      await assert.rejects(
        () => executeAcpTool("debug", "addBreakpoints", { file: "D:/repo/missing.ts", line: 0 }),
        /'line' must be a 1-based line number/,
      )
      await assert.rejects(
        () => executeAcpTool("debug", "removeBreakpoints", { file: "D:/repo/definitely-missing.ts" }),
        /No matching breakpoint found/,
      )
      await assert.rejects(
        () => executeAcpTool("debug", "controlExecution", { action: "teleport" }),
        /Unsupported execution action/,
      )
      await assert.rejects(
        () => executeAcpTool("debug", "evaluate", {}),
        /Missing or invalid 'expression' parameter/,
      )
      await assert.rejects(
        () => executeAcpTool("debug", "setExceptionBreakpoints", {}),
        /Missing 'filters' parameter/,
      )
      await assert.rejects(() => executeAcpTool("debug", "noSuchTool", {}), /Unsupported tool in debug category/)
    } finally {
      controller.dispose()
    }
  })

  test("executeAcpTool 断点增删闭环", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    assert.ok(workspaceFolder)
    const file = vscode.Uri.joinPath(workspaceFolder.uri, "debug-breakpoint-temp.ts").fsPath

    const { controller, executeAcpTool } = await loadController()
    try {
      assert.ok(executeAcpTool)
      const added = (await executeAcpTool("debug", "addBreakpoints", {
        file,
        line: 3,
        condition: "value > 1",
      })) as { output: string }
      assert.strictEqual(added.output, `Breakpoint added at ${file}:3`)

      const listed = JSON.parse(
        ((await executeAcpTool("debug", "listBreakpoints", {})) as { output: string }).output,
      ) as Array<{ file?: string; line?: number; condition?: string }>
      const match = listed.find(
        (breakpoint) => breakpoint.file?.toLowerCase() === file.toLowerCase() && breakpoint.line === 3,
      )
      assert.ok(match, "added breakpoint should be listed")
      assert.strictEqual(match.condition, "value > 1")

      const removed = (await executeAcpTool("debug", "removeBreakpoints", { file, line: 3 })) as { output: string }
      assert.strictEqual(removed.output, `Removed 1 breakpoint(s) for ${file}`)
    } finally {
      try {
        await executeAcpTool?.("debug", "removeBreakpoints", { file })
      } catch {}
      controller.dispose()
    }
  })

  test("executeAcpTool 调试工具通过 DAP 请求读取运行时状态", async () => {
    const customRequest = sinon.stub().callsFake(async (command: string, args?: any) => {
      switch (command) {
        case "threads":
          return { threads: [{ id: 2, name: "main" }] }
        case "stackTrace":
          return {
            stackFrames: [{ id: 11, name: "main", source: { path: "D:/proj/index.ts" }, line: 5, column: 1 }],
          }
        case "scopes":
          return { scopes: [{ name: "Local", variablesReference: 99, expensive: false }] }
        case "variables":
          if (args?.variablesReference === 99) {
            return {
              variables: [
                { name: "obj", value: "Object", type: "object", variablesReference: 100 },
                { name: "x", value: "42", type: "number", variablesReference: 0 },
              ],
            }
          }
          return { variables: [{ name: "prop", value: "nested", type: "string", variablesReference: 0 }] }
        case "evaluate":
          return { result: "42", type: "number", variablesReference: 0 }
        default:
          return {}
      }
    })
    const fakeSession = {
      id: "debug-session-1",
      name: "WebGUI: dev",
      type: "node",
      configuration: { type: "node", name: "WebGUI: dev", request: "launch" },
      workspaceFolder: vscode.workspace.workspaceFolders?.[0],
      customRequest,
    } as unknown as vscode.DebugSession
    sinon.stub(vscode.debug, "activeDebugSession").get(() => fakeSession)
    const stopDebugging = sinon.stub(vscode.debug, "stopDebugging").resolves()
    const startDebugging = sinon.stub(vscode.debug, "startDebugging").resolves(true)

    const { controller, executeAcpTool } = await loadController()
    try {
      assert.ok(executeAcpTool)

      debugStateStore.reset()
      debugStateStore.setActive({ id: "debug-session-1", name: "WebGUI: dev", type: "node" })
      debugStateStore.onDapMessage("debug-session-1", {
        type: "event",
        event: "stopped",
        body: { reason: "breakpoint", threadId: 2, hitBreakpointIds: [7] },
      })

      const state = JSON.parse(((await executeAcpTool("debug", "getDebugState", {})) as { output: string }).output)
      assert.strictEqual(state.activeSession.name, "WebGUI: dev")
      assert.deepStrictEqual(state.pausedThreads, [{ threadId: 2, reason: "breakpoint", hitBreakpointIds: [7] }])
      assert.deepStrictEqual(state.threads, [{ id: 2, name: "main" }])
      assert.ok(customRequest.calledWith("threads"))

      const frames = JSON.parse(
        ((await executeAcpTool("debug", "getCallStack", {})) as { output: string }).output,
      )
      assert.deepStrictEqual(frames, [{ id: 11, name: "main", source: "D:/proj/index.ts", line: 5, column: 1 }])
      assert.ok(customRequest.calledWithMatch("stackTrace", { threadId: 2, startFrame: 0, levels: 50 }))

      const scopes = JSON.parse(
        ((await executeAcpTool("debug", "getVariables", { frameId: 11 })) as { output: string }).output,
      )
      assert.deepStrictEqual(scopes, [{ name: "Local", variablesReference: 99, expensive: false }])

      const variables = JSON.parse(
        ((await executeAcpTool("debug", "getVariables", { variablesReference: 99 })) as { output: string }).output,
      )
      assert.deepStrictEqual(variables, {
        variables: [
          {
            name: "obj",
            value: "Object",
            type: "object",
            variablesReference: 100,
            children: [{ name: "prop", value: "nested", type: "string", variablesReference: 0 }],
          },
          { name: "x", value: "42", type: "number", variablesReference: 0 },
        ],
        truncated: false,
      })
      assert.ok(customRequest.calledWithMatch("variables", { variablesReference: 99, count: 200 }))

      const evaluated = JSON.parse(
        ((await executeAcpTool("debug", "evaluate", { expression: "x" })) as { output: string }).output,
      )
      assert.strictEqual(evaluated.result, "42")
      assert.ok(customRequest.calledWithMatch("evaluate", { expression: "x", context: "watch" }))

      const continued = (await executeAcpTool("debug", "controlExecution", {
        action: "continue",
        threadId: 2,
      })) as { output: string }
      assert.ok(customRequest.calledWithMatch("continue", { threadId: 2, singleThread: true }))
      assert.match(continued.output, /Execution command "continue"/)
      // 控制请求成功后主动失效暂停缓存（不依赖适配器补发 continued 事件）
      assert.deepStrictEqual(debugStateStore.pausedThreads("debug-session-1"), [])

      debugStateStore.onDapMessage("debug-session-1", {
        type: "event",
        event: "stopped",
        body: { reason: "step", threadId: 2 },
      })
      await executeAcpTool("debug", "controlExecution", { action: "stepOver" })
      assert.ok(customRequest.calledWithMatch("next", { threadId: 2, singleThread: true }))

      debugStateStore.onDapMessage("debug-session-1", {
        type: "event",
        event: "stopped",
        body: { reason: "step", threadId: 2 },
      })
      await executeAcpTool("debug", "controlExecution", { action: "stepIn" })
      assert.ok(customRequest.calledWithMatch("stepIn", { threadId: 2, singleThread: true }))

      debugStateStore.onDapMessage("debug-session-1", {
        type: "event",
        event: "stopped",
        body: { reason: "step", threadId: 2 },
      })
      await executeAcpTool("debug", "controlExecution", { action: "stepOut" })
      assert.ok(customRequest.calledWithMatch("stepOut", { threadId: 2, singleThread: true }))

      await executeAcpTool("debug", "setExceptionBreakpoints", { filters: ["uncaught"] })
      assert.ok(customRequest.calledWithMatch("setExceptionBreakpoints", { filters: ["uncaught"] }))

      const stopped = (await executeAcpTool("debug", "stopDebugging", {})) as { output: string }
      assert.strictEqual(stopped.output, `Stopped debug session "WebGUI: dev"`)
      assert.ok(stopDebugging.calledOnceWith(fakeSession))

      const restarted = (await executeAcpTool("debug", "restartDebugging", {})) as { output: string }
      assert.strictEqual(restarted.output, `Debug session "WebGUI: dev" restarted`)
      assert.ok(startDebugging.calledWithMatch(fakeSession.workspaceFolder ?? sinon.match.any, fakeSession.configuration))
    } finally {
      debugStateStore.reset()
      controller.dispose()
    }
  })

  test("executeAcpTool 运行中会话可查询线程并通过 threads 暂停", async () => {
    const customRequest = sinon.stub().callsFake(async (command: string) => {
      if (command === "threads") {
        return {
          threads: [
            { id: 7, name: "main" },
            { id: 8, name: "worker" },
          ],
        }
      }
      return {}
    })
    const fakeSession = {
      id: "debug-session-2",
      name: "WebGUI: dev",
      type: "node",
      configuration: { type: "node", name: "WebGUI: dev", request: "launch" },
      workspaceFolder: vscode.workspace.workspaceFolders?.[0],
      customRequest,
    } as unknown as vscode.DebugSession
    sinon.stub(vscode.debug, "activeDebugSession").get(() => fakeSession)

    const { controller, executeAcpTool } = await loadController()
    try {
      assert.ok(executeAcpTool)

      debugStateStore.reset()
      debugStateStore.setActive({ id: "debug-session-2", name: "WebGUI: dev", type: "node" })

      const state = JSON.parse(((await executeAcpTool("debug", "getDebugState", {})) as { output: string }).output)
      assert.deepStrictEqual(state.pausedThreads, [])
      assert.deepStrictEqual(state.threads, [
        { id: 7, name: "main" },
        { id: 8, name: "worker" },
      ])

      // 运行中的会话：读取类工具必须报告未暂停
      await assert.rejects(() => executeAcpTool("debug", "getCallStack", {}), /not paused/)
      await assert.rejects(() => executeAcpTool("debug", "getVariables", { frameId: 1 }), /not paused/)
      await assert.rejects(() => executeAcpTool("debug", "evaluate", { expression: "x" }), /not paused/)
      await assert.rejects(() => executeAcpTool("debug", "controlExecution", { action: "continue" }), /not paused/)

      const paused = (await executeAcpTool("debug", "controlExecution", { action: "pause" })) as { output: string }
      assert.ok(customRequest.calledWithMatch("pause", { threadId: 7 }))
      assert.match(paused.output, /Execution command "pause"/)
    } finally {
      debugStateStore.reset()
      controller.dispose()
    }
  })

  test("executeAcpTool 变量展开遵守截断上限并透传适配器错误", async () => {
    const bigVariables = Array.from({ length: 260 }, (_, index) => ({
      name: `v${index}`,
      value: `${index}`,
      type: "number",
      variablesReference: 0,
    }))
    const customRequest = sinon.stub().callsFake(async (command: string, args?: any) => {
      if (command === "variables") {
        if (args?.variablesReference === 500) {
          return { variables: bigVariables }
        }
        if (args?.variablesReference === 501) {
          throw new Error("adapter rejected variables")
        }
        return { variables: [{ name: "x", value: "1", type: "number", variablesReference: 0 }] }
      }
      if (command === "evaluate") {
        if (args?.expression === "boom") {
          throw new Error("adapter rejected evaluate")
        }
        return { result: "ok", type: "string", variablesReference: 0 }
      }
      return {}
    })
    const fakeSession = {
      id: "debug-session-3",
      name: "WebGUI: dev",
      type: "node",
      configuration: { type: "node", name: "WebGUI: dev", request: "launch" },
      workspaceFolder: vscode.workspace.workspaceFolders?.[0],
      customRequest,
    } as unknown as vscode.DebugSession
    sinon.stub(vscode.debug, "activeDebugSession").get(() => fakeSession)

    const { controller, executeAcpTool } = await loadController()
    try {
      assert.ok(executeAcpTool)

      debugStateStore.reset()
      debugStateStore.setActive({ id: "debug-session-3", name: "WebGUI: dev", type: "node" })
      debugStateStore.onDapMessage("debug-session-3", {
        type: "event",
        event: "stopped",
        body: { threadId: 1, reason: "step" },
      })

      const expanded = JSON.parse(
        ((await executeAcpTool("debug", "getVariables", { variablesReference: 500 })) as { output: string }).output,
      )
      assert.strictEqual(expanded.variables.length, 200)
      assert.strictEqual(expanded.truncated, true)

      await assert.rejects(
        () => executeAcpTool("debug", "getVariables", { variablesReference: 501 }),
        /adapter rejected variables/,
      )
      await assert.rejects(() => executeAcpTool("debug", "evaluate", { expression: "boom" }), /adapter rejected evaluate/)
    } finally {
      debugStateStore.reset()
      controller.dispose()
    }
  })

  test("executeAcpTool 控制请求成功后主动失效暂停缓存", async () => {
    const customRequest = sinon.stub().callsFake(async (command: string) => {
      if (command === "threads") {
        return { threads: [{ id: 3, name: "main" }] }
      }
      return {}
    })
    const fakeSession = {
      id: "debug-session-4",
      name: "WebGUI: dev",
      type: "node",
      configuration: { type: "node", name: "WebGUI: dev", request: "launch" },
      workspaceFolder: vscode.workspace.workspaceFolders?.[0],
      customRequest,
    } as unknown as vscode.DebugSession
    sinon.stub(vscode.debug, "activeDebugSession").get(() => fakeSession)

    const { controller, executeAcpTool } = await loadController()
    try {
      assert.ok(executeAcpTool)

      debugStateStore.reset()
      debugStateStore.setActive({ id: "debug-session-4", name: "WebGUI: dev", type: "node" })
      debugStateStore.onDapMessage("debug-session-4", {
        type: "event",
        event: "stopped",
        body: { threadId: 3, reason: "breakpoint" },
      })

      await executeAcpTool("debug", "controlExecution", { action: "continue" })
      assert.ok(customRequest.calledWithMatch("continue", { threadId: 3, singleThread: true }))
      assert.deepStrictEqual(debugStateStore.pausedThreads("debug-session-4"), [])

      // 适配器不再补发 continued 事件时，后续读取与控制必须被拒绝
      await assert.rejects(() => executeAcpTool("debug", "getCallStack", {}), /not paused/)
      await assert.rejects(() => executeAcpTool("debug", "controlExecution", { action: "stepOver" }), /not paused/)
      await assert.rejects(() => executeAcpTool("debug", "evaluate", { expression: "x" }), /not paused/)
    } finally {
      debugStateStore.reset()
      controller.dispose()
    }
  })

  test("executeAcpTool 变量深度上限与恰好 count 的截断标记", async () => {
    const chain: Record<number, unknown[]> = {
      700: [{ name: "l1", value: "1", type: "object", variablesReference: 701 }],
      701: [{ name: "l2", value: "2", type: "object", variablesReference: 702 }],
      702: [{ name: "l3", value: "3", type: "object", variablesReference: 703 }],
      703: [{ name: "l4", value: "4", type: "object", variablesReference: 704 }],
      704: [{ name: "l5", value: "5", type: "number", variablesReference: 0 }],
      710: Array.from({ length: 200 }, (_, index) => ({
        name: `e${index}`,
        value: `${index}`,
        type: "number",
        variablesReference: 0,
      })),
    }
    const customRequest = sinon.stub().callsFake(async (command: string, args?: any) => {
      if (command === "variables") {
        return { variables: chain[args?.variablesReference as number] ?? [] }
      }
      return {}
    })
    const fakeSession = {
      id: "debug-session-5",
      name: "WebGUI: dev",
      type: "node",
      configuration: { type: "node", name: "WebGUI: dev", request: "launch" },
      workspaceFolder: vscode.workspace.workspaceFolders?.[0],
      customRequest,
    } as unknown as vscode.DebugSession
    sinon.stub(vscode.debug, "activeDebugSession").get(() => fakeSession)

    const { controller, executeAcpTool } = await loadController()
    try {
      assert.ok(executeAcpTool)

      debugStateStore.reset()
      debugStateStore.setActive({ id: "debug-session-5", name: "WebGUI: dev", type: "node" })
      debugStateStore.onDapMessage("debug-session-5", {
        type: "event",
        event: "stopped",
        body: { threadId: 1, reason: "breakpoint" },
      })

      const deep = JSON.parse(
        ((await executeAcpTool("debug", "getVariables", { variablesReference: 700 })) as { output: string }).output,
      )
      assert.strictEqual(deep.truncated, true)
      assert.strictEqual(deep.variables[0].children[0].children[0].children[0].truncated, true)
      assert.ok(!customRequest.calledWithMatch("variables", { variablesReference: 704 }))

      const exact = JSON.parse(
        ((await executeAcpTool("debug", "getVariables", { variablesReference: 710 })) as { output: string }).output,
      )
      assert.strictEqual(exact.variables.length, 200)
      assert.strictEqual(exact.truncated, true)
    } finally {
      debugStateStore.reset()
      controller.dispose()
    }
  })

  test("executeAcpTool allThreadsStopped 线程解析与部分暂停会话的 pause", async () => {
    const customRequest = sinon.stub().callsFake(async (command: string) => {
      if (command === "threads") {
        return {
          threads: [
            { id: 7, name: "main" },
            { id: 8, name: "worker" },
          ],
        }
      }
      if (command === "stackTrace") {
        return { stackFrames: [{ id: 21, name: "main", source: { path: "D:/proj/main.ts" }, line: 2, column: 1 }] }
      }
      return {}
    })
    const fakeSession = {
      id: "debug-session-6",
      name: "WebGUI: dev",
      type: "node",
      configuration: { type: "node", name: "WebGUI: dev", request: "launch" },
      workspaceFolder: vscode.workspace.workspaceFolders?.[0],
      customRequest,
    } as unknown as vscode.DebugSession
    sinon.stub(vscode.debug, "activeDebugSession").get(() => fakeSession)

    const { controller, executeAcpTool } = await loadController()
    try {
      assert.ok(executeAcpTool)

      // allThreadsStopped 且带 threadId：直接使用该线程
      debugStateStore.reset()
      debugStateStore.setActive({ id: "debug-session-6", name: "WebGUI: dev", type: "node" })
      debugStateStore.onDapMessage("debug-session-6", {
        type: "event",
        event: "stopped",
        body: { threadId: 9, reason: "exception", allThreadsStopped: true },
      })
      const withThread = JSON.parse(
        ((await executeAcpTool("debug", "getCallStack", {})) as { output: string }).output,
      )
      assert.deepStrictEqual(withThread, [{ id: 21, name: "main", source: "D:/proj/main.ts", line: 2, column: 1 }])
      assert.ok(customRequest.calledWithMatch("stackTrace", { threadId: 9 }))

      // allThreadsStopped 且缺少 threadId：回退到 DAP threads 的首个线程，且保留暂停原因元数据
      debugStateStore.reset()
      debugStateStore.setActive({ id: "debug-session-6", name: "WebGUI: dev", type: "node" })
      debugStateStore.onDapMessage("debug-session-6", {
        type: "event",
        event: "stopped",
        body: { reason: "exception", allThreadsStopped: true },
      })
      const globalState = JSON.parse(
        ((await executeAcpTool("debug", "getDebugState", {})) as { output: string }).output,
      )
      assert.deepStrictEqual(globalState.pausedThreads, [])
      assert.strictEqual(globalState.allThreadsStopped, true)
      assert.strictEqual(globalState.lastStopped.reason, "exception")
      await executeAcpTool("debug", "getCallStack", {})
      assert.ok(customRequest.calledWithMatch("stackTrace", { threadId: 7 }))

      // 部分暂停：仅线程 2 暂停时，可暂停运行中的其它线程；显式指定已暂停线程会被拒绝
      debugStateStore.reset()
      debugStateStore.setActive({ id: "debug-session-6", name: "WebGUI: dev", type: "node" })
      debugStateStore.onDapMessage("debug-session-6", {
        type: "event",
        event: "stopped",
        body: { threadId: 2, reason: "breakpoint" },
      })
      await executeAcpTool("debug", "controlExecution", { action: "pause" })
      assert.ok(customRequest.calledWithMatch("pause", { threadId: 7 }))
      await assert.rejects(
        () => executeAcpTool("debug", "controlExecution", { action: "pause", threadId: 2 }),
        /already paused/,
      )

      // 全局暂停（allThreadsStopped，无 threadId）：pause 一律拒绝，任意线程可读
      debugStateStore.reset()
      debugStateStore.setActive({ id: "debug-session-6", name: "WebGUI: dev", type: "node" })
      debugStateStore.onDapMessage("debug-session-6", {
        type: "event",
        event: "stopped",
        body: { reason: "exception", allThreadsStopped: true },
      })
      await assert.rejects(() => executeAcpTool("debug", "controlExecution", { action: "pause" }), /already paused/)
      await assert.rejects(
        () => executeAcpTool("debug", "controlExecution", { action: "pause", threadId: 8 }),
        /already paused/,
      )
      await executeAcpTool("debug", "getCallStack", { threadId: 8 })
      assert.ok(customRequest.calledWithMatch("stackTrace", { threadId: 8 }))

      // 全局暂停下继续执行后，即使没有 continued 事件，读取与控制也必须被拒绝
      await executeAcpTool("debug", "controlExecution", { action: "continue" })
      assert.ok(customRequest.calledWithMatch("continue", { threadId: 7, singleThread: true }))
      assert.strictEqual(debugStateStore.isGloballyPaused("debug-session-6"), false)
      await assert.rejects(() => executeAcpTool("debug", "getCallStack", {}), /not paused/)
      await assert.rejects(() => executeAcpTool("debug", "evaluate", { expression: "x" }), /not paused/)
    } finally {
      debugStateStore.reset()
      controller.dispose()
    }
  })

  test("executeAcpTool 全局暂停下单线程恢复保留其它线程", async () => {
    const customRequest = sinon.stub().callsFake(async (command: string) => {
      if (command === "threads") {
        return {
          threads: [
            { id: 7, name: "main" },
            { id: 8, name: "worker" },
            { id: 9, name: "io" },
          ],
        }
      }
      if (command === "stackTrace") {
        return {
          stackFrames: [{ id: 31, name: "worker", source: { path: "D:/proj/worker.ts" }, line: 4, column: 1 }],
        }
      }
      if (command === "continue") {
        return { allThreadsContinued: false }
      }
      return {}
    })
    const fakeSession = {
      id: "debug-session-7",
      name: "WebGUI: dev",
      type: "node",
      configuration: { type: "node", name: "WebGUI: dev", request: "launch" },
      workspaceFolder: vscode.workspace.workspaceFolders?.[0],
      customRequest,
    } as unknown as vscode.DebugSession
    sinon.stub(vscode.debug, "activeDebugSession").get(() => fakeSession)

    const { controller, executeAcpTool } = await loadController()
    try {
      assert.ok(executeAcpTool)

      debugStateStore.reset()
      debugStateStore.setActive({ id: "debug-session-7", name: "WebGUI: dev", type: "node" })
      debugStateStore.onDapMessage("debug-session-7", {
        type: "response",
        command: "initialize",
        success: true,
        body: { supportsSingleThreadExecutionRequests: true },
      })
      debugStateStore.onDapMessage("debug-session-7", {
        type: "event",
        event: "stopped",
        body: { reason: "exception", threadId: 9, allThreadsStopped: true },
      })

      await executeAcpTool("debug", "controlExecution", { action: "continue", threadId: 9 })
      assert.ok(customRequest.calledWithMatch("continue", { threadId: 9, singleThread: true }))
      assert.strictEqual(debugStateStore.isGloballyPaused("debug-session-7"), false)
      assert.deepStrictEqual(
        debugStateStore.pausedThreads("debug-session-7").map((thread) => thread.threadId),
        [7, 8],
      )

      // 其余仍暂停的线程保持可读
      await executeAcpTool("debug", "getCallStack", { threadId: 8 })
      assert.ok(customRequest.calledWithMatch("stackTrace", { threadId: 8 }))
    } finally {
      debugStateStore.reset()
      controller.dispose()
    }
  })

  test("executeAcpTool 适配器不支持单线程执行时步进清理全部缓存", async () => {
    const customRequest = sinon.stub().resolves({})
    const fakeSession = {
      id: "debug-session-8",
      name: "WebGUI: dev",
      type: "node",
      configuration: { type: "node", name: "WebGUI: dev", request: "launch" },
      workspaceFolder: vscode.workspace.workspaceFolders?.[0],
      customRequest,
    } as unknown as vscode.DebugSession
    sinon.stub(vscode.debug, "activeDebugSession").get(() => fakeSession)

    const { controller, executeAcpTool } = await loadController()
    try {
      assert.ok(executeAcpTool)

      debugStateStore.reset()
      debugStateStore.setActive({ id: "debug-session-8", name: "WebGUI: dev", type: "node" })
      debugStateStore.onDapMessage("debug-session-8", {
        type: "event",
        event: "stopped",
        body: { reason: "breakpoint", threadId: 5 },
      })

      await executeAcpTool("debug", "controlExecution", { action: "stepOver" })
      assert.ok(customRequest.calledWithMatch("next", { threadId: 5, singleThread: true }))
      assert.deepStrictEqual(debugStateStore.pausedThreads("debug-session-8"), [])
      await assert.rejects(() => executeAcpTool("debug", "getCallStack", {}), /not paused/)
    } finally {
      debugStateStore.reset()
      controller.dispose()
    }
  })

  test("executeAcpTool 支持单线程执行时步进仅失效目标线程", async () => {
    const customRequest = sinon.stub().callsFake(async (command: string) => {
      if (command === "threads") {
        return {
          threads: [
            { id: 7, name: "main" },
            { id: 8, name: "worker" },
            { id: 9, name: "io" },
          ],
        }
      }
      if (command === "stackTrace") {
        return { stackFrames: [{ id: 41, name: "io", source: { path: "D:/proj/io.ts" }, line: 6, column: 1 }] }
      }
      return {}
    })
    const fakeSession = {
      id: "debug-session-9",
      name: "WebGUI: dev",
      type: "node",
      configuration: { type: "node", name: "WebGUI: dev", request: "launch" },
      workspaceFolder: vscode.workspace.workspaceFolders?.[0],
      customRequest,
    } as unknown as vscode.DebugSession
    sinon.stub(vscode.debug, "activeDebugSession").get(() => fakeSession)

    const { controller, executeAcpTool } = await loadController()
    try {
      assert.ok(executeAcpTool)

      debugStateStore.reset()
      debugStateStore.setActive({ id: "debug-session-9", name: "WebGUI: dev", type: "node" })
      debugStateStore.onDapMessage("debug-session-9", {
        type: "response",
        command: "initialize",
        success: true,
        body: { supportsSingleThreadExecutionRequests: true },
      })
      debugStateStore.onDapMessage("debug-session-9", {
        type: "event",
        event: "stopped",
        body: { reason: "exception", threadId: 9, allThreadsStopped: true },
      })

      await executeAcpTool("debug", "controlExecution", { action: "stepOver", threadId: 9 })
      assert.ok(customRequest.calledWithMatch("next", { threadId: 9, singleThread: true }))
      assert.strictEqual(debugStateStore.isGloballyPaused("debug-session-9"), false)
      assert.deepStrictEqual(
        debugStateStore.pausedThreads("debug-session-9").map((thread) => thread.threadId),
        [7, 8],
      )
      await executeAcpTool("debug", "getCallStack", { threadId: 8 })
      assert.ok(customRequest.calledWithMatch("stackTrace", { threadId: 8 }))
    } finally {
      debugStateStore.reset()
      controller.dispose()
    }
  })

  test("executeAcpTool 控制成功后线程列表查询失败时保守清理且不报错", async () => {
    const customRequest = sinon.stub().callsFake(async (command: string) => {
      if (command === "continue") {
        return { allThreadsContinued: false }
      }
      if (command === "threads") {
        throw new Error("threads unavailable")
      }
      return {}
    })
    const fakeSession = {
      id: "debug-session-10",
      name: "WebGUI: dev",
      type: "node",
      configuration: { type: "node", name: "WebGUI: dev", request: "launch" },
      workspaceFolder: vscode.workspace.workspaceFolders?.[0],
      customRequest,
    } as unknown as vscode.DebugSession
    sinon.stub(vscode.debug, "activeDebugSession").get(() => fakeSession)

    const { controller, executeAcpTool } = await loadController()
    try {
      assert.ok(executeAcpTool)

      debugStateStore.reset()
      debugStateStore.setActive({ id: "debug-session-10", name: "WebGUI: dev", type: "node" })
      debugStateStore.onDapMessage("debug-session-10", {
        type: "response",
        command: "initialize",
        success: true,
        body: { supportsSingleThreadExecutionRequests: true },
      })
      debugStateStore.onDapMessage("debug-session-10", {
        type: "event",
        event: "stopped",
        body: { reason: "exception", threadId: 9, allThreadsStopped: true },
      })

      const result = (await executeAcpTool("debug", "controlExecution", {
        action: "continue",
        threadId: 9,
      })) as { output: string }
      assert.match(result.output, /Execution command "continue"/)
      assert.strictEqual(debugStateStore.isGloballyPaused("debug-session-10"), false)
      assert.deepStrictEqual(debugStateStore.pausedThreads("debug-session-10"), [])
      await assert.rejects(() => executeAcpTool("debug", "getCallStack", {}), /not paused/)
    } finally {
      debugStateStore.reset()
      controller.dispose()
    }
  })

  test("executeAcpTool 独立单线程 continued 后其余线程仍可读取", async () => {
    const customRequest = sinon.stub().callsFake(async (command: string) => {
      if (command === "threads") {
        return {
          threads: [
            { id: 7, name: "main" },
            { id: 8, name: "worker" },
            { id: 9, name: "io" },
          ],
        }
      }
      if (command === "stackTrace") {
        return {
          stackFrames: [{ id: 51, name: "worker", source: { path: "D:/proj/worker.ts" }, line: 8, column: 1 }],
        }
      }
      return {}
    })
    const fakeSession = {
      id: "debug-session-11",
      name: "WebGUI: dev",
      type: "node",
      configuration: { type: "node", name: "WebGUI: dev", request: "launch" },
      workspaceFolder: vscode.workspace.workspaceFolders?.[0],
      customRequest,
    } as unknown as vscode.DebugSession
    sinon.stub(vscode.debug, "activeDebugSession").get(() => fakeSession)

    const { controller, executeAcpTool } = await loadController()
    try {
      assert.ok(executeAcpTool)

      debugStateStore.reset()
      debugStateStore.setActive({ id: "debug-session-11", name: "WebGUI: dev", type: "node" })
      debugStateStore.onDapMessage("debug-session-11", {
        type: "response",
        command: "threads",
        success: true,
        body: {
          threads: [
            { id: 7, name: "main" },
            { id: 8, name: "worker" },
            { id: 9, name: "io" },
          ],
        },
      })
      debugStateStore.onDapMessage("debug-session-11", {
        type: "event",
        event: "stopped",
        body: { reason: "exception", allThreadsStopped: true },
      })
      debugStateStore.onDapMessage("debug-session-11", {
        type: "event",
        event: "continued",
        body: { threadId: 9, allThreadsContinued: false },
      })
      assert.deepStrictEqual(
        debugStateStore.pausedThreads("debug-session-11").map((thread) => thread.threadId),
        [7, 8],
      )

      await executeAcpTool("debug", "getCallStack", { threadId: 8 })
      assert.ok(customRequest.calledWithMatch("stackTrace", { threadId: 8 }))
    } finally {
      debugStateStore.reset()
      controller.dispose()
    }
  })

  test("executeAcpTool 在调试 API 不可用时返回明确错误", async () => {
    sinon.stub(vscode.debug, "startDebugging").value(undefined)

    const { controller, executeAcpTool } = await loadController()
    try {
      assert.ok(executeAcpTool)
      await assert.rejects(
        () => executeAcpTool("debug", "getDebugState", {}),
        /vscode.debug API is not available/,
      )
    } finally {
      controller.dispose()
    }
  })

  test("executeAcpTool startDebugging 透传配置名并处理启动失败", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]
    assert.ok(workspaceFolder)
    const startDebugging = sinon.stub(vscode.debug, "startDebugging").resolves(true)

    const { controller, executeAcpTool } = await loadController()
    try {
      assert.ok(executeAcpTool)
      const started = (await executeAcpTool("debug", "startDebugging", { name: "WebGUI: dev" })) as {
        output: string
      }
      assert.deepStrictEqual(startDebugging.firstCall.args, [workspaceFolder, "WebGUI: dev"])
      assert.strictEqual(started.output, `Debug configuration "WebGUI: dev" started`)

      startDebugging.resolves(false)
      await assert.rejects(
        () => executeAcpTool("debug", "startDebugging", { name: "WebGUI: dev" }),
        /Failed to start debug configuration/,
      )
    } finally {
      controller.dispose()
    }
  })
})
