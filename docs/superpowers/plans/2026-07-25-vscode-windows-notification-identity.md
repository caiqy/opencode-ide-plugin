# VS Code Windows Notification Identity Implementation Plan

> **Superseded:** Windows 实机 smoke 证明借用 `Microsoft.VisualStudioCode` 会在点击 toast 时启动空白 Code 窗口。本计划仅保留为失败假设记录；后续由 `2026-07-25-vscode-windows-notification-registration.md` 取代。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Windows 通知显示当前 VS Code 产品身份，并在点击后精确前置产生通知的 VS Code 窗口。

**Architecture:** `systemNotification.ts` 从当前 VS Code `product.json` 读取已注册的 `win32AppUserModelId` 并传给 `node-notifier`。原始回调 URI 在发送 Windows toast 前经 `vscode.env.asExternalUri` 转换；点击时只打开 relay URI，由 VS Code 将其路由回原窗口。

**Tech Stack:** TypeScript、VS Code Extension API、`node-notifier`、Mocha、Sinon。

## Global Constraints

- 顶部名称和小图标使用当前 VS Code 产品身份；正文大图标继续使用 `resources/icon.png`。
- 不注册 OpenCodeUI Start Menu 身份，不使用 PowerShell、Win32 窗口枚举或窗口标题启发式。
- 产品身份缺失、relay 创建失败或 URI 打开失败时只记录并跳过，不退回 SnoreToast 默认身份或 IDE 内通知。
- 只修改 VS Code 通知实现与测试；不改 WebGUI、JetBrains 或后端。
- 版本保持 `26.7.2401`；重新打包固定名称的 Windows x64 VSIX。
- 不提交、不推送、不创建 PR；不回退工作树中的其他用户改动。

---

### Task 1: Windows toast identity and originating-window relay

**Files:**
- Modify: `hosts/vscode-plugin/src/test/suite/systemNotification.test.ts`
- Modify: `hosts/vscode-plugin/src/ui/systemNotification.ts`

**Interfaces:**
- Consumes: `vscode.env.appRoot`, `vscode.env.asExternalUri(uri)` and `product.json.win32AppUserModelId`.
- Produces: `node-notifier` option `appID: string` and an `openExternal` call using the relay URI.

- [x] **Step 1: Write failing Windows identity tests**

Extend the test-only option shape and the existing Windows notifier assertion:

```ts
type NotificationOptions = {
  title: string
  message: string
  icon: string
  wait: boolean
  sound: boolean
  appID?: string
}

const deps = {
  authority: "caiqy.opencode-ui",
  platform: "win32" as const,
  windowsAppID: "Microsoft.VisualStudioCode",
  asExternalUri: async (uri: vscode.Uri) => uri,
  loadNotifier: async () => notifier,
  openExternal: async (uri: vscode.Uri) => {
    uris.push(uri)
    return true
  },
  log: () => {},
}

assert.deepStrictEqual(notifications[0]?.options, {
  title: "Agent finished",
  message: "Finished working.",
  icon: path.join(extensionUri.fsPath, "resources", "icon.png"),
  wait: true,
  sound: false,
  appID: "Microsoft.VisualStudioCode",
})
```

Add a case proving a blank registered identity logs and skips the toast:

```ts
test("skips Windows toast when the VS Code app identity is missing", async () => {
  const logs: string[] = []
  const { notifier, notifications } = createNotifier()
  const input = {
    bridgeSessionID: "bridge-session-1",
    sessionID: "target-session-2",
    title: "Agent finished",
    body: "Finished working.",
    extensionUri: vscode.Uri.file("D:/test-extension"),
  }

  await showSystemNotification(input, {
    platform: "win32",
    windowsAppID: "",
    asExternalUri: async (uri: vscode.Uri) => uri,
    loadNotifier: async () => notifier,
    log: (message) => logs.push(message),
  })

  assert.strictEqual(notifications.length, 0)
  assert.ok(logs[0]?.includes("win32AppUserModelId"))
})
```

- [x] **Step 2: Write a failing originating-window relay test**

```ts
test("opens the Windows relay URI for the originating VS Code window", async () => {
  const sourceUris: vscode.Uri[] = []
  const openedUris: vscode.Uri[] = []
  const relayUri = vscode.Uri.parse("https://relay.test/window/1")
  const { notifier, notifications } = createNotifier()
  const input = {
    bridgeSessionID: "bridge-session-1",
    sessionID: "target-session-2",
    title: "Agent finished",
    body: "Finished working.",
    extensionUri: vscode.Uri.file("D:/test-extension"),
  }

  await showSystemNotification(input, {
    authority: "caiqy.opencode-ui",
    platform: "win32",
    windowsAppID: "Microsoft.VisualStudioCode",
    asExternalUri: async (uri: vscode.Uri) => {
      sourceUris.push(uri)
      return relayUri
    },
    loadNotifier: async () => notifier,
    openExternal: async (uri) => {
      openedUris.push(uri)
      return true
    },
    log: () => {},
  })

  notifications[0]?.callback?.(null, "activate")
  await wait(0)

  assert.deepStrictEqual(parseSystemNotificationUri(sourceUris[0]!), {
    bridgeSessionID: "bridge-session-1",
    sessionID: "target-session-2",
  })
  assert.deepStrictEqual(openedUris, [relayUri])
})
```

- [x] **Step 3: Run the narrow test and verify RED**

Run from `hosts/vscode-plugin` with the vfox-managed Node runtime:

```powershell
pnpm run compile
pnpm exec vscode-test --grep "system notification"
```

Expected: the identity assertion fails because `appID` is absent; the relay assertion fails because the raw `vscode://` URI is opened; the missing-identity case sends a toast instead of skipping it.

- [x] **Step 4: Implement the minimal Windows behavior**

Add `readFile`, the optional notifier field, and two dependency seams:

```ts
import { readFile } from "fs/promises"

type NotificationOptions = {
  title: string
  message: string
  icon: string
  wait: boolean
  sound: boolean
  appID?: string
}

export interface SystemNotificationDeps {
  asExternalUri?: (uri: vscode.Uri) => Thenable<vscode.Uri>
  windowsAppID?: string
}
```

Inside the existing `try`, derive the platform once, validate the current product identity, and relay only Windows callbacks:

```ts
const platform = deps.platform ?? process.platform
const appID =
  platform === "win32"
    ? deps.windowsAppID ??
      (JSON.parse(await readFile(join(vscode.env.appRoot, "product.json"), "utf8")) as {
        win32AppUserModelId?: unknown
      }).win32AppUserModelId
    : undefined
if (platform === "win32" && (typeof appID !== "string" || !appID.trim())) {
  throw new Error("VS Code product missing win32AppUserModelId")
}

const sourceUri = createSystemNotificationUri({
  authority,
  bridgeSessionID: input.bridgeSessionID,
  sessionID: input.sessionID,
})
const targetUri =
  platform === "win32"
    ? await (deps.asExternalUri ?? ((uri) => vscode.env.asExternalUri(uri)))(sourceUri)
    : sourceUri
const options = {
  title: input.title,
  message: input.body,
  icon: join(input.extensionUri.fsPath, "resources", "icon.png"),
  wait: true,
  sound: false,
  ...(appID ? { appID } : {}),
}
```

Reuse `platform` in the existing Linux branch. Keep the callback and all existing failure logging unchanged.

- [x] **Step 5: Run the narrow test and verify GREEN**

```powershell
pnpm run compile
pnpm exec vscode-test --grep "system notification"
```

Expected: all `system notification` tests pass.

---

### Task 2: VS Code verification and fixed VSIX replacement

**Files:**
- Produce: `hosts/vscode-plugin/opencode-vscode-win-amd64-26.7.2401.vsix`
- Modify: `.superpowers/sdd/task-4-report.md`
- Modify: `.superpowers/sdd/task-4-review.md`
- Modify: `.superpowers/sdd/final-review-webgui-vscode.md`

- [x] **Step 1: Run VS Code compile, lint, and full tests**

Run from `hosts/vscode-plugin`:

```powershell
pnpm run compile
pnpm run lint
pnpm test
```

Expected: compile succeeds; lint has zero errors; notification tests pass. Report the known `readUris` baseline failure separately if its unchanged non-configurable `stat` descriptor failure remains.

- [x] **Step 2: Repackage the existing Windows artifact without rebuilding the unchanged backend**

```powershell
pnpm run compile:production
pnpm exec vsce package --allow-missing-repository --out opencode-vscode-win-amd64-26.7.2401.vsix
pnpm exec vsce ls
```

Expected: the fixed-name VSIX is replaced; the package lists `node-notifier`, `out/extension.js`, `resources/icon.png`, and `resources/bin/windows/amd64/opencode.exe`, while excluding `.opencode/**` and `out/test/**`.

- [x] **Step 3: Inspect the artifact and update reports**

Compute the new SHA-256, byte size, and archive file count. Update the three existing `.superpowers/sdd` reports with the new automated evidence and state that the final Windows foreground smoke test remains required after installation.

- [ ] **Step 4: Perform the Windows desktop smoke test**

Install the replacement VSIX, open two VS Code windows, trigger a notification in the background window, and verify:

1. The top identity reads `Visual Studio Code` with the VS Code small icon.
2. The notification body retains the OpenCode icon.
3. Clicking foregrounds the originating window, opens OpenCode, and selects the originating session.
