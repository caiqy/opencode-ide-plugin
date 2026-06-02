# IDE Bridge 协议

IDE Bridge 是 WebGUI 与 VSCode/JetBrains 宿主之间的统一通信层。它补齐浏览器环境无法直接完成的 IDE 能力，例如打开文件、写剪贴板、持久化宿主状态、重启宿主、安装更新等。

## 传输模型

Host 侧启动本地 HTTP server，监听 `127.0.0.1:0`，为每个 WebGUI 页面创建独立 session。

```text
WebGUI -> Host: POST /idebridge/{sessionId}/send?token=<token>
Host -> WebGUI: GET  /idebridge/{sessionId}/events?token=<token>  (SSE)
```

鉴权依赖 `sessionId + token`。Host 每 15 秒通过 SSE 注释 ping 保活。

关键文件：

- WebGUI client：`packages/opencode/webgui/src/lib/ideBridge.ts`
- VSCode server：`hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
- JetBrains server：`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`

## 消息结构

WebGUI 侧通用消息字段：

- `id`：请求 ID。
- `replyTo`：响应对应的请求 ID。
- `type`：消息类型。
- `payload`：请求参数。
- `timestamp`：时间戳。
- `ok` / `error`：响应状态。
- `result`：请求响应数据。

维护时不要随意改变 `replyTo/result/ok/error` 语义，否则三端协议会同时受影响。

## connected 元数据

SSE 建连后，Host 发送 `event: connected`：

- `minVersion`：插件或后端最低版本信息。
- `restartMode`：`window`（VSCode 重载窗口）或 `ide`（JetBrains 重启 IDE）。
- `customApi`：WebGUI 侧保留的能力位。

WebGUI 在 `ideBridge.ts` 中解析这些元数据，供版本门禁、重启按钮和能力判断使用。

## UI → Host 请求

两端共同支持：

- `openFile`：在 IDE 中打开文件，支持行号/范围。
- `openUrl`：用宿主打开外部 URL。
- `reloadPath`：文件写入后刷新 IDE 文件系统视图。
- `clipboardWrite`：写入系统剪贴板。
- `restartHost`：重启或重载宿主。
- `ensureAndOpenFile`：确保文件存在并打开。
- `storageGet` / `storageSet`：读写 `global | workspace | mem` scoped storage。
- `saveImage`：保存 WebGUI 图片预览中的 data URL、remote URL 或 generated-image relative URL。取消保存返回 `{ cancelled: true }`，不支持时返回明确错误。
- `getExtensionVersion`：返回宿主插件真实版本，供 WebGUI 更新 UI 和 user agent 相关展示使用。
- `setProjectDirectory`：切换项目目录。
- `showDiagnostics`：显示诊断面板。

VSCode 与 JetBrains 共同支持的更新请求：

- `getUpdateInfo`
- `checkForUpdates`
- `installUpdate`

JetBrains 更新限制：

- 只使用公开 JetBrains Marketplace release 查询作为远端版本来源。
- Marketplace 安装版可检查更新，但安装动作以打开 IDE Plugins 页面并由用户手动更新为主。
- 本地 ZIP / 开发版返回 `unsupported` 或仅支持手动检查提示。
- 空 Marketplace 结果视为当前没有可安装更新，不能保留旧 cached update。

## Host → UI 推送

常见推送：

- `insertPaths`：将文件路径插入输入框。
- `pastePath`：插入目录路径。
- `updateOpenedFiles`：同步 IDE 当前打开文件与当前文件。
- 更新事件：`updateAvailable`、`downloading`、`installing`、`success`、`error`。

消费位置：

- `packages/opencode/webgui/src/App.tsx`
- `packages/opencode/webgui/src/state/IdeBridgeContext.tsx`
- `packages/opencode/webgui/src/state/UpdateContext.tsx`

## WebGUI 使用点

- 文件打开：`packages/opencode/webgui/src/hooks/useOpenFile.ts`
- 文件变更刷新：`packages/opencode/webgui/src/state/MessagesContext.tsx`
- 宿主存储：`packages/opencode/webgui/src/state/scopedStorage.ts`
- 剪贴板 fallback：`packages/opencode/webgui/src/utils/clipboard.ts`
- 更新 UI：`packages/opencode/webgui/src/state/UpdateContext.tsx`

## 维护注意点

- 新增 bridge 消息时，必须同时评估 VSCode、JetBrains、WebGUI 三端。
- VSCode 往往先支持宿主能力，JetBrains 可能需要补齐 parity。
- `restartHost` 这类会中断 transport 的请求，应优先回复再执行破坏性动作。
- VSCode `package.json` 注册了 5 个 commands，详见 [07](./07-host-plugins.md)。
- JetBrains `plugin.xml` 注册了 4 个 action 和 6 个快捷键，详见 [07](./07-host-plugins.md)。
