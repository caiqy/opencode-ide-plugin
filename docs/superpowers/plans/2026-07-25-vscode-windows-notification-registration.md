# VS Code Windows Notification Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 以独立 `OpenCodeUI` Windows 身份显示可点击 toast，并让点击准确前置产生通知的 VS Code 窗口而不启动空白窗口。

**Architecture:** Windows 通知前先删除旧 `OpenCodeUI\\OpenCodeUI.lnk`，再调用 `node-notifier` 随包附带的 SnoreToast `-install`，刷新 `caiqy.opencode-ui`、快捷方式目标和 Toast activator。Toast 使用相同 `appID`；SnoreToast activator 负责点击回调，现有 `asExternalUri` relay 负责来源窗口路由。

**Tech Stack:** TypeScript、VS Code Extension API、Node.js `child_process`、`node-notifier`、SnoreToast、Mocha。

## Global Constraints

- 顶部显示 `OpenCodeUI` 与 VS Code 小图标；正文继续显示 `resources/icon.png`。
- 注册 `caiqy.opencode-ui`，快捷方式为 `OpenCodeUI\\OpenCodeUI.lnk`，目标为当前 `process.execPath`。
- 不借用 `Microsoft.VisualStudioCode`，不使用 PowerShell、Win32 窗口枚举或窗口标题启发式。
- 注册、relay、notifier 或 URI 打开失败时只记录并跳过，不退回 SnoreToast 默认身份或 IDE 内通知。
- 快捷方式和 SnoreToast activator 注册在扩展卸载后保留，由用户手动删除。
- 不新增依赖，不重建未变化的 WebGUI、JetBrains 或后端。
- 版本保持 `26.7.2401`；重新打包固定名称 Windows x64 VSIX，并作废 SHA-256 `C050C85CB1A6E43023D5A5E3A0F7F050C32DEA37BC4F248E267620B48611AFFD`。
- 不提交、不推送、不创建 PR；不回退工作树中的其他用户改动。

---

### Task 1: OpenCodeUI registration before Windows toast

**Files:**
- Modify: `hosts/vscode-plugin/src/test/suite/systemNotification.test.ts`
- Modify: `hosts/vscode-plugin/src/ui/systemNotification.ts`

**Interfaces:**
- Consumes: bundled `node_modules/node-notifier/vendor/snoreToast/snoretoast-x64.exe`, `process.execPath`, extension authority and the existing `runCommand` dependency seam.
- Produces: `-install OpenCodeUI\\OpenCodeUI <Code.exe> caiqy.opencode-ui` before `notifier.notify(...)`, then `appID: "caiqy.opencode-ui"`.

- [x] **Step 1: Write failing registration and app identity assertions**

Add an immediate successful command helper used by Windows tests:

```ts
function completeCommand(
  _command: string,
  _args: string[],
  callback: (error: Error | null, stdout: string) => void,
) {
  callback(null, "")
}
```

In the existing Windows options test, remove `windowsAppID`, capture the registration command, and change the expected notifier identity:

```ts
const commands: Array<{ command: string; args: string[] }> = []
const deps = {
  authority: "caiqy.opencode-ui",
  platform: "win32" as const,
  asExternalUri: async (uri: vscode.Uri) => uri,
  loadNotifier: async () => notifier,
  runCommand: (command: string, args: string[], callback: NotificationCallback) => {
    commands.push({ command, args })
    callback(null, "")
  },
  openExternal: async (uri: vscode.Uri) => {
    uris.push(uri)
    return true
  },
  log: () => {},
}

assert.deepStrictEqual(commands[0], {
  command: path.join(
    extensionUri.fsPath,
    "node_modules",
    "node-notifier",
    "vendor",
    "snoreToast",
    process.arch === "x64" ? "snoretoast-x64.exe" : "snoretoast-x86.exe",
  ),
  args: ["-install", "OpenCodeUI\\OpenCodeUI", process.execPath, "caiqy.opencode-ui"],
})
assert.strictEqual(notifications[0]?.options.appID, "caiqy.opencode-ui")
```

Use `runCommand: completeCommand` in every other Windows test so automated tests never change the real Start Menu.

- [x] **Step 2: Replace the obsolete missing-product test with a failing registration-error test**

```ts
test("skips Windows toast when OpenCodeUI registration fails", async () => {
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
    authority: "caiqy.opencode-ui",
    platform: "win32",
    asExternalUri: async (uri) => uri,
    loadNotifier: async () => notifier,
    runCommand: (_command, _args, callback) => callback(new Error("install failed"), ""),
    log: (message) => logs.push(message),
  })

  assert.strictEqual(notifications.length, 0)
  assert.ok(logs[0]?.includes("install failed"))
})
```

- [x] **Step 3: Run the narrow test and verify RED**

Run from `hosts/vscode-plugin` with the vfox-managed Node runtime:

```powershell
pnpm run compile
pnpm exec vscode-test --grep "system notification"
```

Expected: the registration command is absent, notifier options still use `Microsoft.VisualStudioCode`, and registration failure does not skip the toast.

- [x] **Step 4: Implement the minimal registration path**

Remove `readFile` and `windowsAppID`. Before creating the relay URI, register the custom identity:

```ts
const appID = authority
if (platform === "win32") {
  // Registration refresh is added in Task 1A below.
  await new Promise<void>((resolve, reject) => {
    (deps.runCommand ?? runCommand)(
      join(
        input.extensionUri.fsPath,
        "node_modules",
        "node-notifier",
        "vendor",
        "snoreToast",
        process.arch === "x64" ? "snoretoast-x64.exe" : "snoretoast-x86.exe",
      ),
      ["-install", "OpenCodeUI\\OpenCodeUI", process.execPath, appID],
      (error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      },
    )
  })
}
```

Set the notifier option only on Windows:

```ts
const options = {
  title: input.title,
  message: input.body,
  icon: join(input.extensionUri.fsPath, "resources", "icon.png"),
  wait: true,
  sound: false,
  ...(platform === "win32" ? { appID } : {}),
}
```

Keep the existing relay URI, callback, Linux `notify-send`, logging and no-fallback behavior unchanged.

- [x] **Step 5: Run the narrow test and verify GREEN**

```powershell
pnpm run compile
pnpm exec vscode-test --grep "system notification"
```

Expected: all `system notification` tests pass without creating a real Start Menu shortcut.

---

### Task 1A: Refresh stale Windows registration

**Files:**
- Modify: `hosts/vscode-plugin/src/test/suite/systemNotification.test.ts`
- Modify: `hosts/vscode-plugin/src/ui/systemNotification.ts`

**Interfaces:**
- Consumes: `%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\OpenCodeUI\\OpenCodeUI.lnk`.
- Produces: removal of the old shortcut before each SnoreToast `-install`, forcing shortcut target and `LocalServer32` refresh.

- [x] **Step 1: Write failing removal order and failure tests**

Add `removeWindowsShortcut` to Windows test dependencies. In the main options test, capture event order:

```ts
const events: string[] = []
const deps = {
  removeWindowsShortcut: async () => {
    events.push("remove")
  },
  runCommand: (_command: string, _args: string[], callback: NotificationCallback) => {
    events.push("install")
    callback(null, "")
  },
  loadNotifier: async () => {
    events.push("notify")
    return notifier
  },
}

assert.deepStrictEqual(events.slice(0, 3), ["remove", "install", "notify"])
```

Add a failure case:

```ts
test("skips Windows toast when stale shortcut removal fails", async () => {
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
    authority: "caiqy.opencode-ui",
    platform: "win32",
    removeWindowsShortcut: async () => {
      throw new Error("remove failed")
    },
    runCommand: completeCommand,
    loadNotifier: async () => notifier,
    log: (message) => logs.push(message),
  })

  assert.strictEqual(notifications.length, 0)
  assert.ok(logs[0]?.includes("remove failed"))
})
```

Use `removeWindowsShortcut: async () => {}` in every other Windows test.

- [x] **Step 2: Run the narrow test and verify RED**

```powershell
pnpm run compile
pnpm exec vscode-test --grep "system notification"
```

Expected: the event order lacks `remove`, and a removal failure does not skip the toast.

- [x] **Step 3: Implement forced shortcut refresh**

Add Node standard-library `rm` and one system-mutation dependency seam:

```ts
import { rm } from "fs/promises"

export interface SystemNotificationDeps {
  removeWindowsShortcut?: () => Promise<void>
}
```

Run this immediately before the existing Windows `-install` promise:

```ts
const appData = process.env.APPDATA
if (!appData && !deps.removeWindowsShortcut) {
  throw new Error("APPDATA is required to register OpenCodeUI notifications")
}
await (deps.removeWindowsShortcut ?? (() =>
  rm(
    join(
      appData!,
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "OpenCodeUI",
      "OpenCodeUI.lnk",
    ),
    { force: true },
  )))()
```

Replace the obsolete idempotency comment with a comment explaining that removal refreshes the versioned SnoreToast activator path.

- [x] **Step 4: Run the narrow test and verify GREEN**

```powershell
pnpm run compile
pnpm exec vscode-test --grep "system notification"
```

Expected: all `system notification` tests pass without modifying the real Start Menu.

---

### Task 2: Verify, repackage, and repeat Windows smoke

**Files:**
- Produce: `hosts/vscode-plugin/opencode-vscode-win-amd64-26.7.2401.vsix`
- Modify: `.superpowers/sdd/task-4-report.md`
- Modify: `.superpowers/sdd/task-4-review.md`
- Modify: `.superpowers/sdd/final-review-webgui-vscode.md`

- [x] **Step 1: Run compile, lint, and full VS Code tests**

```powershell
pnpm run compile
pnpm run lint
pnpm test
```

Expected: compile succeeds; lint has zero errors; notification tests pass. Record the known `readUris` baseline failure separately if unchanged.

- [x] **Step 2: Repackage and inspect the fixed-name VSIX**

```powershell
pnpm run compile:production
pnpm exec vsce package --allow-missing-repository --out opencode-vscode-win-amd64-26.7.2401.vsix
```

Confirm `220 files`, the bundled SnoreToast executable, Windows backend, compiled registration literals, and zero `.opencode/**` / `out/test/**` entries. Compute the new byte size and SHA-256; mark `C050C85CB1A6E43023D5A5E3A0F7F050C32DEA37BC4F248E267620B48611AFFD` invalid in all current reports.

- [x] **Step 3: Request an independent read-only review**

Review the final source and tests for registration command correctness, system mutation boundaries, platform regressions, error handling and stale-shortcut risk. Resolve all Critical and Important findings before continuing.

- [ ] **Step 4: Repeat the Windows two-window smoke test**

Install the replacement VSIX, trigger a notification from a background VS Code window, and verify:

1. Top identity is `OpenCodeUI` with the VS Code small icon; body retains the OpenCode icon.
2. Clicking does not create an empty VS Code window.
3. Clicking foregrounds the originating window, opens OpenCode, and selects the originating session.
4. `%APPDATA%\\Microsoft\\Windows\\Start Menu\\Programs\\OpenCodeUI\\OpenCodeUI.lnk` exists.
