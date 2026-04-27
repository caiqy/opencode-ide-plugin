# VSCode 与 JetBrains 宿主插件

VSCode 与 JetBrains 插件负责把 opencode 后端和 WebGUI 连接到 IDE 中。它们不是简单 iframe 包装，还提供启动、桥接、文件上下文、拖拽、持久化、更新、重启等宿主能力。

## VSCode 插件

关键文件：

- `hosts/vscode-plugin/src/extension.ts`
- `hosts/vscode-plugin/src/backend/BackendLauncher.ts`
- `hosts/vscode-plugin/src/ui/WebviewController.ts`
- `hosts/vscode-plugin/src/ui/WebviewManager.ts`
- `hosts/vscode-plugin/src/ui/ActivityBarProvider.ts`
- `hosts/vscode-plugin/src/ui/CommunicationBridge.ts`
- `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`

职责：

- 启动或连接 opencode 后端。
- 在 editor panel 或 activity bar view 中承载 WebGUI。
- 通过 `asExternalUri()` 兼容 Remote-SSH/tunnel。
- 动态生成 webview HTML 与 CSP。
- 创建 IDE bridge session，并把 session 参数注入 `/app` URL。
- 处理文件打开、URL 打开、剪贴板、reloadPath、storage、更新、重启。

VSCode 稳定性补丁：

- Service Worker InvalidState 双层 retry。
- webview dispose/recreate 竞态保护。
- 动态 CSP origin 拼接。
- panel 与 activity bar 共用 `WebviewController`，减少协议分叉。

## JetBrains 插件

关键文件：

- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridgeStorageBackend.kt`
- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeOpenFilesUpdater.kt`

职责：

- 在 Tool Window 中通过 JCEF 加载 `/app`。
- 创建 IDE bridge session。
- 处理文件打开、URL 打开、剪贴板、reloadPath、storage、重启。
- 通过 `PropertiesComponent` 实现 global/workspace 存储。
- 监听打开文件变化并推送 `updateOpenedFiles`。
- 处理 JetBrains 原生拖拽，向 WebGUI 推送 `insertPaths` / `pastePath`。

## 双端差异

| 能力          | VSCode                           | JetBrains                           |
| ------------- | -------------------------------- | ----------------------------------- |
| UI 容器       | Webview iframe                   | JCEF browser                        |
| bridge server | Node `http.createServer`         | `com.sun.net.httpserver.HttpServer` |
| Remote 支持   | `asExternalUri()`                | 本地 IDE 语义                       |
| 存储          | `globalState/workspaceState/Map` | `PropertiesComponent/Session.mem`   |
| 重启          | reload window                    | restart IDE                         |
| 更新          | 支持 GitHub Release `.vsix` 更新 | 暂未对齐                            |
| 打开文件列表  | `FileMonitor`                    | `IdeOpenFilesUpdater`               |

## URL 注入

宿主加载 WebGUI 时会在 `/app` URL 上附加：

- `ideBridge`
- `ideBridgeToken`

VSCode 还会处理：

- `mode`
- cache buster，例如插件版本。
- external URI tunnel。

JetBrains 可能附加：

- `jcefScrollMultiplier`

## 维护注意点

- WebGUI 新增宿主能力时，必须明确 VSCode 和 JetBrains 是否都支持。
- 更新能力目前主要是 VSCode 独有，WebGUI 需要优雅处理 JetBrains 缺失。
- 不要删除 VSCode 的 SW/CSP/Remote 兼容代码；这些看似“包装细节”，实际是插件可用性的关键。
