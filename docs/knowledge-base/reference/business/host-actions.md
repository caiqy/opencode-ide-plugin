# 能力：宿主动作与打开文件同步

> **象限**：Reference（能力参考）
> **能力编号**：G3 + G5（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：基线

## 代码真源

| 角色                           | 文件                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| WebGUI open file hook          | `packages/opencode/webgui/src/hooks/useOpenFile.ts`                                                  |
| WebGUI clipboard fallback      | `packages/opencode/webgui/src/utils/clipboard.ts`                                                    |
| WebGUI opened-files state      | `packages/opencode/webgui/src/state/IdeBridgeContext.tsx`                                            |
| VSCode bridge handlers         | `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`、`hosts/vscode-plugin/src/ui/CommunicationBridge.ts` |
| VSCode save image/file monitor | `hosts/vscode-plugin/src/ui/WebviewController.ts`、`hosts/vscode-plugin/src/utils/FileMonitor.ts`    |
| JetBrains bridge handlers      | `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`                             |
| JetBrains opened-files updater | `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeOpenFilesUpdater.kt`                   |

> 命名交叉核验（Step 5）：能力索引 G3/G5 的 `openFile/openUrl/clipboard/saveImage/reloadPath` 与 `updateOpenedFiles` 都在 bridge `handleSend` 或宿主 updater 中有同名消息。

## 意图

让 WebGUI 请求宿主执行 IDE 原生动作，并把 IDE 当前打开文件同步回 WebGUI。IDE Bridge 协议见 [IDE Bridge 能力参考](ide-bridge.md)，宿主实现见 [hosts-vscode-plugin 参考](../repositories/hosts-vscode-plugin.md) 与 [hosts-jetbrains-plugin 参考](../repositories/hosts-jetbrains-plugin.md)。

## 行为契约

- `useOpenFile` 将相对路径按当前 worktree 解析成绝对路径，保留 display/range/line 信息后发送 `openFile`（`useOpenFile.ts:96-134`）。
- `openFile` 支持 `file:line` 和 `file:start-end`；VSCode 在 `CommunicationBridge.handleOpenFile` 中解析行号并 reveal range（`CommunicationBridge.ts:250-331`），JetBrains 在 `IdeBridge.openFile` 中移动 caret 并可选中多行（`IdeBridge.kt:320-340`、`IdeBridge.kt:702-739`）。
- `openUrl` 在 VSCode 走 `vscode.env.openExternal`，JetBrains 走 `BrowserUtil.browse`（`CommunicationBridge.ts:347-355`、`IdeBridge.kt:365-369`）。
- `clipboardWrite` 在 WebGUI 先尝试标准 `navigator.clipboard.writeText`，失败才走 IDE bridge；宿主侧 VSCode 用 `vscode.env.clipboard.writeText`，JetBrains 用 AWT system clipboard（`clipboard.ts:10-30`、`WebviewController.ts:151-153`、`IdeBridge.kt:383-388`）。
- `reloadPath` 在 WebGUI 可 fire-and-forget 发送，VSCode 会对打开的 editor 执行 `workbench.action.files.revert`，JetBrains 刷新 VFS 文件或父目录（`ideBridge.ts:337-340`、`CommunicationBridge.ts:369-401`、`IdeBridge.kt:747-759`）。
- `ensureAndOpenFile` 会创建父目录和空文件后打开；VSCode 支持 `~` 展开，JetBrains 同样处理 `~`（`IdeBridgeServer.ts:317-340`、`IdeBridge.kt:346-359`）。
- `saveImage` 在宿主侧弹保存对话框，支持 data URL 和远端/相对 URL；相对 URL 按 WebGUI base URL 解析（`WebviewController.ts:388-448`、`IdeBridge.kt:394-411`、`IdeBridge.kt:627-642`）。
- VSCode `FileMonitor` 监听 active/visible editor 和 tabGroups，并每 5 秒兜底推送（`FileMonitor.ts:18-39`、`FileMonitor.ts:61-86`）。
- JetBrains `IdeOpenFilesUpdater` 监听 FileEditorManager selection/open/close，并每 5 秒兜底推送（`IdeOpenFilesUpdater.kt:17-91`）。
- WebGUI `IdeBridgeContext` 消费 `updateOpenedFiles`，同时兼容顶层字段和 `payload` 字段，并把路径转为项目相对路径（`IdeBridgeContext.tsx:42-68`）。

## 边界与约束

- 浏览器模式没有 IDE bridge 时，`writeClipboard` 只依赖标准 Clipboard API；失败返回 false，不再伪造宿主能力（`clipboard.ts:19-30`）。
- VSCode `CommunicationBridge.updateOpenedFiles` 仍保留 postMessage 写法，但实际 `WebviewController` 对 `FileMonitor` 回调用 `bridgeServer.send` 推 SSE（`CommunicationBridge.ts:216-230`、`WebviewController.ts:205-217`）。
- `saveImage` 的取消不是错误；bridge result 为 `{ cancelled: true }`（`WebviewController.ts:393-404`、`IdeBridge.kt:401-408`）。

## 代码锚点速查

| 契约                 | 锚点                             |
| -------------------- | -------------------------------- |
| UI openFile payload  | `useOpenFile.ts:120-134`         |
| Clipboard fallback   | `clipboard.ts:10-30`             |
| VSCode openFile      | `CommunicationBridge.ts:250-331` |
| VSCode reloadPath    | `CommunicationBridge.ts:369-401` |
| VSCode saveImage     | `WebviewController.ts:388-448`   |
| JetBrains openFile   | `IdeBridge.kt:702-739`           |
| JetBrains reloadPath | `IdeBridge.kt:747-759`           |
| openedFiles 消费     | `IdeBridgeContext.tsx:42-68`     |

## 运行时待核验

- [ ] VSCode `reloadPath` 对脏编辑器执行 revert 时的用户提示/数据保护表现（`待运行时核验`：需真实 editor 状态）。
- [ ] JetBrains `saveImage` Swing `JFileChooser` 在不同 IDE 主题/平台下的默认目录表现（`待运行时核验`）。

## 相关

- IDE Bridge 协议：[ide-bridge](ide-bridge.md)
- 生成图片保存入口：[generated-image](generated-image.md)
