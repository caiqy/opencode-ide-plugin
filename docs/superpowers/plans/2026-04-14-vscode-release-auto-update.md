# VSCode Release 自动更新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为当前项目的 VSCode 插件增加 GitHub Release 自动检查、WebGUI 更新提示、以及一键下载并安装 `.vsix` 的完整流程。

**Architecture:** 后台更新能力放在 `hosts/vscode-plugin/`：由 `UpdateService` 定时轮询 GitHub Release，`ReleaseChecker` 负责解析版本与 `.vsix` 资源，`UpdateInstaller` 负责下载与调用 VSCode 安装命令。WebGUI 只通过 `IdeBridge` 接收 `updateAvailable` / `updateState` 推送并发起 `installUpdate` / `getUpdateInfo` 请求，保持现有 WebGUI 与扩展宿主的职责边界不变。

**Tech Stack:** TypeScript、VSCode Extension API、Node.js fetch/fs/os/path、Mocha（VSCode 测试）、React 19、Vitest、现有 IdeBridge SSE/HTTP 通信

---

## 文件结构

### VSCode 插件新增文件

- Create: `hosts/vscode-plugin/src/update/version.ts`
  - 负责版本规范化、比较、tag 清洗
- Create: `hosts/vscode-plugin/src/update/ReleaseChecker.ts`
  - 负责请求 GitHub Release API、选择 `.vsix` 资源、返回结构化 `ReleaseInfo`
- Create: `hosts/vscode-plugin/src/update/UpdateInstaller.ts`
  - 负责下载 `.vsix` 到临时目录并调用 `workbench.extensions.installExtension`
- Create: `hosts/vscode-plugin/src/update/UpdateService.ts`
  - 负责轮询、状态缓存、session 广播、处理安装请求
- Create: `hosts/vscode-plugin/src/test/suite/releaseChecker.test.ts`
  - 负责 `ReleaseChecker` 与版本比较测试
- Create: `hosts/vscode-plugin/src/test/suite/updateInstaller.test.ts`
  - 负责下载与安装流程测试
- Create: `hosts/vscode-plugin/src/test/suite/updateService.test.ts`
  - 负责状态流转、去重、失败处理测试

### VSCode 插件修改文件

- Modify: `hosts/vscode-plugin/src/extension.ts`
  - 初始化 `UpdateService` 并在 dispose 时清理定时器
- Modify: `hosts/vscode-plugin/src/ui/WebviewController.ts`
  - 创建 bridge session 时注入 `installUpdate` / `getUpdateInfo` handler，并在 session 建立后登记到 `UpdateService`
- Modify: `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
  - 扩展 `SessionHandlers` 并处理新消息类型
- Modify: `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts`
  - 覆盖 `installUpdate` / `getUpdateInfo` roundtrip

### WebGUI 新增文件

- Create: `packages/opencode/webgui/src/state/UpdateContext.tsx`
  - 负责订阅 IdeBridge 更新消息、维护 UI 状态、暴露动作方法
- Create: `packages/opencode/webgui/src/state/UpdateContext.test.tsx`
  - 负责上下文初始化、消息同步、请求动作测试
- Create: `packages/opencode/webgui/src/components/UpdateBanner.tsx`
  - 负责渲染更新提示条和状态按钮
- Create: `packages/opencode/webgui/src/components/UpdateBanner.test.tsx`
  - 负责展示与交互测试

### WebGUI 修改文件

- Modify: `packages/opencode/webgui/src/main.tsx`
  - 注册 `UpdateProvider`
- Modify: `packages/opencode/webgui/src/App.tsx`
  - 在 `CompactHeader` 与 `OfflineBanner` 之间挂载 `UpdateBanner`

---

### Task 1: 实现版本解析与 ReleaseChecker

**Files:**

- Create: `hosts/vscode-plugin/src/update/version.ts`
- Create: `hosts/vscode-plugin/src/update/ReleaseChecker.ts`
- Create: `hosts/vscode-plugin/src/test/suite/releaseChecker.test.ts`

- [ ] **Step 1: 先写失败测试，锁定版本比较与 `.vsix` 选择规则**

```ts
import * as assert from "assert"
import { compareVersion, normalizeVersion, pickVsixAsset, parseLatestRelease } from "../../update/ReleaseChecker"

suite("ReleaseChecker Test Suite", () => {
  test("normalizeVersion 会去掉 v 前缀", () => {
    assert.strictEqual(normalizeVersion("v26.4.1401"), "26.4.1401")
  })

  test("compareVersion 会按数字段比较", () => {
    assert.ok(compareVersion("26.4.1401", "26.4.1400") > 0)
    assert.ok(compareVersion("26.4.1400", "26.4.1401") < 0)
    assert.strictEqual(compareVersion("26.4.1401", "26.4.1401"), 0)
  })

  test("pickVsixAsset 优先匹配 opencode-vscode-*.vsix", () => {
    const asset = pickVsixAsset([
      { name: "notes.txt", browser_download_url: "https://example.test/notes.txt" },
      { name: "opencode-vscode-win-amd64-26.4.1401.vsix", browser_download_url: "https://example.test/a.vsix" },
    ])
    assert.strictEqual(asset?.browser_download_url, "https://example.test/a.vsix")
  })

  test("parseLatestRelease 提取版本与下载地址", () => {
    const info = parseLatestRelease({
      tag_name: "v26.4.1401",
      html_url: "https://github.com/qtkj/opencode-ui/releases/tag/v26.4.1401",
      body: "## changes",
      published_at: "2026-04-14T12:00:00Z",
      assets: [
        { name: "opencode-vscode-win-amd64-26.4.1401.vsix", browser_download_url: "https://example.test/a.vsix" },
      ],
    })

    assert.deepStrictEqual(info, {
      version: "26.4.1401",
      releaseUrl: "https://github.com/qtkj/opencode-ui/releases/tag/v26.4.1401",
      notes: "## changes",
      publishedAt: "2026-04-14T12:00:00Z",
      vsixUrl: "https://example.test/a.vsix",
    })
  })
})
```

- [ ] **Step 2: 运行测试，确认当前确实失败**

Run: `pnpm run compile && pnpm exec vscode-test --grep "ReleaseChecker Test Suite"`

Expected: FAIL，报错包含 `Cannot find module '../../update/ReleaseChecker'` 或缺少导出函数。

- [ ] **Step 3: 写最小实现，让测试通过**

`hosts/vscode-plugin/src/update/version.ts`

```ts
export function normalizeVersion(input: string): string {
  const value = input.trim().replace(/^v/i, "")
  if (!/^\d+(\.\d+)*$/.test(value)) {
    throw new Error(`Invalid version: ${input}`)
  }
  return value
}

export function compareVersion(left: string, right: string): number {
  const a = normalizeVersion(left).split(".").map(Number)
  const b = normalizeVersion(right).split(".").map(Number)
  const size = Math.max(a.length, b.length)
  for (let index = 0; index < size; index++) {
    const av = a[index] ?? 0
    const bv = b[index] ?? 0
    if (av === bv) continue
    return av > bv ? 1 : -1
  }
  return 0
}
```

`hosts/vscode-plugin/src/update/ReleaseChecker.ts`

```ts
import { compareVersion, normalizeVersion } from "./version"

type ReleaseAsset = {
  name: string
  browser_download_url: string
}

export type ReleaseInfo = {
  version: string
  releaseUrl: string
  notes?: string
  publishedAt?: string
  vsixUrl: string
}

export function pickVsixAsset(assets: ReleaseAsset[]): ReleaseAsset | null {
  const vsix = assets.filter((item) => item.name.endsWith(".vsix"))
  const preferred = vsix.find((item) => item.name.startsWith("opencode-vscode-"))
  if (preferred) return preferred
  if (vsix.length === 1) return vsix[0]
  return null
}

export function parseLatestRelease(input: {
  tag_name: string
  html_url: string
  body?: string
  published_at?: string
  assets?: ReleaseAsset[]
}): ReleaseInfo {
  const version = normalizeVersion(input.tag_name)
  const asset = pickVsixAsset(input.assets ?? [])
  if (!asset) {
    throw new Error("Latest release has no installable VSIX asset")
  }
  return {
    version,
    releaseUrl: input.html_url,
    notes: input.body,
    publishedAt: input.published_at,
    vsixUrl: asset.browser_download_url,
  }
}

export class ReleaseChecker {
  constructor(
    private readonly repo: { owner: string; name: string },
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async getLatest(currentVersion: string): Promise<ReleaseInfo | null> {
    const response = await this.fetcher(
      `https://api.github.com/repos/${this.repo.owner}/${this.repo.name}/releases/latest`,
      { headers: { Accept: "application/vnd.github+json" } },
    )
    if (!response.ok) {
      throw new Error(`GitHub release request failed: ${response.status}`)
    }
    const json = (await response.json()) as {
      tag_name: string
      html_url: string
      body?: string
      published_at?: string
      assets?: ReleaseAsset[]
    }
    const latest = parseLatestRelease(json)
    return compareVersion(latest.version, currentVersion) > 0 ? latest : null
  }
}

export { compareVersion, normalizeVersion }
```

- [ ] **Step 4: 重新运行测试，确认 Task 1 通过**

Run: `pnpm run compile && pnpm exec vscode-test --grep "ReleaseChecker Test Suite"`

Expected: PASS，`ReleaseChecker Test Suite` 全部通过。

- [ ] **Step 5: 提交 Task 1**

```bash
git add hosts/vscode-plugin/src/update/version.ts hosts/vscode-plugin/src/update/ReleaseChecker.ts hosts/vscode-plugin/src/test/suite/releaseChecker.test.ts
git commit -m "feat(vscode): parse release versions and vsix assets"
```

### Task 2: 实现 UpdateInstaller 与 UpdateService 核心状态机

**Files:**

- Create: `hosts/vscode-plugin/src/update/UpdateInstaller.ts`
- Create: `hosts/vscode-plugin/src/update/UpdateService.ts`
- Create: `hosts/vscode-plugin/src/test/suite/updateInstaller.test.ts`
- Create: `hosts/vscode-plugin/src/test/suite/updateService.test.ts`

- [ ] **Step 1: 先写失败测试，覆盖下载、安装、状态广播与重复版本去重**

`hosts/vscode-plugin/src/test/suite/updateInstaller.test.ts`

```ts
import * as assert from "assert"
import * as vscode from "vscode"
import { UpdateInstaller } from "../../update/UpdateInstaller"

suite("UpdateInstaller Test Suite", () => {
  test("install 会下载 VSIX 并调用 installExtension", async () => {
    const calls: string[] = []
    const installer = new UpdateInstaller(
      async () => new Response(new Uint8Array([1, 2, 3])),
      {
        mkdir: async () => undefined,
        writeFile: async (path, bytes) => {
          calls.push(`${path}:${bytes.byteLength}`)
        },
      },
      async (command, uri) => {
        calls.push(`${command}:${(uri as vscode.Uri).fsPath}`)
      },
      () => "C:/tmp/opencode-ui-update",
    )

    const path = await installer.install({ version: "26.4.1401", vsixUrl: "https://example.test/a.vsix" })
    assert.ok(path.endsWith("opencode-ui-26.4.1401.vsix"))
    assert.strictEqual(calls.length, 2)
  })
})
```

`hosts/vscode-plugin/src/test/suite/updateService.test.ts`

```ts
import * as assert from "assert"
import { UpdateService } from "../../update/UpdateService"

suite("UpdateService Test Suite", () => {
  test("发现新版本时只广播一次 updateAvailable", async () => {
    const sent: Array<{ type: string; payload: unknown }> = []
    const service = new UpdateService({
      currentVersion: "26.4.1400",
      checker: {
        getLatest: async () => ({
          version: "26.4.1401",
          releaseUrl: "https://example.test/r",
          vsixUrl: "https://example.test/a.vsix",
        }),
      },
      installer: { install: async () => "C:/tmp/a.vsix" },
      stateStore: { get: () => undefined, update: async () => undefined },
      send: (_sessionId, message) => sent.push(message),
      clock: () => 123,
      setInterval: () => ({ dispose() {} }),
      setTimeout: () => ({ dispose() {} }),
      logger: { appendLine() {} },
    })

    service.attachSession("s1")
    await service.checkNow()
    await service.checkNow()

    assert.strictEqual(sent.filter((item) => item.type === "updateAvailable").length, 1)
  })

  test("installUpdate 会推送 downloading 和 success", async () => {
    const sent: Array<{ type: string; payload: any }> = []
    const service = new UpdateService({
      currentVersion: "26.4.1400",
      checker: { getLatest: async () => null },
      installer: { install: async () => "C:/tmp/a.vsix" },
      stateStore: { get: () => undefined, update: async () => undefined },
      send: (_sessionId, message) => sent.push(message),
      clock: () => 123,
      setInterval: () => ({ dispose() {} }),
      setTimeout: () => ({ dispose() {} }),
      logger: { appendLine() {} },
    })

    service.attachSession("s1")
    service.setLatest({
      version: "26.4.1401",
      releaseUrl: "https://example.test/r",
      vsixUrl: "https://example.test/a.vsix",
    })
    await service.installUpdate("26.4.1401")

    assert.deepStrictEqual(
      sent.map((item) => item.type),
      ["updateState", "updateState"],
    )
    assert.strictEqual(sent[0]?.payload.state, "downloading")
    assert.strictEqual(sent[1]?.payload.state, "success")
  })
})
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `pnpm run compile && pnpm exec vscode-test --grep "UpdateInstaller Test Suite|UpdateService Test Suite"`

Expected: FAIL，报错包含缺少 `UpdateInstaller` 或 `UpdateService`。

- [ ] **Step 3: 实现下载器与服务，先满足测试再保留扩展点**

`hosts/vscode-plugin/src/update/UpdateInstaller.ts`

```ts
import * as os from "os"
import * as path from "path"
import * as vscode from "vscode"

type FileOps = {
  mkdir: (path: string, options: { recursive: true }) => Promise<void>
  writeFile: (path: string, data: Uint8Array) => Promise<void>
}

export class UpdateInstaller {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly fsOps: FileOps = {
      mkdir: async (dir, options) => void (await vscode.workspace.fs.createDirectory(vscode.Uri.file(dir))),
      writeFile: async (file, data) => void (await vscode.workspace.fs.writeFile(vscode.Uri.file(file), data)),
    },
    private readonly runCommand: typeof vscode.commands.executeCommand = vscode.commands.executeCommand,
    private readonly tempRoot: () => string = () => path.join(os.tmpdir(), "opencode-ui-update"),
  ) {}

  async install(input: { version: string; vsixUrl: string }): Promise<string> {
    const response = await this.fetcher(input.vsixUrl)
    if (!response.ok) {
      throw new Error(`VSIX download failed: ${response.status}`)
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    const dir = this.tempRoot()
    const file = path.join(dir, `opencode-ui-${input.version}.vsix`)
    await this.fsOps.mkdir(dir, { recursive: true })
    await this.fsOps.writeFile(file, bytes)
    await this.runCommand("workbench.extensions.installExtension", vscode.Uri.file(file))
    return file
  }
}
```

`hosts/vscode-plugin/src/update/UpdateService.ts`

```ts
import type { ReleaseInfo } from "./ReleaseChecker"

type UpdateMessage = { type: string; payload: any }

export class UpdateService {
  private sessions = new Set<string>()
  private latest: ReleaseInfo | null = null
  private notifiedVersion: string | null = null
  private firstCheck?: { dispose(): void }
  private loop?: { dispose(): void }

  constructor(
    private readonly deps: {
      currentVersion: string
      checker: { getLatest: (currentVersion: string) => Promise<ReleaseInfo | null> }
      installer: { install: (input: { version: string; vsixUrl: string }) => Promise<string> }
      stateStore: { get: (key: string) => unknown; update: (key: string, value: unknown) => Promise<void> }
      send: (sessionId: string, message: UpdateMessage) => void
      clock: () => number
      setInterval: (task: () => void, ms: number) => { dispose(): void }
      setTimeout: (task: () => void, ms: number) => { dispose(): void }
      logger: { appendLine: (message: string) => void }
    },
  ) {}

  attachSession(sessionId: string) {
    this.sessions.add(sessionId)
  }

  detachSession(sessionId: string) {
    this.sessions.delete(sessionId)
  }

  start() {
    this.firstCheck?.dispose()
    this.loop?.dispose()
    this.firstCheck = this.deps.setTimeout(() => {
      void this.checkNow()
    }, 30_000)
    this.loop = this.deps.setInterval(
      () => {
        void this.checkNow()
      },
      4 * 60 * 60 * 1000,
    )
  }

  dispose() {
    this.firstCheck?.dispose()
    this.loop?.dispose()
  }

  setLatest(value: ReleaseInfo) {
    this.latest = value
  }

  async checkNow() {
    try {
      const latest = await this.deps.checker.getLatest(this.deps.currentVersion)
      if (!latest) return
      this.latest = latest
      await this.deps.stateStore.update("update.latest", latest)
      if (this.notifiedVersion === latest.version) return
      this.notifiedVersion = latest.version
      this.broadcast({
        type: "updateAvailable",
        payload: {
          version: latest.version,
          currentVersion: this.deps.currentVersion,
          releaseUrl: latest.releaseUrl,
          notes: latest.notes,
          publishedAt: latest.publishedAt,
        },
      })
    } catch (error) {
      this.deps.logger.appendLine(`Update check failed: ${error}`)
    }
  }

  async getUpdateInfo() {
    const latest = this.latest ?? (this.deps.stateStore.get("update.latest") as ReleaseInfo | undefined) ?? null
    if (!latest) {
      return { state: "idle" }
    }
    return {
      state: "idle",
      version: latest.version,
      currentVersion: this.deps.currentVersion,
      releaseUrl: latest.releaseUrl,
      notes: latest.notes,
      publishedAt: latest.publishedAt,
    }
  }

  async installUpdate(version: string) {
    if (!this.latest || this.latest.version !== version) {
      throw new Error(`Unknown update version: ${version}`)
    }
    this.broadcast({
      type: "updateState",
      payload: { state: "downloading", version, releaseUrl: this.latest.releaseUrl },
    })
    await this.deps.installer.install({ version, vsixUrl: this.latest.vsixUrl })
    this.broadcast({ type: "updateState", payload: { state: "success", version, releaseUrl: this.latest.releaseUrl } })
  }

  private broadcast(message: UpdateMessage) {
    this.sessions.forEach((sessionId) => this.deps.send(sessionId, message))
  }
}
```

- [ ] **Step 4: 重新运行测试，确认核心模块通过**

Run: `pnpm run compile && pnpm exec vscode-test --grep "UpdateInstaller Test Suite|UpdateService Test Suite"`

Expected: PASS，安装器与服务测试通过。

- [ ] **Step 5: 提交 Task 2**

```bash
git add hosts/vscode-plugin/src/update/UpdateInstaller.ts hosts/vscode-plugin/src/update/UpdateService.ts hosts/vscode-plugin/src/test/suite/updateInstaller.test.ts hosts/vscode-plugin/src/test/suite/updateService.test.ts
git commit -m "feat(vscode): add release update service and installer"
```

### Task 3: 把 UpdateService 接到 IdeBridge 与 extension 生命周期

**Files:**

- Modify: `hosts/vscode-plugin/src/extension.ts`
- Modify: `hosts/vscode-plugin/src/ui/WebviewController.ts`
- Modify: `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
- Modify: `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts`

- [ ] **Step 1: 先写 bridge roundtrip 失败测试**

在 `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts` 追加：

```ts
suite("IdeBridgeServer update protocol", () => {
  let baseUrl: string
  let token: string
  let sessionId: string

  setup(async () => {
    const session = await bridgeServer.createSession(
      {
        openFile: async () => {},
        openUrl: async () => {},
        reloadPath: async () => {},
        clipboardWrite: async () => {},
        getUpdateInfo: async () => ({ state: "idle", version: "26.4.1401", releaseUrl: "https://example.test/r" }),
        installUpdate: async (version) => {
          assert.strictEqual(version, "26.4.1401")
        },
      },
      {},
    )
    baseUrl = session.baseUrl
    token = session.token
    sessionId = session.sessionId
  })

  teardown(() => {
    bridgeServer.removeSession(sessionId)
  })

  test("getUpdateInfo 返回 result", async () => {
    const reply = await requestReply(baseUrl, token, { type: "getUpdateInfo" })
    assert.strictEqual(reply.ok, true)
    assert.deepStrictEqual(reply.result, { state: "idle", version: "26.4.1401", releaseUrl: "https://example.test/r" })
  })

  test("installUpdate 返回 ok", async () => {
    const roundtrip = await requestRoundtrip(baseUrl, token, {
      type: "installUpdate",
      payload: { version: "26.4.1401" },
    })
    assert.strictEqual(roundtrip.status, 204)
    assert.strictEqual(roundtrip.reply.ok, true)
  })
})
```

- [ ] **Step 2: 运行测试，确认新协议当前失败**

Run: `pnpm run compile && pnpm exec vscode-test --grep "IdeBridgeServer update protocol"`

Expected: FAIL，报错包含 `unsupported message type` 或 `getUpdateInfo` / `installUpdate` 未实现。

- [ ] **Step 3: 修改 bridge、controller、extension，把更新服务接起来**

`hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`

```ts
export interface SessionHandlers {
  openFile: (path: string) => Promise<void>
  openUrl: (url: string) => Promise<void>
  reloadPath: (path: string) => Promise<void>
  clipboardWrite: (text: string) => Promise<void>
  restartHost?: () => Promise<void>
  storageGet?: (scope: StorageScope, keys: string[]) => Promise<Record<string, string | undefined>>
  storageSet?: (scope: StorageScope, key: string, value: string) => Promise<void>
  getUpdateInfo?: () => Promise<Record<string, unknown>>
  installUpdate?: (version: string) => Promise<void>
}
```

```ts
        case "getUpdateInfo": {
          if (!session.handlers.getUpdateInfo) {
            this.replyError(session, id, "getUpdateInfo not supported")
            break
          }
          const result = await session.handlers.getUpdateInfo()
          if (id) {
            this.broadcastSSE(
              session,
              JSON.stringify({ replyTo: id, ok: true, result, timestamp: Date.now() }),
            )
          }
          break
        }

        case "installUpdate": {
          if (!session.handlers.installUpdate) {
            this.replyError(session, id, "installUpdate not supported")
            break
          }
          if (typeof payload?.version !== "string" || !payload.version.trim()) {
            this.replyError(session, id, "Missing version")
            break
          }
          await session.handlers.installUpdate(payload.version)
          this.replyOk(session, id)
          break
        }
```

`hosts/vscode-plugin/src/extension.ts`

```ts
import { ReleaseChecker } from "./update/ReleaseChecker"
import { UpdateInstaller } from "./update/UpdateInstaller"
import { UpdateService } from "./update/UpdateService"

class OpenCodeExtension {
  private updateService?: UpdateService

  private initializeComponents(): void {
    // ...existing setup...
    this.updateService = new UpdateService({
      currentVersion: this.context!.extension.packageJSON.version,
      checker: new ReleaseChecker({ owner: "qtkj", name: "opencode-ui" }),
      installer: new UpdateInstaller(),
      stateStore: {
        get: (key) => this.context!.globalState.get(key),
        update: (key, value) => this.context!.globalState.update(key, value),
      },
      send: (sessionId, message) => bridgeServer.send(sessionId, message),
      clock: () => Date.now(),
      setInterval: (task, ms) => {
        const handle = setInterval(task, ms)
        return { dispose: () => clearInterval(handle) }
      },
      setTimeout: (task, ms) => {
        const handle = setTimeout(task, ms)
        return { dispose: () => clearTimeout(handle) }
      },
      logger,
    })
    this.updateService.start()
  }

  dispose(): void {
    this.updateService?.dispose()
    this.updateService = undefined
    // ...existing dispose logic...
  }
}
```

`hosts/vscode-plugin/src/ui/WebviewController.ts`

```ts
constructor(input: {
  webview: vscode.Webview
  context: vscode.ExtensionContext
  settingsManager?: SettingsManager
  storageGet: (scope: "global" | "workspace" | "mem", keys: string[]) => Promise<Record<string, string | undefined>>
  storageSet: (scope: "global" | "workspace" | "mem", key: string, value: string) => Promise<void>
  updateService?: UpdateService
}) {
  // ...
}
```

```ts
const session = await bridgeServer.createSession(
  {
    openFile: (p) => this.communicationBridge!.handleOpenFile(p),
    openUrl: (url) => this.communicationBridge!.handleOpenUrl(url),
    reloadPath: (p) => this.communicationBridge!.handleReloadPath(p),
    clipboardWrite: async (text) => {
      await vscode.env.clipboard.writeText(text)
    },
    storageGet: this.storageGet,
    storageSet: this.storageSet,
    getUpdateInfo: async () => (await this.updateService?.getUpdateInfo()) ?? { state: "idle" },
    installUpdate: async (version) => {
      await this.updateService?.installUpdate(version)
    },
  },
  { restartMode: "window" },
)

this.updateService?.attachSession(session.sessionId)
```

- [ ] **Step 4: 重新运行协议测试并做一次 VSCode 插件编译**

Run: `pnpm run compile && pnpm exec vscode-test --grep "IdeBridgeServer update protocol"`

Expected: PASS，`getUpdateInfo` 和 `installUpdate` roundtrip 通过。

- [ ] **Step 5: 提交 Task 3**

```bash
git add hosts/vscode-plugin/src/extension.ts hosts/vscode-plugin/src/ui/WebviewController.ts hosts/vscode-plugin/src/ui/IdeBridgeServer.ts hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts
git commit -m "feat(vscode): expose update actions through ide bridge"
```

### Task 4: 在 WebGUI 中接收更新状态并渲染 UpdateBanner

**Files:**

- Create: `packages/opencode/webgui/src/state/UpdateContext.tsx`
- Create: `packages/opencode/webgui/src/state/UpdateContext.test.tsx`
- Create: `packages/opencode/webgui/src/components/UpdateBanner.tsx`
- Create: `packages/opencode/webgui/src/components/UpdateBanner.test.tsx`
- Modify: `packages/opencode/webgui/src/main.tsx`
- Modify: `packages/opencode/webgui/src/App.tsx`

- [ ] **Step 1: 先写失败测试，锁定 context 初始化和 banner 交互**

`packages/opencode/webgui/src/state/UpdateContext.test.tsx`

```tsx
import { render, screen, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { UpdateProvider, useUpdateState } from "./UpdateContext"
import { ideBridge } from "../lib/ideBridge"

vi.mock("../lib/ideBridge", () => ({
  ideBridge: {
    isInstalled: () => true,
    on: vi.fn(),
    off: vi.fn(),
    request: vi
      .fn()
      .mockResolvedValue({ result: { state: "idle", version: "26.4.1401", releaseUrl: "https://example.test/r" } }),
    send: vi.fn(),
  },
}))

function Probe() {
  const state = useUpdateState()
  return <div>{state.version}</div>
}

describe("UpdateContext", () => {
  it("初始化时会请求 getUpdateInfo", async () => {
    render(
      <UpdateProvider>
        <Probe />
      </UpdateProvider>,
    )

    await waitFor(() => expect(ideBridge.request).toHaveBeenCalledWith("getUpdateInfo"))
    expect(await screen.findByText("26.4.1401")).toBeInTheDocument()
  })
})
```

`packages/opencode/webgui/src/components/UpdateBanner.test.tsx`

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { UpdateBanner } from "./UpdateBanner"
import { UpdateContext } from "../state/UpdateContext"

describe("UpdateBanner", () => {
  it("有新版本时显示立即更新按钮", () => {
    render(
      <UpdateContext.Provider
        value={{
          state: "idle",
          version: "26.4.1401",
          currentVersion: "26.4.1400",
          releaseUrl: "https://example.test/r",
          installUpdate: vi.fn(),
          openRelease: vi.fn(),
        }}
      >
        <UpdateBanner />
      </UpdateContext.Provider>,
    )

    expect(screen.getByText("发现新版本 26.4.1401")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "立即更新" })).toBeInTheDocument()
  })

  it("点击立即更新会触发 installUpdate", async () => {
    const user = userEvent.setup()
    const installUpdate = vi.fn()
    render(
      <UpdateContext.Provider
        value={{
          state: "idle",
          version: "26.4.1401",
          currentVersion: "26.4.1400",
          releaseUrl: "https://example.test/r",
          installUpdate,
          openRelease: vi.fn(),
        }}
      >
        <UpdateBanner />
      </UpdateContext.Provider>,
    )

    await user.click(screen.getByRole("button", { name: "立即更新" }))
    expect(installUpdate).toHaveBeenCalledWith("26.4.1401")
  })
})
```

- [ ] **Step 2: 运行测试，确认当前失败**

Run: `bun run test:run src/state/UpdateContext.test.tsx src/components/UpdateBanner.test.tsx`

Expected: FAIL，报错包含 `Cannot find module './UpdateContext'` 或 `Cannot find module './UpdateBanner'`。

- [ ] **Step 3: 实现 UpdateProvider 与 UpdateBanner，并接入 main/App**

`packages/opencode/webgui/src/state/UpdateContext.tsx`

```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { ideBridge } from "../lib/ideBridge"

type UpdateValue = {
  state: "idle" | "downloading" | "installing" | "success" | "error"
  version: string | null
  currentVersion: string | null
  releaseUrl: string | null
  notes: string | null
  publishedAt: string | null
  message: string | null
  installUpdate: (version: string) => Promise<void>
  openRelease: () => void
}

export const UpdateContext = createContext<UpdateValue | null>(null)

export function useUpdateState() {
  const value = useContext(UpdateContext)
  if (!value) throw new Error("useUpdateState must be used within UpdateProvider")
  return value
}

export function UpdateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<UpdateValue["state"]>("idle")
  const [version, setVersion] = useState<string | null>(null)
  const [currentVersion, setCurrentVersion] = useState<string | null>(null)
  const [releaseUrl, setReleaseUrl] = useState<string | null>(null)
  const [notes, setNotes] = useState<string | null>(null)
  const [publishedAt, setPublishedAt] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!ideBridge.isInstalled()) return
    void ideBridge.request<Record<string, unknown>>("getUpdateInfo").then((res) => {
      const result = res.result ?? {}
      setState((typeof result.state === "string" ? result.state : "idle") as UpdateValue["state"])
      setVersion(typeof result.version === "string" ? result.version : null)
      setCurrentVersion(typeof result.currentVersion === "string" ? result.currentVersion : null)
      setReleaseUrl(typeof result.releaseUrl === "string" ? result.releaseUrl : null)
      setNotes(typeof result.notes === "string" ? result.notes : null)
      setPublishedAt(typeof result.publishedAt === "string" ? result.publishedAt : null)
    })
  }, [])

  useEffect(() => {
    const handler = (msg: any) => {
      if (msg?.type === "updateAvailable") {
        const payload = msg.payload ?? {}
        setState("idle")
        setVersion(typeof payload.version === "string" ? payload.version : null)
        setCurrentVersion(typeof payload.currentVersion === "string" ? payload.currentVersion : null)
        setReleaseUrl(typeof payload.releaseUrl === "string" ? payload.releaseUrl : null)
        setNotes(typeof payload.notes === "string" ? payload.notes : null)
        setPublishedAt(typeof payload.publishedAt === "string" ? payload.publishedAt : null)
        setMessage(null)
      }
      if (msg?.type === "updateState") {
        const payload = msg.payload ?? {}
        setState((typeof payload.state === "string" ? payload.state : "idle") as UpdateValue["state"])
        setMessage(typeof payload.message === "string" ? payload.message : null)
      }
    }
    ideBridge.on(handler)
    return () => ideBridge.off(handler)
  }, [])

  const installUpdate = useCallback(async (next: string) => {
    await ideBridge.request("installUpdate", { version: next })
  }, [])

  const openRelease = useCallback(() => {
    if (!releaseUrl) return
    ideBridge.send({ type: "openUrl", payload: { url: releaseUrl } })
  }, [releaseUrl])

  const value = useMemo(
    () => ({ state, version, currentVersion, releaseUrl, notes, publishedAt, message, installUpdate, openRelease }),
    [state, version, currentVersion, releaseUrl, notes, publishedAt, message, installUpdate, openRelease],
  )

  return <UpdateContext.Provider value={value}>{children}</UpdateContext.Provider>
}
```

`packages/opencode/webgui/src/components/UpdateBanner.tsx`

```tsx
import { useUpdateState } from "../state/UpdateContext"

export function UpdateBanner() {
  const update = useUpdateState()

  if (!update.version) return null

  const title =
    update.state === "downloading"
      ? `正在下载 ${update.version}`
      : update.state === "installing"
        ? `正在安装 ${update.version}`
        : update.state === "success"
          ? `更新到 ${update.version} 已完成，请重载 VSCode`
          : update.state === "error"
            ? (update.message ?? `更新 ${update.version} 失败`)
            : `发现新版本 ${update.version}`

  return (
    <div
      className="w-full border-b border-blue-200 bg-blue-50 px-4 py-2 dark:border-blue-900 dark:bg-blue-950"
      role="status"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-blue-900 dark:text-blue-100">{title}</p>
          {update.currentVersion ? (
            <p className="text-xs text-blue-700 dark:text-blue-300">当前版本 {update.currentVersion}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-60"
            disabled={update.state === "downloading" || update.state === "installing"}
            onClick={() => void update.installUpdate(update.version!)}
          >
            立即更新
          </button>
          <button
            type="button"
            className="rounded border border-blue-300 px-3 py-1 text-sm text-blue-700 dark:border-blue-700 dark:text-blue-300"
            onClick={update.openRelease}
          >
            查看 Release
          </button>
        </div>
      </div>
    </div>
  )
}
```

`packages/opencode/webgui/src/main.tsx`

```tsx
import { UpdateProvider } from "./state/UpdateContext"

// ...
;<ToastProvider>
  <IdeBridgeProvider>
    <ProvidersProvider>
      <UISettingsProvider>
        <UpdateProvider>
          <App />
        </UpdateProvider>
      </UISettingsProvider>
    </ProvidersProvider>
  </IdeBridgeProvider>
</ToastProvider>
```

`packages/opencode/webgui/src/App.tsx`

```tsx
import { UpdateBanner } from "./components/UpdateBanner"

// ...
<CompactHeader
  ref={compactHeaderRef}
  connectionState={connectionState}
  onNewSession={handleNewSession}
  isCreatingSession={isCreating}
  onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
/>

<UpdateBanner />
<OfflineBanner connectionState={connectionState} />
```

- [ ] **Step 4: 重新运行 WebGUI 测试**

Run: `bun run test:run src/state/UpdateContext.test.tsx src/components/UpdateBanner.test.tsx`

Expected: PASS，context 与 banner 测试通过。

- [ ] **Step 5: 提交 Task 4**

```bash
git add packages/opencode/webgui/src/state/UpdateContext.tsx packages/opencode/webgui/src/state/UpdateContext.test.tsx packages/opencode/webgui/src/components/UpdateBanner.tsx packages/opencode/webgui/src/components/UpdateBanner.test.tsx packages/opencode/webgui/src/main.tsx packages/opencode/webgui/src/App.tsx
git commit -m "feat(webgui): show vscode extension update banner"
```

### Task 5: 全量验证与收尾

**Files:**

- Modify: `hosts/vscode-plugin/src/update/UpdateService.ts`
- Modify: `packages/opencode/webgui/src/state/UpdateContext.tsx`
- Modify: `packages/opencode/webgui/src/components/UpdateBanner.tsx`

- [ ] **Step 1: 对照 spec 做补齐，加入失败态与安装中态广播**

在 `hosts/vscode-plugin/src/update/UpdateService.ts` 将 `installUpdate` 扩成完整状态流：

```ts
  async installUpdate(version: string) {
    if (!this.latest || this.latest.version !== version) {
      throw new Error(`Unknown update version: ${version}`)
    }

    try {
      this.broadcast({ type: "updateState", payload: { state: "downloading", version, releaseUrl: this.latest.releaseUrl } })
      this.broadcast({ type: "updateState", payload: { state: "installing", version, releaseUrl: this.latest.releaseUrl } })
      await this.deps.installer.install({ version, vsixUrl: this.latest.vsixUrl })
      this.broadcast({ type: "updateState", payload: { state: "success", version, releaseUrl: this.latest.releaseUrl, message: "安装完成，请重载 VSCode" } })
    } catch (error) {
      this.broadcast({
        type: "updateState",
        payload: {
          state: "error",
          version,
          releaseUrl: this.latest.releaseUrl,
          message: error instanceof Error ? error.message : String(error),
        },
      })
      throw error
    }
  }
```

- [ ] **Step 2: 运行 VSCode 插件测试集，确认没有回归**

Run: `pnpm run compile && pnpm run test`

Expected: PASS，VSCode 插件测试全部通过。

- [ ] **Step 3: 运行 WebGUI 测试与构建**

Run: `bun run test:run && bun run build`

Expected: PASS，Vitest 通过，Vite 构建成功。

- [ ] **Step 4: 做手工验证清单**

```text
1. 启动本地 VSCode 扩展开发宿主
2. 将扩展版本临时改低于 GitHub latest release
3. 打开 OpenCode 面板，等待后台检查结果
4. 确认 WebGUI 出现“发现新版本”提示条
5. 点击“查看 Release”，确认系统打开 GitHub Release 页面
6. 点击“立即更新”，确认依次看到 downloading → installing → success
7. 重载 VSCode，确认新版本已生效
8. 断网后重复打开面板，确认不会弹出打断式错误
```

- [ ] **Step 5: 提交收尾变更**

```bash
git add hosts/vscode-plugin/src/update/UpdateService.ts packages/opencode/webgui/src/state/UpdateContext.tsx packages/opencode/webgui/src/components/UpdateBanner.tsx
git commit -m "test: verify vscode release auto-update workflow"
```

## 自检

- **Spec coverage**
  - GitHub Release 查询：Task 1
  - VSIX 下载与安装：Task 2
  - VSCode 定时检查与状态缓存：Task 2 / Task 3 / Task 5
  - Bridge `installUpdate` / `getUpdateInfo`：Task 3
  - WebGUI UpdateBanner 与状态流转：Task 4 / Task 5
  - 错误处理与最终验证：Task 5
- **Placeholder scan**
  - 无 `TODO` / `TBD` / “后续补充” 占位
- **Type consistency**
  - 统一使用 `state`，不再混用 `phase`
  - 统一使用 `version` / `currentVersion` / `releaseUrl` / `vsixUrl`
