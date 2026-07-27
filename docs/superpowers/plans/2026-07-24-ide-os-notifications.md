# IDE OS Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 VS Code 与 JetBrains 插件宿主中发送真正的操作系统通知，并在点击后聚焦 IDE、打开 OpenCode 和切换到通知对应会话。

**Architecture:** WebGUI 继续派生通知并通过易失 bridge 消息发送 `sessionID/title/body`。宿主负责调用平台通知 API；点击后宿主把 `openSession` 发送回原 bridge session，WebGUI 复用现有 `handleSwitchSession` 路径。

**Tech Stack:** React 19、TypeScript、Vitest、VS Code Extension API、`node-notifier`、Kotlin、IntelliJ Platform、AWT `SystemTray`、JUnit 5。

## Global Constraints

- 普通网页不通知；系统通知失败只记录，不降级为 IDE 内通知。
- 通知保持易失、不排队、不重试，并保留现有去重、前台抑制和正文裁剪。
- 点击通知必须聚焦 IDE、打开 OpenCode，并切换到 payload 中的 `sessionID`。
- Windows、macOS、Linux 使用同一宿主协议；Windows 做实际桌面验证。
- 已生成的 `26.7.2400` VSIX 作废；最终两个 manifest 版本均为 `26.7.2401`。
- 不提交、不推送、不创建 PR；不回退工作树中的其他用户改动。

---

### Task 1: WebGUI notification protocol and click routing

**Files:**
- Modify: `packages/opencode/webgui/src/lib/ideNotifications.ts`
- Modify: `packages/opencode/webgui/src/lib/ideNotifications.test.ts`
- Modify: `packages/opencode/webgui/src/App.tsx`
- Modify: `packages/opencode/webgui/src/App.test.tsx`

**Interfaces:**
- Produces: `{ type: "showSystemNotification", payload: { sessionID: string; title: string; body: string } }`
- Consumes: `{ type: "openSession", payload: { sessionID: string } }`

- [ ] **Step 1: Write failing payload and routing tests**

```ts
expect(bridge.sendTransient).toHaveBeenCalledWith({
  type: "showSystemNotification",
  payload: { sessionID: "s1", title: "Agent finished", body: "Finished working." },
})

const switchSession = vi.fn().mockResolvedValue(true)
expect(handleIdeBridgeUiEvent({ type: "openSession", payload: { sessionID: "s1" } }, switchSession)).toBe(true)
expect(switchSession).toHaveBeenCalledWith("s1")
expect(handleIdeBridgeUiEvent({ type: "openSession", payload: {} }, switchSession)).toBe(false)
```

- [ ] **Step 2: Run tests and verify RED**

Run from `packages/opencode/webgui`:

```powershell
bun run test:run -- src/lib/ideNotifications.test.ts src/App.test.tsx
```

Expected: FAIL because the message is still `showNotification`, omits `sessionID`, and `handleIdeBridgeUiEvent` does not exist.

- [ ] **Step 3: Implement the minimal protocol and route**

```ts
export function handleIdeBridgeUiEvent(msg: unknown, switchSession: (sessionID: string) => unknown) {
  if (!msg || typeof msg !== "object") return false
  const event = msg as { type?: unknown; payload?: { sessionID?: unknown } }
  if (event.type !== "openSession" || typeof event.payload?.sessionID !== "string" || !event.payload.sessionID) return false
  void switchSession(event.payload.sessionID)
  return true
}
```

Call this function first in the existing `AppInner` bridge handler, then change `sendIdeNotification` to send `showSystemNotification` with `sessionID`.

- [ ] **Step 4: Run tests and verify GREEN**

```powershell
bun run test:run -- src/lib/ideNotifications.test.ts src/App.test.tsx
```

Expected: PASS.

---

### Task 2: VS Code OS notifier and click callback

**Files:**
- Modify: `hosts/vscode-plugin/package.json`
- Modify: `hosts/vscode-plugin/pnpm-lock.yaml`
- Modify: `hosts/vscode-plugin/.vscodeignore`
- Modify: `hosts/scripts/build_vscode.sh`
- Modify: `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
- Modify: `hosts/vscode-plugin/src/ui/WebviewController.ts`
- Create: `hosts/vscode-plugin/src/ui/systemNotification.ts`
- Modify: `hosts/vscode-plugin/src/extension.ts`
- Modify: `hosts/vscode-plugin/src/test/suite/ideBridgeServer.test.ts`
- Test: `hosts/vscode-plugin/src/test/suite/systemNotification.test.ts`

**Interfaces:**
- Consumes: `showSystemNotification(sessionID: string, title: string, body: string)` from the bridge.
- Produces: URI callback carrying `bridgeSessionID` and `sessionID`, then bridge event `openSession`.

- [ ] **Step 1: Add `node-notifier` and write failing bridge validation tests**

Use the vfox-managed Node runtime, then from `hosts/vscode-plugin` run:

```powershell
pnpm add node-notifier
pnpm add -D @types/node-notifier
```

Change existing tests to send `showSystemNotification` and assert all three trimmed fields reach the handler. Add cases rejecting missing/blank/non-string `sessionID`, `title`, and `body`.

- [ ] **Step 2: Run the narrow tests and verify RED**

```powershell
pnpm run compile
pnpm exec vscode-test --grep "IdeBridgeServer showSystemNotification"
```

Expected: FAIL because the bridge only knows `showNotification(title, body)`.

- [ ] **Step 3: Implement bridge payload and notifier click behavior**

Change the handler contract to:

```ts
showSystemNotification?: (sessionID: string, title: string, body: string) => Promise<void>
```

In `WebviewController`, dynamically import `node-notifier` only when a notification is sent. Use `wait: true`, `sound: false`, and the extension PNG icon. On notifier `activate`/click, call `vscode.env.openExternal` with a `vscode://` URI containing the originating bridge session and target OpenCode session. Catch and log notifier failures; never call `showInformationMessage`.

Remove the packaging path's `--no-dependencies` behavior and adjust `.vscodeignore` only as needed so `node-notifier` and its production dependencies are present in the VSIX. Do not include unrelated development dependencies.

Register one `vscode.window.registerUriHandler` in `extension.ts`. For the notification path, execute `workbench.view.extension.opencode`, then call:

```ts
bridgeServer.send(bridgeSessionID, {
  type: "openSession",
  payload: { sessionID },
})
```

- [ ] **Step 4: Add and run notifier adapter tests**

The adapter test injects a notifier callback and verifies exact title/message/icon/wait/sound options, a single click URI, and logging without `showInformationMessage` on failure.

```powershell
pnpm run compile
pnpm exec vscode-test --grep "system notification|IdeBridgeServer showSystemNotification"
```

Expected: PASS.

Also run `pnpm exec vsce ls` and confirm the listed package contains `node-notifier` runtime files before proceeding.

---

### Task 3: JetBrains AWT system notification and click callback

**Files:**
- Modify: `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`
- Modify: `hosts/jetbrains-plugin/src/main/resources/META-INF/plugin.xml`
- Modify: `hosts/jetbrains-plugin/src/unitTest/kotlin/paviko/opencode/ui/IdeBridgeRestartHostTest.kt`

**Interfaces:**
- Consumes: `showSystemNotification` with non-empty `sessionID/title/body`.
- Produces: `openSession` over the originating SSE bridge session after the notification click.

- [ ] **Step 1: Write failing mapping, validation, and click tests**

Update the existing notification hook test to capture `project`, `sessionID`, `title`, `body`, and an `onClick` callback. Assert calling `onClick` invokes the activation hook and emits:

```json
{"type":"openSession","payload":{"sessionID":"s-1"}}
```

Also assert missing, blank, or non-string values are rejected and the notification hook is not called.

- [ ] **Step 2: Run the narrow test and verify RED**

Run from `hosts/jetbrains-plugin` with the vfox-managed JDK:

```powershell
.\gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeRestartHostTest"
```

Expected: FAIL because only `NotificationGroup` and `showNotification(title, body)` exist.

- [ ] **Step 3: Implement AWT notification and activation**

Replace `NotificationGroupManager` with `SystemTray`/`TrayIcon`. If unsupported or headless, log and return. Convert the existing `/icons/opencodeToolWindow.svg` through IntelliJ `IconLoader`/`IconUtil` for the tray image, use `TrayIcon.MessageType.NONE`, and attach an action listener that removes its temporary tray icon and runs the click callback. On click, use `ApplicationManager.invokeLater`, bring the project frame forward, show the `OpenCode` tool window, and send `openSession` to the originating bridge session. Remove the `notificationGroup` declaration from `plugin.xml`.

- [ ] **Step 4: Run tests and verify GREEN**

```powershell
.\gradlew.bat unitTest --tests "paviko.opencode.ui.IdeBridgeRestartHostTest"
```

Expected: PASS.

---

### Task 4: Version, full verification, and Windows package

**Files:**
- Modify: `hosts/vscode-plugin/package.json`
- Modify: `packages/opencode/webgui/package.json`
- Produce: `hosts/vscode-plugin/opencode-vscode-win-amd64-26.7.2401.vsix`

- [ ] **Step 1: Update both versions to `26.7.2401`**

Change only the two manifest `version` fields. Keep generated metadata changes limited to lockfiles required by dependency installation.

- [ ] **Step 2: Run WebGUI verification**

From `packages/opencode/webgui`:

```powershell
bun run test:run
bun run build
```

Expected: all WebGUI tests and build pass.

- [ ] **Step 3: Run VS Code verification**

From `hosts/vscode-plugin`:

```powershell
pnpm run compile
pnpm run lint
pnpm test
```

Expected: notification tests pass; separately report the known baseline `readUris` test failure if it remains unchanged.

- [ ] **Step 4: Run JetBrains verification**

From `hosts/jetbrains-plugin`:

```powershell
.\gradlew.bat unitTest
.\gradlew.bat compileKotlin
```

Expected: PASS.

- [ ] **Step 5: Package and inspect Windows VSIX**

Use the repository's existing vfox-managed build flow and package script. Confirm the archive name contains `26.7.2401`, includes `node-notifier` runtime files and the Windows x64 backend, then compute SHA-256.

- [ ] **Step 6: Perform Windows desktop smoke test**

Install the VSIX in the Extension Development Host, trigger one completion/permission notification while OpenCode is unfocused, click it, and confirm VS Code is foregrounded, OpenCode is shown, and the originating session is selected. Confirm focused-current-session suppression and failure-without-IDE-fallback behavior.
