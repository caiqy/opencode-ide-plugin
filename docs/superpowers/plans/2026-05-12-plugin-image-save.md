# Plugin Image Save Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复图片预览弹层“保存”按钮，让它在 VSCode 插件与 JetBrains 插件中通过宿主保存能力真正写出图片文件，同时保持网页版现有下载行为不退化。

**Architecture:** WebGUI 新增统一的图片保存入口：浏览器环境继续使用现有 `downloadUrl()`，安装了 `ideBridge` 的插件环境则改走新的 `saveImage` bridge 请求。VSCode 通过 `IdeBridgeServer` + `WebviewController` 注入宿主保存 handler，JetBrains 通过 `IdeBridge.kt` 新增 `saveImage` 请求分支，并把 data URL / 普通 URL 两类输入统一落到“获取字节 -> 让用户选择路径 -> 写文件”的宿主流程。

**Tech Stack:** TypeScript、Vitest、Mocha、VSCode Extension API、Kotlin、JUnit 5、Bun、Gradle

---

### Task 1: 先写 WebGUI 保存分流失败测试

**Files:**

- Modify: `packages/opencode/webgui/src/lib/fileUtils.test.ts`
- Modify: `packages/opencode/webgui/src/components/parts/ImageOverlay.test.tsx`
- Reference: `packages/opencode/webgui/src/lib/fileUtils.ts`
- Reference: `packages/opencode/webgui/src/lib/ideBridge.ts`

- [ ] **Step 1: 在 `fileUtils.test.ts` 中增加插件环境优先走 bridge 的失败测试**

```ts
import { ideBridge } from "./ideBridge"

vi.mock("./ideBridge", () => ({
  ideBridge: {
    isInstalled: vi.fn(() => false),
    request: vi.fn(),
  },
}))

it("安装 ideBridge 时优先请求宿主保存而不是直接点击下载", async () => {
  vi.mocked(ideBridge.isInstalled).mockReturnValue(true)
  vi.mocked(ideBridge.request).mockResolvedValue({ ok: true })

  await fileUtils.saveImage("http://127.0.0.1:4300/generated-image?path=x.png", "cat.png")

  expect(ideBridge.request).toHaveBeenCalledWith("saveImage", {
    url: "http://127.0.0.1:4300/generated-image?path=x.png",
    filename: "cat.png",
  })
  expect(click).not.toHaveBeenCalled()
})

it("未安装 ideBridge 时回退到浏览器下载", async () => {
  vi.mocked(ideBridge.isInstalled).mockReturnValue(false)

  await fileUtils.saveImage("https://example.com/image.png", "cat.png")

  expect(click).toHaveBeenCalledTimes(1)
})
```

- [ ] **Step 2: 在 `ImageOverlay.test.tsx` 中把保存按钮断言改成新的统一保存入口**

```ts
import { saveImage } from "../../lib/fileUtils"

vi.mock("../../lib/fileUtils", async () => {
  const actual = await vi.importActual<typeof import("../../lib/fileUtils")>("../../lib/fileUtils")
  return {
    ...actual,
    saveImage: vi.fn(),
  }
})

it("点击保存调用 saveImage", () => {
  render(<ImageOverlay url="https://example.com/image.png" alt="sample.png" onClose={() => {}} />)

  fireEvent.click(screen.getByRole("button", { name: "保存图片" }))

  expect(saveImage).toHaveBeenCalledWith("https://example.com/image.png", "sample.png")
})
```

- [ ] **Step 3: 运行前端测试，确认当前实现先红灯**

Run:

```bash
bun run test:run src/lib/fileUtils.test.ts src/components/parts/ImageOverlay.test.tsx
```

Workdir: `D:\Caiqy\Projects\Github\opencode-ide-plugin\packages\opencode\webgui`

Expected: FAIL；因为当前 `fileUtils.ts` 只有 `downloadUrl()`，没有新的 `saveImage()` 分流入口，`ImageOverlay.tsx` 也还在直接调用 `downloadUrl()`。

### Task 2: 实现 WebGUI 统一保存入口

**Files:**

- Modify: `packages/opencode/webgui/src/lib/fileUtils.ts`
- Modify: `packages/opencode/webgui/src/components/parts/ImageOverlay.tsx`
- Test: `packages/opencode/webgui/src/lib/fileUtils.test.ts`
- Test: `packages/opencode/webgui/src/components/parts/ImageOverlay.test.tsx`

- [ ] **Step 1: 在 `fileUtils.ts` 中新增 `saveImage()`，浏览器与插件分流**

在 `packages/opencode/webgui/src/lib/fileUtils.ts` 中新增：

```ts
import { ideBridge } from "./ideBridge"

export async function saveImage(url: string, filename: string): Promise<void> {
  if (!ideBridge.isInstalled()) {
    downloadUrl(url, filename)
    return
  }

  await ideBridge.request("saveImage", {
    url,
    filename: sanitizeFilename(filename),
  })
}
```

保留现有 `downloadUrl()` 不动，作为浏览器 fallback。

- [ ] **Step 2: 在 `ImageOverlay.tsx` 中改为调用 `saveImage()`**

把顶部导入与按钮点击改成：

```ts
import { saveImage } from "../../lib/fileUtils"

// ...
onClick={() => {
  void saveImage(url, alt)
}}
```

- [ ] **Step 3: 运行前端测试，确认转绿**

Run:

```bash
bun run test:run src/lib/fileUtils.test.ts src/components/parts/ImageOverlay.test.tsx
```

Workdir: `D:\Caiqy\Projects\Github\opencode-ide-plugin\packages\opencode\webgui`

Expected: PASS；保存按钮在测试中改为调用 `saveImage()`，且 `saveImage()` 会根据 `ideBridge.isInstalled()` 做正确分流。

- [ ] **Step 4: 提交 WebGUI 分流改动**

```bash
git add packages/opencode/webgui/src/lib/fileUtils.ts packages/opencode/webgui/src/lib/fileUtils.test.ts packages/opencode/webgui/src/components/parts/ImageOverlay.tsx packages/opencode/webgui/src/components/parts/ImageOverlay.test.tsx
git commit -m "fix: route plugin image saves through ide bridge"
```

### Task 3: 先写 VSCode bridge saveImage 失败测试

**Files:**

- Modify: `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts`
- Reference: `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`

- [ ] **Step 1: 在 `IdeBridgeServer` 测试中增加 saveImage 路由失败测试**

在 `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts` 增加一个新 suite，核心断言如下：

```ts
suite("IdeBridgeServer saveImage", () => {
  let baseUrl: string
  let token: string
  let sessionId: string
  let calls: Array<{ url: string; filename: string }>

  setup(async () => {
    calls = []
    const session = await bridgeServer.createSession({
      openFile: async () => {},
      openUrl: async () => {},
      reloadPath: async () => {},
      clipboardWrite: async () => {},
      saveImage: async (url, filename) => {
        calls.push({ url, filename })
      },
    })
    baseUrl = session.baseUrl
    token = session.token
    sessionId = session.sessionId
  })

  teardown(() => {
    bridgeServer.removeSession(sessionId)
  })

  test("routes saveImage request to session handler", async () => {
    const res = await requestRoundtrip(baseUrl, token, {
      type: "saveImage",
      payload: { url: "data:image/png;base64,AAAA", filename: "cat.png" },
    })

    assert.strictEqual(res.reply.ok, true)
    assert.deepStrictEqual(calls, [{ url: "data:image/png;base64,AAAA", filename: "cat.png" }])
  })
})
```

- [ ] **Step 2: 运行 VSCode 测试，确认当前实现失败**

Run:

```bash
pnpm run compile:production
node ./out/test/runTest.js
```

Workdir: `D:\Caiqy\Projects\Github\opencode-ide-plugin\hosts\vscode-plugin`

Expected: FAIL；当前 `SessionHandlers` 没有 `saveImage`，`handleSend()` 也不识别 `saveImage` 请求。

### Task 4: 实现 VSCode 的 saveImage bridge 与宿主保存

**Files:**

- Modify: `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
- Modify: `hosts/vscode-plugin/src/ui/WebviewController.ts`
- Modify: `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts`
- Modify: `hosts/vscode-plugin/src/test/suite/webviewController.test.ts`

- [ ] **Step 1: 给 `IdeBridgeServer` 增加 `saveImage` handler 类型与请求分支**

在 `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts` 中追加：

```ts
export interface SessionHandlers {
  openFile: (path: string) => Promise<void>
  openUrl: (url: string) => Promise<void>
  reloadPath: (path: string) => Promise<void>
  clipboardWrite: (text: string) => Promise<void>
  saveImage?: (url: string, filename: string) => Promise<void>
  // ...existing fields
}
```

并在 `handleSend()` 中新增：

```ts
case "saveImage":
  if (!session.handlers.saveImage) {
    this.replyError(session, id, "saveImage not supported")
  } else if (typeof payload?.url === "string" && typeof payload?.filename === "string") {
    await session.handlers.saveImage(payload.url, payload.filename)
    this.replyOk(session, id)
  } else {
    this.replyError(session, id, "Missing url or filename")
  }
  break
```

- [ ] **Step 2: 在 `WebviewController` 的 `createSession()` handlers 中实现 VSCode 保存逻辑**

在 `hosts/vscode-plugin/src/ui/WebviewController.ts` 的 `bridgeServer.createSession({ ... })` 中加入：

```ts
saveImage: async (url, filename) => {
  const target = await vscode.window.showSaveDialog({
    saveLabel: "保存图片",
    defaultUri: vscode.Uri.file(filename),
  })
  if (!target) return

  const bytes = url.startsWith("data:")
    ? Buffer.from(url.slice(url.indexOf(",") + 1), "base64")
    : Buffer.from(await (await fetch(url)).arrayBuffer())

  await vscode.workspace.fs.writeFile(target, bytes)
}
```

实现时需要把 data URL 解析写得更稳健：

- 校验逗号位置
- 校验 `;base64`
- 非法 data URL 抛出明确错误

- [ ] **Step 3: 在 `webviewController.test.ts` 中补宿主保存成功路径测试**

测试应 stub：

```ts
sinon.stub(vscode.window, "showSaveDialog").resolves(vscode.Uri.file("D:/tmp/cat.png"))
sinon.stub(vscode.workspace.fs, "writeFile").resolves()
sinon.stub(globalThis, "fetch" as any).resolves({
  arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
})
```

并断言 `createSession()` 注入的 `saveImage` handler 被调用后，会写入 `cat.png`。

- [ ] **Step 4: 运行 VSCode 编译与相关测试，确认转绿**

Run:

```bash
pnpm run compile:production
node ./out/test/runTest.js
```

Workdir: `D:\Caiqy\Projects\Github\opencode-ide-plugin\hosts\vscode-plugin`

Expected: PASS；`saveImage` 请求会被 `IdeBridgeServer` 正确路由，宿主保存逻辑会调用 `showSaveDialog()` 与 `workspace.fs.writeFile()`。

- [ ] **Step 5: 提交 VSCode 修复**

```bash
git add hosts/vscode-plugin/src/ui/IdeBridgeServer.ts hosts/vscode-plugin/src/ui/WebviewController.ts hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts hosts/vscode-plugin/src/test/suite/webviewController.test.ts
git commit -m "fix: support image save in vscode bridge"
```

### Task 5: 先写 JetBrains saveImage 失败测试

**Files:**

- Modify: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`
- Reference: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`

- [ ] **Step 1: 在 `IdeBridgeUpdateTest.kt` 中增加 saveImage 请求的失败测试**

新增一个测试，请求 bridge：

```kotlin
@Test
fun `saveImage unsupported before implementation returns bridge error`() {
    val session = IdeBridge.createSession(project = project())

    sse(session).use { events ->
        val payload = JsonObject().apply {
            addProperty("url", "data:image/png;base64,AAAA")
            addProperty("filename", "cat.png")
        }

        val reply = events.send("saveImage", payload)

        assertEquals(false, reply.get("ok")?.asBoolean)
    }
}
```

当前如果实现尚未接入，测试会失败或返回 `unsupported message type`，这就是预期红灯。

- [ ] **Step 2: 运行 JetBrains 单测，确认当前实现失败**

Run:

```bash
./gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeUpdateTest" --no-daemon --console=plain
```

Workdir: `D:\Caiqy\Projects\Github\opencode-ide-plugin\hosts\jetbrains-plugin`

Expected: FAIL；当前 `IdeBridge.kt` 还不支持 `saveImage`。

### Task 6: 实现 JetBrains saveImage bridge

**Files:**

- Modify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`
- Modify: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt`

- [ ] **Step 1: 在 `IdeBridge.kt` 中加入 `saveImage` 分支和可测试辅助函数**

把实现拆成两部分：

1. `handleSend()` 里的 `saveImage` case
2. 顶层或 `private` 辅助函数：
   - `decodeDataUrlBytes(url: String): ByteArray`
   - `readImageBytes(url: String): ByteArray`

`saveImage` case 的最小结构：

```kotlin
"saveImage" -> {
    val url = payload?.get("url")?.asString
    val filename = payload?.get("filename")?.asString
    if (url.isNullOrBlank() || filename.isNullOrBlank()) {
        replyError(session, id, "Missing url or filename")
    } else {
        try {
            val bytes = readImageBytes(url)
            val target = chooseSaveTarget(session.project, filename)
            if (target == null) {
                replyOk(session, id)
            } else {
                target.writeBytes(bytes)
                replyOk(session, id)
            }
        } catch (e: Exception) {
            replyError(session, id, "saveImage failed: ${e.message ?: e}")
        }
    }
}
```

其中 `chooseSaveTarget(...)` 允许实现为可替换 hook，以便单测绕开真实 UI 对话框。

- [ ] **Step 2: 在 `IdeBridgeUpdateTest.kt` 中增加 data URL 保存成功测试**

测试思路：

```kotlin
@Test
fun `saveImage writes decoded data url bytes to chosen file`() {
    val tmp = kotlin.io.path.createTempFile(prefix = "opencode-save-", suffix = ".png").toFile()
    tmp.delete()

    IdeBridge.saveImageTargetHook = { _, _ -> tmp }

    val session = IdeBridge.createSession(project = project())

    sse(session).use { events ->
        val payload = JsonObject().apply {
            addProperty("url", "data:image/png;base64,aGVsbG8=")
            addProperty("filename", "cat.png")
        }

        val reply = events.send("saveImage", payload)

        assertEquals(true, reply.get("ok")?.asBoolean)
        assertEquals("hello", tmp.readText())
    }
}
```

测试结束后记得清理 hook 和临时文件。

- [ ] **Step 3: 运行 JetBrains 单测，确认转绿**

Run:

```bash
./gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeUpdateTest" --no-daemon --console=plain
```

Workdir: `D:\Caiqy\Projects\Github\opencode-ide-plugin\hosts\jetbrains-plugin`

Expected: PASS；`saveImage` 请求可以解析 data URL，并把字节写入测试指定文件。

- [ ] **Step 4: 提交 JetBrains 修复**

```bash
git add hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeUpdateTest.kt
git commit -m "fix: support image save in jetbrains bridge"
```

### Task 7: 整体验证与回归

**Files:**

- Verify: `packages/opencode/webgui/src/lib/fileUtils.ts`
- Verify: `packages/opencode/webgui/src/components/parts/ImageOverlay.tsx`
- Verify: `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
- Verify: `hosts/vscode-plugin/src/ui/WebviewController.ts`
- Verify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`

- [ ] **Step 1: 运行 WebGUI 相关测试**

Run:

```bash
bun run test:run src/lib/fileUtils.test.ts src/components/parts/ImageOverlay.test.tsx src/components/parts/ToolPart/ToolImageAttachments.test.tsx src/components/parts/ToolPart/index.test.tsx
```

Workdir: `D:\Caiqy\Projects\Github\opencode-ide-plugin\packages\opencode\webgui`

Expected: PASS

- [ ] **Step 2: 运行 VSCode 相关编译与测试**

Run:

```bash
pnpm run compile:production
node ./out/test/runTest.js
```

Workdir: `D:\Caiqy\Projects\Github\opencode-ide-plugin\hosts\vscode-plugin`

Expected: 编译通过，新增 `saveImage` 测试通过。

- [ ] **Step 3: 运行 JetBrains 单元测试**

Run:

```bash
./gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeUpdateTest" --no-daemon --console=plain
```

Workdir: `D:\Caiqy\Projects\Github\opencode-ide-plugin\hosts\jetbrains-plugin`

Expected: PASS

- [ ] **Step 4: 手动验证结论**

手动验证清单：

```text
1. 浏览器网页版：保存按钮仍能触发下载
2. VSCode 插件：点击保存会弹出保存对话框，并能写出图片
3. JetBrains 插件：点击保存会弹出保存对话框，并能写出图片
4. generated-image URL 与 data URL 至少各验证一条
```

- [ ] **Step 5: 提交最终整体验证结果**

```bash
git status
```

Expected: 只剩本次预期改动；准备进入代码评审或后续提交流程。
