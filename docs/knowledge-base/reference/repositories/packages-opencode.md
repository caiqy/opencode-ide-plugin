# 仓库参考：packages/opencode（核心后端 + WebGUI）

> 纯事实提取。本文自足记录 `packages/opencode` 的后端 fork 关注点、WebGUI 架构、模块覆盖矩阵和上游同步风险。

## 定位

上游 opencode 核心后端 + 本 fork 的 WebGUI React SPA。后端负责 HTTP routes、session/provider/agent/tool、storage、event bus、CLI；WebGUI 是 IDE 内使用的聊天与配置界面，由后端在 `/app` 本地托管。

## 技术栈

- TypeScript 5.8.2，Bun 1.3.11（主运行时/包管理器），Node.js 22 备选
- HTTP：Hono 4.10.7；Effect 4.0.0-beta；ORM：Drizzle 1.0.0-beta
- WebGUI：React 19.1 + Vite 7.1.4 + Tailwind 4.1.16；富文本 Lexical 0.37；schema `zod` 4.1.8
- 测试：后端 `bun test`；WebGUI Vitest 4 + Testing Library 16

> 完整依赖清单见 [codebase/STACK.md](../../../../codebase/STACK.md)。

## 架构分层

```text
IDE Host（VSCode / JetBrains）
  └─ Webview / JCEF
      └─ WebGUI React SPA（/app）
          ├─ IDE Bridge（宿主能力）
          ├─ SDK Client（opencode HTTP API）
          └─ SSE Event Stream（opencode Bus events）
```

WebGUI 不是上游 TUI 的替代，而是与 TUI 并存的 React SPA，用于浏览器、VSCode webview、JetBrains JCEF 中的 IDE 友好聊天和配置体验。相关设计背景见 [architecture-overview](../../explanation/architecture-overview.md) 与 [ide-bridge-design](../../explanation/ide-bridge-design.md)。

## 两个子区域

### 后端 `packages/opencode/src/`

上游主体不逐条展开。本 fork 关注的适配点集中在：

| 区域 | 关键文件 |
|------|----------|
| `/app` 本地托管 | `src/webgui/server/app.ts`、`src/webgui/embed.generated.ts`、`src/server/server.ts` |
| Config overlay/patch | `src/config/config.ts`、`src/config/paths.ts` |
| MCP enable/tool-enable | `src/mcp/index.ts`、`src/server/routes/mcp.ts` |
| Skill permission overlay | `src/skill/index.ts`、`src/permission/index.ts`、`src/session/tool-permission.ts` |
| Agent 配置热重载 | `src/server/routes/instance/httpapi/handlers/instance.ts` |
| Provider/SSE 兼容补丁 | `src/provider/provider.ts` |
| Stream timeout retry | `src/session/retry.ts`、`src/session/status.ts` |
| Session prompt 附件分流 | `src/session/prompt.ts` |
| generate_image | `src/tool/generate-image*`、`src/session/generated-image*`、`src/server/routes/instance/generated-image.ts` |
| 工具安全边界 | `src/tool/external-directory.ts` |
| 前台读取优先 | `src/session/summary-scheduler*.ts` |
| non-git project identity | `src/project/project.ts`、`src/project/schema.ts` |

#### 下游适配点与高风险文件

这些改动不是普通 WebGUI 代码，而是为了 IDE 插件可用而对 opencode 底层做的下游适配。同步上游时必须保留。适配用途和业务约束分别见业务文档：[/app 本地托管](../business/embedded-webgui-serving.md)、[状态面板/MCP/Skills](../business/status-panel.md)、[Agent 配置](../business/agent-config.md)、[Provider 与 stream 恢复](../business/stream-error-recovery.md)、[图片生成](../business/generated-image.md)、[工具安全边界](../business/tool-safety-boundary.md)、[前台读取优先](../business/foreground-read-priority.md)、[项目身份](../business/project-identity.md)、[上游兼容](../business/upstream-compatibility.md)。

| 适配点 | 必须保留的关键文件 |
|--------|--------------------|
| `/app` 本地 WebGUI 挂载 | `packages/opencode/src/webgui/server/app.ts`、`packages/opencode/src/webgui/embed.generated.ts`、`packages/opencode/src/server/server.ts` |
| Config overlay / patch | `packages/opencode/src/config/config.ts`、`packages/opencode/src/config/paths.ts` |
| MCP enable / tool-enable | `packages/opencode/src/mcp/index.ts`、`packages/opencode/src/server/routes/mcp.ts`、`packages/opencode/webgui/src/lib/api/sdkClient.ts` |
| Skill permission overlay | `packages/opencode/src/config/config.ts`、`packages/opencode/src/permission/index.ts`、`packages/opencode/src/server/routes/instance/index.ts`、`packages/opencode/src/server/routes/instance/httpapi/groups/instance.ts`、`packages/opencode/src/session/prompt.ts`、`packages/opencode/src/session/system.ts`、`packages/opencode/src/session/tool-permission.ts`、`packages/opencode/src/skill/index.ts`、`packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.ts` |
| Agent 配置热重载 | `packages/opencode/src/server/routes/instance/httpapi/handlers/instance.ts` |
| Provider / Anthropic SSE 兼容补丁 | `packages/opencode/src/provider/provider.ts` |
| Stream timeout auto-retry | `packages/opencode/src/session/retry.ts`、`packages/opencode/src/session/status.ts`、`packages/opencode/webgui/src/components/TypingIndicator.tsx` |
| Session prompt 的 IDE 附件处理 | `packages/opencode/src/session/prompt.ts` |
| `generate_image` 与 generated image 项目文件 | `packages/opencode/src/tool/generate-image.ts`、`packages/opencode/src/tool/generate-image/*`、`packages/opencode/src/session/generated-image*.ts`、`packages/opencode/src/server/routes/instance/generated-image.ts`、`packages/opencode/webgui/src/components/parts/ToolPart/ToolImageAttachments.tsx`、`packages/opencode/webgui/src/components/MarkdownRenderer.tsx`、`packages/opencode/webgui/src/components/parts/ImageOverlay.tsx` |
| 工具安全边界 | `packages/opencode/src/tool/external-directory.ts` |
| 前台读取优先于后台 diff | `packages/opencode/src/session/summary-scheduler.ts`、`packages/opencode/src/session/summary-scheduler-foreground.ts`、`packages/opencode/src/server/routes/instance/httpapi/session.ts`、`packages/opencode/src/server/routes/instance/session.ts`、`packages/opencode/webgui/src/hooks/useSessionVisibilitySync.ts`、`packages/opencode/webgui/src/state/useSessionActivation.ts` |
| non-git project identity | `packages/opencode/src/project/project.ts`、`packages/opencode/src/project/schema.ts`、`packages/opencode/test/project/project.test.ts` |
| Diff 主线回归测试边界 | `packages/opencode/test/server/httpapi-session.test.ts`、`packages/opencode/test/session/summary-scheduler.test.ts`、`packages/opencode/webgui/src/hooks/useSessionVisibilitySync.test.tsx`、`packages/opencode/webgui/src/state/useSessionActivation.test.tsx`、`packages/opencode/webgui/src/state/MessagesContext.pagination.test.tsx`、`packages/opencode/webgui/src/components/MessageInput/FooterPanels.test.tsx`、`packages/opencode/webgui/src/components/FileChangesPanel.test.tsx` |

上游同步高风险文件：`packages/opencode/src/config/config.ts`、`packages/opencode/src/mcp/index.ts`、`packages/opencode/src/provider/provider.ts`、`packages/opencode/src/server/server.ts`、`packages/opencode/src/session/message-v2.ts`、`packages/opencode/src/session/compaction.ts`、`packages/opencode/src/skill/index.ts`、`packages/opencode/src/tool/external-directory.ts`、`packages/opencode/src/session/generated-image.ts`、`packages/opencode/src/session/summary-scheduler-foreground.ts`、`packages/opencode/src/session/tool-permission.ts`。

同步后最低验证：`/app` 路由仍存在且顺序正确；WebGUI 能打开且 SSE 能连接；IDE bridge 参数能注入并连接；scoped storage 可读写；MCP/Skill 开关能显示并调用；插件内写文件后 IDE 能刷新；`@文件` mention 对文本/PDF/图片/其他二进制的分流符合 IDE 场景；切换当前会话时首屏消息/历史扫描/当前会话 diff 不被后台 diff 抢占；`generate_image` 能生成项目内图片附件并编辑 readonly/frozen image input array；generated-image 路由和 Markdown/tool attachment 预览都带当前实例目录上下文；VSCode `OPENCODE_UI_VERSION` 与 JetBrains `getExtensionVersion` 来自宿主真实版本；JetBrains 空 Marketplace 查询结果不会保留旧 cached update。

### WebGUI `packages/opencode/webgui/src/`

| 目录 | 内容 |
|------|------|
| `main.tsx`、`App.tsx` | React 入口、Provider 装配、SSE、全局快捷键、Host→UI 消息 |
| `lib/api/` | `sdkClient.ts`（SDK 二次封装）、`events.ts`（SSE）、`useSessionEvents.ts` |
| `lib/ideBridge.ts` | IDE bridge 客户端 |
| `state/` | Session/Messages/Project/Providers/Theme/Toast/Update/UISettings/SubtaskDrawer context + `tabStore`/`tabPolicy`/`scopedStorage` + `repo/` |
| `state/repo/` | `draftRepo`、`tabsRepo`、`selectionRepo`、`themeRepo`、`modelPrefsRepo`、`quickPhraseRepo`（scoped storage 真源） |
| `components/` | 聊天、输入、Header、设置、状态面板、子任务抽屉、diff、工具卡片等 UI |
| `hooks/`、`utils/`、`config/` | 通用 hook、路径/剪贴板工具、快捷键定义 |

#### WebGUI 构建与运行链路

插件场景下不能依赖 `https://app.opencode.ai`。本项目将 WebGUI 构建产物嵌入 opencode 包，并由本地 server 在 `/app` 提供。`/app` 返回 `index.html`，`/app/assets/*` 返回嵌入资源，无扩展名 SPA 路径 fallback 到 `index.html`，`/app/api/*` 不回流旧兼容接口，且 `/app` 路由必须早于 workspace middleware。

开发模式有两条独立链路：正式链路由 opencode server 提供 embedded WebGUI；开发链路由 VSCode 启动 `packages/opencode/webgui` 的 Vite dev server 做浏览器/HMR 联调。Vite dev 通过 Node 侧发现 backend + Vite proxy 转发 API/SSE；候选端口顺序为 `4300`、`4096`、`4097`、`4098`、`4099`、`4100`，只探测 `127.0.0.1`，并通过 `/global/config` 做结构化校验。`OPENCODE_DEV_DIRECTORY_OVERRIDE` 只在 Vite `serve` 模式注入 `x-opencode-directory`，不进入正式 `vite build` 和 embedded `/app`。

WebGUI 通过 `sdkClient` 访问 opencode 核心 API。迁移目标是优先使用上游官方 API / SDK，而不是依赖历史 `/app/api/*` 兼容层。`sdkClient.ts` 包装 `/global/config`、session list/messages、分页 cursor、revert-aware retry、Provider OAuth、permission/question、MCP server/tool 开关与 Skills 开关，保持组件调用形状稳定。

WebGUI 支持 IDE webview 与普通浏览器。浏览器模式下隐藏依赖 IDE bridge 的设置入口，文件打开回退为下载链接，剪贴板使用标准 Clipboard API，图片保存回退为下载链接；是否进入降级由 `ideBridge` 是否可用决定。

#### WebGUI 模块覆盖矩阵

| 源码模块 | 对应文档 | 维护重点 |
| -------- | -------- | -------- |
| `src/main.tsx`、`src/App.tsx` | [architecture-overview](../../explanation/architecture-overview.md)、[session-chat](../business/session-chat.md) | Provider 装配、SSE、全局快捷键、Host → UI 消息 |
| `src/lib/api/sdkClient.ts`、`events.ts`、`useSessionEvents.ts` | [embedded-webgui-serving](../business/embedded-webgui-serving.md)、[session-chat](../business/session-chat.md)、[upstream-compatibility](../business/upstream-compatibility.md) | SDK 包装、事件流、兼容 API 与上游适配 |
| `src/lib/ideBridge.ts`、`src/state/IdeBridgeContext.tsx` | [ide-bridge](../business/ide-bridge.md)、[host-webview-integration](../business/host-webview-integration.md) | Host bridge 协议、打开文件、宿主存储、opened files 同步 |
| `src/state/scopedStorage.ts`、`src/state/repo/*` | [scoped-storage](../business/scoped-storage.md)、[settings-panel](../business/settings-panel.md) | scoped storage、tabs/drafts/selection/theme/model/quick phrases 真源 |
| `src/state/SessionContext.tsx`、`MessagesContext.tsx`、`tabStore.ts`、`tabPolicy.ts` | [session-chat](../business/session-chat.md) | 会话、消息、分页、标签、selection 恢复、reasoning/busy 状态 |
| `src/state/ProjectContext.tsx`、`ProvidersContext.tsx`、`ThemeContext.tsx`、`ToastContext.tsx`、`UpdateContext.tsx`、`UISettingsContext.tsx` | [embedded-webgui-serving](../business/embedded-webgui-serving.md)、[settings-panel](../business/settings-panel.md)、[version-update](../business/version-update.md) | 项目路径、Provider 刷新、主题、通知、更新、UI 偏好 |
| `src/state/SubtaskDrawerContext.tsx` | [subtask-drawer](../business/subtask-drawer.md) | 子任务抽屉状态与切换 |
| `src/components/common/`：`Button`、`Card`、`IconButton`、`Input`、`Modal`、`Select` | [architecture-overview](../../explanation/architecture-overview.md) | 通用 UI 组件库，被全站复用 |
| `src/components/CompactHeader/` | [session-chat](../business/session-chat.md)、[status-panel](../business/status-panel.md)、[settings-panel](../business/settings-panel.md) | 会话工作台、标签管理、状态面板、设置/更新/重启入口 |
| `src/components/MessageList/` | [session-chat](../business/session-chat.md) | 消息渲染、Markdown、代码块、推理块、错误/回滚/复制保真、滚动锚定 |
| `src/components/MessageInput/` | [message-input](../business/message-input.md)、[session-chat](../business/session-chat.md) | 输入增强、Lexical 编辑器、附件、快速短语、待办面板、拖拽 |
| `src/components/attachment/`、`mention/`、`command/` | [message-input](../business/message-input.md) | Lexical 插件：附件节点、mention 检测与弹窗、命令检测与弹窗 |
| `src/components/parts/`：`ToolPart/`、`AgentPart`、`FilePart`、`PatchPart`、`RetryPart`、`SnapshotPart`、`ImageOverlay`、`ImagePreview` | [tool-rendering](../business/tool-rendering.md)、[generated-image](../business/generated-image.md) | 工具卡片标题/权限/问题展示、diff/patch 浏览、图片预览/保存 |
| `src/components/SubtaskDrawer/` | [subtask-drawer](../business/subtask-drawer.md) | 子任务抽屉：独立消息列表、宽度拖拽、阻塞状态 |
| `src/components/DiffModal/` | [diff-file-changes](../business/diff-file-changes.md) | 多文件 diff 浏览、文件间导航、变更内容查看 |
| `src/components/SettingsPanel/` | [settings-panel](../business/settings-panel.md) | 设置面板壳层、标签导航、未保存变更保护 |
| `src/components/settings/`：`GeneralTab`、`AdvancedTab`、`QuickPhrasesTab`、`AgentConfigTab` | [settings-panel](../business/settings-panel.md)、[agent-config](../business/agent-config.md)、[provider-settings](../business/provider-settings.md) | 通用设置、高级配置、快捷短语管理、Agent 配置 |
| `src/components/` 全局壳层 | [embedded-webgui-serving](../business/embedded-webgui-serving.md)、[session-chat](../business/session-chat.md)、[settings-panel](../business/settings-panel.md) | 版本门禁、加载守卫、离线提示、错误边界、通知、命令面板、模型/Agent 选择器 |
| `src/hooks/` | [session-chat](../business/session-chat.md)、[settings-panel](../business/settings-panel.md)、[diff-file-changes](../business/diff-file-changes.md) | 文件打开、命令/mention 搜索与导航、用量估算、diff 合并、键盘/快捷键、可见性同步 |
| `src/lib/` | [message-input](../business/message-input.md)、[tool-rendering](../business/tool-rendering.md) | 拖拽协调、文件处理、键盘兼容、消息存储/格式化、工具 part 解析 |
| `src/utils/` | [ide-bridge](../business/ide-bridge.md)、[host-actions](../business/host-actions.md) | 路径归一化、剪贴板兼容、CSS 工具类、格式化、校验 |
| `src/config/shortcuts.ts` | [session-chat](../business/session-chat.md) | 快捷键定义，全局键盘处理 |

## 宿主插件模块索引

| VSCode 模块（`hosts/vscode-plugin/src/`） | 对应文档 | 维护重点 |
| ---------------------------------------- | -------- | -------- |
| `extension.ts`、`globals.ts` | [backend-launch](../business/backend-launch.md) | 插件激活入口、全局单例 |
| `backend/`：`BackendLauncher`、`ResourceExtractor`、`kill.ts` | [backend-launch](../business/backend-launch.md) | 启动 opencode 后端、解压内嵌 binary、进程清理 |
| `ui/`：`WebviewController`、`WebviewManager`、`ActivityBarProvider`、`CommunicationBridge`、`IdeBridgeServer`、`loading.ts` | [ide-bridge](../business/ide-bridge.md)、[host-webview-integration](../business/host-webview-integration.md) | webview 承载、IDE bridge 服务、面板/活动栏切换、加载页 |
| `commands/`：`AddToContextCommand`、`AddLinesToContextCommand`、`PastePathCommand` | [context-insertion](../business/context-insertion.md)、[host-actions](../business/host-actions.md) | 右键菜单命令、文件/行范围添加上下文、粘贴路径 |
| `update/`：`ReleaseChecker`、`UpdateInstaller`、`UpdateService` | [version-update](../business/version-update.md) | GitHub Release 检查、.vsix 下载安装、更新状态机 |
| `settings/`：`SettingsManager` | [settings-panel](../business/settings-panel.md) | customCommand / minVersion 配置管理 |
| `utils/`：`ErrorHandler`、`FileMonitor`、`PathInserter`、`RecoveryUtils` | [host-actions](../business/host-actions.md) | 错误处理、打开文件监控、路径插入、SW 恢复 |

| JetBrains 模块（`hosts/jetbrains-plugin/.../opencode/`） | 对应文档 | 维护重点 |
| ------------------------------------------------------- | -------- | -------- |
| `ui/`：`ChatToolWindowFactory`、`IdeBridge`、`IdeBridgeStorageBackend`、`IdeOpenFilesUpdater`、`DragAndDropInstaller`、`PathInserter`、`BackendLogsVisibilityController` | [ide-bridge](../business/ide-bridge.md)、[host-webview-integration](../business/host-webview-integration.md) | 工具窗口、IDE bridge、存储后端、打开文件同步、拖拽安装、日志懒显示 |
| `backendprocess/`：`BackendLauncher`、`BackendProcess`、`TerminalBackendProcess`、`TerminalOutputCapture` | [backend-launch](../business/backend-launch.md) | 后端进程抽象、终端输出捕获、连接地址发现 |
| `actions/`：`EditorAddToContextAction`、`EditorAddLinesToContextAction`、`ProjectAddToContextAction`、`ProjectPastePathAction` | [context-insertion](../business/context-insertion.md)、[host-actions](../business/host-actions.md) | 编辑器/项目视图右键菜单、文件/行范围添加上下文 |
| `settings/`：`OpenCodeConfigurable`、`OpenCodeSettings` | [settings-panel](../business/settings-panel.md) | 插件设置页、持久化配置服务 |
| `update/`：`MarketplaceVersionSource`、`PluginUpdateService`、`PluginUpdateModels` | [version-update](../business/version-update.md) | JetBrains Marketplace 版本查询、更新状态管理 |
| `util/`：`ResourceExtractor` | [backend-launch](../business/backend-launch.md) | 解压内嵌 backend binary |

## 命名约定（本包）

- 组件 PascalCase，hook `use` 前缀，context `Context` 后缀，repo `Repo` 后缀
- 上游 schema `snake_case + .sql.ts`（Drizzle）；表/列 snake_case，join 列 `<entity>_id`
- 模块用扁平 top-level export + 文件底部 `export * as Foo`（禁 `export namespace`）

> 详见 [CONVENTIONS.md](../../../../CONVENTIONS.md) 和 `packages/opencode/AGENTS.md`。

## 构建与验证

后端（工作目录 `packages/opencode`）：

```powershell
bun typecheck
bun test --timeout 30000
bun run script/build.ts --single
```

WebGUI（工作目录 `packages/opencode/webgui`）：

```powershell
bun typecheck
bun test:run
bun build
```

> 不要从仓库根运行 `bun test`（root package 故意报错）。DB migration：`bun run db generate --name <slug>`。

## WebGUI 构建嵌入链路

`webgui/` → Vite → `webgui-dist/` → 嵌入脚本 → `src/webgui/embed.generated.ts` → `/app` 内存托管。修改构建路径/asset 命名时必须同步嵌入脚本与 `webgui/server/app.ts`。
