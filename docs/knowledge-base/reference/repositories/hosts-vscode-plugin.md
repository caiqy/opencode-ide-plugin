# 仓库参考：hosts/vscode-plugin（VSCode 宿主插件）

## 定位

VSCode 插件在 activity bar / editor panel 的 webview 中承载 WebGUI，不只是 iframe 包装。它负责 activation、backend binary 解析、`opencode serve` 进程生命周期、bridge server、上下文命令、设置、诊断、更新流、重启，以及 Remote-SSH/tunnel 兼容。

IDE bridge 协议的业务说明见 [IDE Bridge](../business/ide-bridge.md)，宿主启动与 WebView 集成可参考 [backend launch](../business/backend-launch.md) 和 [host webview integration](../business/host-webview-integration.md)。

## 技术栈

- TypeScript（`^5.0.0`），VSCode Extension API `^1.74.0`
- 运行时：Node.js（VSCode 宿主进程），开发 Node.js 18+
- 包管理：**pnpm 9.0.0**（区别于根目录 Bun）
- 测试：Mocha 10.2.0 + `@vscode/test-electron` + Sinon

## 身份标识（`package.json`）

- `name`: `opencode-ui`，`publisher`: `caiqy` → Unique Identifier `caiqy.opencode-ui`
- `displayName`: `OpenCode UI (unofficial)`
- 版本示例 `26.6.2700`（遵循「版本规则」`YY.M.DDNN`）
- 只发 Visual Studio Marketplace，不发 Open VSX；发布 5 个平台定向 `.vsix`，无通用 fallback 包

## 目录结构 `src/`

| 目录 | 关键文件 | 职责 |
|------|----------|------|
| （根） | `extension.ts`、`globals.ts` | 激活入口、全局单例 |
| `backend/` | `BackendLauncher.ts`、`ResourceExtractor.ts`、`kill.ts` | 启动后端、解压内嵌 binary、进程清理 |
| `ui/` | `WebviewController.ts`、`WebviewManager.ts`、`ActivityBarProvider.ts`、`CommunicationBridge.ts`、`IdeBridgeServer.ts`、`loading.ts` | webview 承载、bridge 服务、面板/活动栏切换、加载页 |
| `commands/` | `AddToContextCommand.ts`、`AddLinesToContextCommand.ts`、`PastePathCommand.ts` | 右键菜单命令 |
| `update/` | `ReleaseChecker.ts`、`UpdateInstaller.ts`、`UpdateService.ts`、`version.ts` | GitHub Release 检查、`.vsix` 下载安装、更新状态机、语义版本比较 |
| `settings/` | `SettingsManager.ts` | `opencode.customCommand` / `opencode.minVersion` 配置管理 |
| `utils/` | `ErrorHandler.ts`、`FileMonitor.ts`、`PathInserter.ts`、`RecoveryUtils.ts`、`extensionIdentity.ts` | 错误处理、打开文件监控、路径插入、SW 恢复 |
| `types/` | `UnifiedMessage.ts` | 消息类型 |

## `package.json` 契约

- **5 个 commands**：`openPanel`、`addFileToContext`、`addLinesToContext`、`pastePath`、`showDiagnostics`
- **menus 注册在 5 个位置**：`view/title`、`explorer/context`、`editor/context`、`editor/title/context`、`openEditors/context`
- **2 个快捷键**：`Ctrl+'`（`addFileToContext`，editorTextFocus）、`Ctrl+Shift+'`（`addLinesToContext`，需选中）
- activationEvents：`onView:opencode.main` + 4 个 `onCommand:*`
- view：`opencode.main`（webview，`retainContextWhenHidden: true`）
- 配置项：`opencode.customCommand`、`opencode.minVersion`

> 新增命令须同步 `contributes.commands` 和 `contributes.menus`。

## 特有约定

- backend 启动时注入 `OPENCODE_UI_VERSION=<extension.version>`；空版本不注入并移除继承环境中的 stale 值 → 生成 `opencode-ui/<version>` user agent
- 通过 `asExternalUri()` 兼容 Remote-SSH/tunnel
- 存储后端：`global`→`context.globalState`，`workspace`→`context.workspaceState`，`mem`→`Map`
- 重启：`workbench.action.reloadWindow`，`restartMode = "window"`
- panel 与 activity bar 共用 `WebviewController`
- 本地开发端口固定 `4300`（`.vscode/launch.json` 的 `Backend: source web 4300`）

## VSCode 稳定性补丁

- Service Worker `InvalidState` 使用双层 retry 恢复，避免 webview 缓存状态损坏后白屏
- webview dispose/recreate 做竞态保护，避免旧实例销毁期间覆盖新实例状态
- CSP 动态拼接实际 origin，保证本地、Remote-SSH、tunnel、external URI 场景都能加载资源
- 不要删除 SW/CSP/Remote 兼容代码；这些是插件可用性关键路径

## IDE Bridge 消息清单

传输模型：Host 在 `127.0.0.1:0` 启动 HTTP server；WebGUI 通过 `POST /idebridge/{sessionId}/send?token=<token>` 发请求，Host 通过 `GET /idebridge/{sessionId}/events?token=<token>` 用 SSE 推送事件。鉴权依赖 `sessionId + token`，Host 每 15 秒发送 SSE 注释 ping 保活。协议字段、connected 元数据和 WebGUI 消费点见 [IDE Bridge](../business/ide-bridge.md)。

UI → Host 请求：

- `openFile`：在 IDE 中打开文件，支持行号/范围
- `openUrl`：用宿主打开外部 URL
- `reloadPath`：文件写入后刷新 IDE 文件系统视图
- `clipboardWrite`：写系统剪贴板
- `saveImage`：保存 data URL、remote URL 或 generated-image relative URL；取消返回 `{ cancelled: true }`
- `restartHost`：重载 VSCode window
- `ensureAndOpenFile`：确保文件存在并打开
- `storageGet` / `storageSet`：读写 `global | workspace | mem` scoped storage
- `getExtensionVersion`：返回宿主插件真实版本
- `setProjectDirectory`：切换项目目录
- `showDiagnostics`：显示诊断面板
- 更新请求：`getUpdateInfo`、`checkForUpdates`、`installUpdate`

Host → UI 推送：

- `insertPaths`：将文件路径插入输入框
- `pastePath`：插入目录路径
- `updateOpenedFiles`：同步 IDE 当前打开文件与当前文件
- 更新事件：`updateAvailable`、`downloading`、`installing`、`success`、`error`

## 构建与验证

工作目录 `hosts/vscode-plugin`：

```powershell
pnpm run compile
pnpm run lint
pnpm test
pnpm run package:dev
```

> Windows VSIX 正式打包走「打包下一个版本」两步流程，见 `memory/context/vscode-packaging.md`：先校验版本号（非空、两 package 一致、日期段=今天），再构建打包，禁用 `node -e` one-liner。
