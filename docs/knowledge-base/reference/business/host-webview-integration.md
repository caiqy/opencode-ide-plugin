# 能力：Webview / JCEF 承载

> **象限**：Reference（能力参考）
> **能力编号**：H2 + H3（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：基线

## 代码真源

| 角色                              | 文件                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| VSCode webview controller         | `hosts/vscode-plugin/src/ui/WebviewController.ts`                                                                         |
| VSCode webview manager            | `hosts/vscode-plugin/src/ui/WebviewManager.ts`                                                                            |
| VSCode activity bar provider      | `hosts/vscode-plugin/src/ui/ActivityBarProvider.ts`                                                                       |
| VSCode iframe shell               | `hosts/vscode-plugin/resources/webview/index.html`                                                                        |
| VSCode communication bridge       | `hosts/vscode-plugin/src/ui/CommunicationBridge.ts`                                                                       |
| JetBrains JCEF tool window        | `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`                                      |
| JetBrains backend logs visibility | `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/BackendLogsVisibilityController.kt`、`BackendLogsErrorView.kt` |
| JetBrains terminal output capture | `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/backendprocess/TerminalOutputCapture.kt`                          |

> 命名交叉核验（Step 5）：能力索引 H2/H3 的 Webview/JCEF 和 backend logs 在 VSCode `WebviewController`、JetBrains `ChatToolWindowFactory`、`BackendLogsVisibilityController` 中分别有直接承载代码。

## 意图

把 backend `/app` WebGUI 嵌入 IDE，同时注入 IDE Bridge 参数和宿主差异参数。宿主插件总览见 [hosts-vscode-plugin 参考](../repositories/hosts-vscode-plugin.md)。

## 行为契约

- VSCode 使用外层 webview HTML 承载 iframe，iframe `src` 是注入后的 WebGUI URL（`resources/webview/index.html:101-107`）。
- VSCode 在加载前对 backend UI 和 bridge URL 调用 `vscode.env.asExternalUri`，支持 Remote-SSH/Codespaces 等远端转发（`WebviewController.ts:229-238`）。
- VSCode 注入 query：`mode`、`ideBridge`、`ideBridgeToken`；`mode` 来自 `opencode.uiMode`，默认 `Terminal`（`WebviewController.ts:236-239`、`WebviewController.ts:463-469`）。
- VSCode CSP 动态包含 UI origin、bridge origin、localhost fallback，并写入 HTML 模板（`WebviewController.ts:472-488`、`WebviewController.ts:491-513`、`resources/webview/index.html:6-8`）。
- VSCode iframe shell 有 30 秒 retry deadline 和指数退避；外层 `WebviewManager`/`ActivityBarProvider` 也对 Chromium SW InvalidState 做 30 秒外层重试（`resources/webview/index.html:118-125`、`WebviewManager.ts:159-220`、`ActivityBarProvider.ts:142-209`）。
- VSCode panel 模式设置 `retainContextWhenHidden: true`，activity bar view 的 retain 依赖 package contribution/注册选项（`WebviewManager.ts:50-73`、`ActivityBarProvider.ts:92-102`）。
- JetBrains 检查 `JBCefApp.isSupported()`，不支持时直接显示 not supported（`ChatToolWindowFactory.kt:73-79`）。
- JetBrains 创建 `JBCefBrowser` 后直接 `loadURL(urlWithBridge)`，URL 注入 `ideBridge`、`ideBridgeToken`、`jcefScrollMultiplier=4`，并加 version/cache busting（`ChatToolWindowFactory.kt:163-198`）。
- JetBrains JCEF 装载后安装 drag-and-drop 和 `IdeOpenFilesUpdater`，dispose 时移除 bridge session（`ChatToolWindowFactory.kt:171-209`）。
- JetBrains 日志面板启动时 detached：创建 `logsPanel` 但不加入 `mainPanel`，只有错误视图调用 `logsVisibility.reveal()` 才显示（`ChatToolWindowFactory.kt:81-96`、`BackendLogsErrorView.kt:8-15`）。
- `BackendLogsVisibilityController.reveal()` 只添加面板并设置 `revealed=true`，没有自动隐藏逻辑（`BackendLogsVisibilityController.kt:13-23`）。
- `TerminalOutputCapture` 每秒扫描终端最近输出，过滤 shell prompt/命令 echo，保留包含 `server listening` 的行（`TerminalOutputCapture.kt:25-68`、`TerminalOutputCapture.kt:133-149`）。

## 边界与约束

- VSCode 的 WebGUI 实际运行在 iframe 内；键盘和拖拽事件需要外层 HTML 转发，不等同于直接打开 `/app`（`resources/webview/index.html:169-187`、`resources/webview/index.html:207-350`、`resources/webview/index.html:356-455`）。
- JetBrains 直接 JCEF 加载 `/app`，没有 VSCode iframe sandbox；宿主差异通过 query 参数和 JCEF installer 处理（`ChatToolWindowFactory.kt:167-198`）。
- JetBrains logs reveal 后不会因 backend 成功连接而自动隐藏；当前控制器没有 hide 方法（`BackendLogsVisibilityController.kt:7-24`）。

## 代码锚点速查

| 契约                        | 锚点                                   |
| --------------------------- | -------------------------------------- |
| VSCode iframe shell         | `resources/webview/index.html:101-107` |
| VSCode asExternalUri        | `WebviewController.ts:229-238`         |
| VSCode query 注入           | `WebviewController.ts:236-239`         |
| VSCode CSP 构造             | `WebviewController.ts:472-513`         |
| VSCode SW 外层重试          | `WebviewManager.ts:159-220`            |
| ActivityBar webview options | `ActivityBarProvider.ts:92-102`        |
| JetBrains JCEF 创建         | `ChatToolWindowFactory.kt:163-170`     |
| JetBrains logs reveal       | `BackendLogsErrorView.kt:8-15`         |

## 运行时待核验

- [ ] VSCode iframe 的 macOS Cmd/Ctrl 快捷键转发在当前 VSCode Electron 版本下是否覆盖所有编辑态（`待运行时核验`）。
- [ ] JetBrains `jcefScrollMultiplier=4` 对不同 DPI/触控板滚动是否过快或过慢（`待运行时核验`）。
- [ ] Backend logs reveal 后用户手动恢复/关闭路径是否足够（`待运行时核验`：代码无自动隐藏）。

## 相关

- 后端启动生命周期：[backend-launch](backend-launch.md)
- IDE Bridge 协议：[ide-bridge](ide-bridge.md)
