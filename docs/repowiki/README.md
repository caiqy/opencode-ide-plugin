# OpenCode IDE Plugin RepoWiki

本 RepoWiki 只梳理本项目的主体功能：WebGUI 插件体验、IDE bridge、VSCode/JetBrains 宿主包装，以及为了让插件可用而对 opencode 底层做的适配。opencode 本身作为底层依赖，不逐条展开上游已有能力；只有会影响插件维护、上游同步或 IDE 场景的改动会单独记录。

## 阅读路线

1. [WebGUI 架构与本地托管](./01-webgui-architecture.md)
2. [IDE Bridge 协议](./02-ide-bridge.md)
3. [状态持久化与 scoped storage](./03-state-storage.md)
4. [会话、标签页与聊天体验](./04-session-chat.md)
5. [子任务、工具、MCP 与 Skills](./05-subtasks-tools-mcp.md)
6. [设置、更新与中文本地化](./06-settings-update-localization.md)
7. [VSCode 与 JetBrains 宿主插件](./07-host-plugins.md)
8. [上游适配边界与同步风险](./08-upstream-adaptations.md)

## 项目定位

本项目是在 opencode 基础上增加 IDE 内使用体验：

- opencode 后端继续负责会话、Provider、Agent、MCP、权限、配置、文件操作等底层能力。
- WebGUI 提供浏览器/IDE webview 可用的聊天界面、会话标签、状态面板、设置、更新提示等插件主体体验。
- VSCode 与 JetBrains 插件负责启动后端、承载 WebGUI、提供 IDE 能力桥接。
- server 侧通过 `/app` 本地托管 WebGUI 静态资源，避免依赖上游远端网页。

## 边界原则

- **写主体功能，不写上游百科：** 例如 `session.messages`、Bus/SSE、Provider/MCP 内部机制不单独铺开，只在 WebGUI 如何消费它们时说明。
- **写适配点，不写所有源码：** 例如 `config overlay`、MCP enable/tool-enable、Anthropic SSE patch 是同步风险点，应在适配边界中记录。
- **写维护入口：** 每个页面都列出关键文件，方便后续定位。

## 近期高风险主题索引

近半个月新增或收口的本地 fork 逻辑，后续同步上游时优先检查：

- **图片生成 / 预览 / 保存链路：** 见 [01](./01-webgui-architecture.md)、[02](./02-ide-bridge.md)、[04](./04-session-chat.md)、[05](./05-subtasks-tools-mcp.md)、[08](./08-upstream-adaptations.md)。重点是 `generate_image`、`.opencode/generated-images`、generated-image 路由、Markdown/tool attachment 预览、ImageOverlay 与 host `saveImage`。
- **宿主版本 / 更新 / bridge 能力：** 见 [02](./02-ide-bridge.md)、[06](./06-settings-update-localization.md)、[07](./07-host-plugins.md)、[08](./08-upstream-adaptations.md)。重点是 `getExtensionVersion`、`OPENCODE_UI_VERSION`、JetBrains public Marketplace 查询、空 Marketplace 结果和 plugin identity 对齐。
- **non-git 项目隔离与 dev 路径覆盖：** 见 [01](./01-webgui-architecture.md)、[03](./03-state-storage.md)、[07](./07-host-plugins.md)、[08](./08-upstream-adaptations.md)。重点是 non-git project id 按目录派生，workspace 状态不再坍缩到 global project。
- **WebGUI 稳定性补丁：** 见 [04](./04-session-chat.md)、[05](./05-subtasks-tools-mcp.md)。重点是 scroll follow / anchoring、aborted message load retry、assistant completed time、bash running title、StatusPopover backend 地址和 overlay 阴影点击关闭。

## 核心代码入口

- WebGUI：`packages/opencode/webgui/src/`
- WebGUI 嵌入服务：`packages/opencode/src/webgui/`
- opencode server 挂载：`packages/opencode/src/server/server.ts`
- VSCode 插件：`hosts/vscode-plugin/src/`
- JetBrains 插件：`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/`

## WebGUI 模块覆盖矩阵

| 源码模块 | 对应页面 | 维护重点 |
| -------- | -------- | -------- |
| `src/main.tsx`、`src/App.tsx` | [01](./01-webgui-architecture.md)、[04](./04-session-chat.md) | Provider 装配、SSE、全局快捷键、Host → UI 消息 |
| `src/lib/api/sdkClient.ts`、`events.ts`、`useSessionEvents.ts` | [01](./01-webgui-architecture.md)、[04](./04-session-chat.md)、[08](./08-upstream-adaptations.md) | SDK 包装、事件流、兼容 API 与上游适配 |
| `src/lib/ideBridge.ts`、`src/state/IdeBridgeContext.tsx` | [02](./02-ide-bridge.md) | Host bridge 协议、打开文件、宿主存储、opened files 同步 |
| `src/state/scopedStorage.ts`、`src/state/repo/*` | [03](./03-state-storage.md)、[06](./06-settings-update-localization.md) | scoped storage、tabs/drafts/selection/theme/model/quick phrases 真源 |
| `src/state/SessionContext.tsx`、`MessagesContext.tsx`、`tabStore.ts`、`tabPolicy.ts` | [04](./04-session-chat.md) | 会话、消息、分页、标签、selection 恢复、reasoning/busy 状态 |
| `src/state/ProjectContext.tsx`、`ProvidersContext.tsx`、`ThemeContext.tsx`、`ToastContext.tsx`、`UpdateContext.tsx`、`UISettingsContext.tsx` | [01](./01-webgui-architecture.md)、[06](./06-settings-update-localization.md) | 项目路径、Provider 刷新、主题、通知、更新、UI 偏好 |
| `src/state/SubtaskDrawerContext.tsx` | [05](./05-subtasks-tools-mcp.md) | 子任务抽屉状态与切换 |
| `src/components/common/`：`Button`、`Card`、`IconButton`、`Input`、`Modal`、`Select` | [01](./01-webgui-architecture.md) | 通用 UI 组件库，被全站复用 |
| `src/components/CompactHeader/`：包含 `index.tsx`、`TabBar`、`Tab`、`TabContextMenu`、`SessionDropdown`、`SessionList`、`SessionItem`、`ActionButtons`、`StatusPopover`、`StatusIndicator`、`UsageDisplay`、`hooks/` | [04](./04-session-chat.md)、[05](./05-subtasks-tools-mcp.md)、[06](./06-settings-update-localization.md) | 会话工作台、标签管理、状态面板、设置/更新/重启入口 |
| `src/components/MessageList/`：包含 `index.tsx`、`MessageRow`、`MessagePart`、`AssistantMeta`、`ReasoningPart`、`CollapsiblePart`、`RevertBanner`、`RevertSummary`、`SessionErrorPart`、`ScrollToBottomButton`、`TextPart`、`Parts/QuestionPart/`、滚动与历史 hooks | [04](./04-session-chat.md) | 消息渲染、Markdown、代码块、推理块、错误/回滚/复制保真、滚动锚定 |
| `src/components/MessageInput/`：包含 `index.tsx`、`EditorConfig`、`EditorContent`、`EditorToolbar`、`FooterPanels`、`MessageActions`、`QuickPhraseBar`、`TodosPanel`、`hooks/`（`useDragDrop`、`useMessageInput` 等） | [04](./04-session-chat.md) | 输入增强、Lexical 编辑器、附件、快速短语、待办面板、拖拽 |
| `src/components/attachment/`、`mention/`、`command/` | [04](./04-session-chat.md) | Lexical 插件：附件节点、mention 检测与弹窗、命令检测与弹窗 |
| `src/components/parts/`：`ToolPart/`（含 `BashTool`、`EditTool`、`ReadTool`、`TaskTool`、`TodoTool`、`QuestionTool` 等子组件）、`AgentPart`、`FilePart`、`PatchPart`、`RetryPart`、`SnapshotPart`、`ImageOverlay`、`ImagePreview` | [05](./05-subtasks-tools-mcp.md) | 工具卡片标题/权限/问题展示、diff/patch 浏览、图片预览/保存 |
| `src/components/SubtaskDrawer/` | [05](./05-subtasks-tools-mcp.md) | 子任务抽屉：独立消息列表、宽度拖拽、阻塞状态 |
| `src/components/DiffModal/`：包含 `DiffHeader`、`DiffNavigation`、`DiffViewer`、`hooks/useDiffData` | [05](./05-subtasks-tools-mcp.md) | 多文件 diff 浏览、文件间导航、变更内容查看 |
| `src/components/SettingsPanel/`：包含 `SettingsHeader`、`SettingsFooter`、`TabBar`、`hooks/` | [06](./06-settings-update-localization.md) | 设置面板壳层、标签导航、未保存变更保护 |
| `src/components/settings/`：`GeneralTab`、`AdvancedTab`、`QuickPhrasesTab`、`AgentConfigTab` | [06](./06-settings-update-localization.md) | 通用设置、高级配置、快捷短语管理、Agent 配置 |
| `src/components/` 全局壳层：`VersionGate`、`ChatLoadGuard`、`OfflineBanner`、`ErrorBoundary`、`Toast`、`ConfirmModal`、`CommandPalette`、`KeyboardShortcutsHelp`、`ModelSelector`、`AgentSelector`、`VariantSelector`、`UpdateBanner`、`FileChangesPanel` | [01](./01-webgui-architecture.md)、[04](./04-session-chat.md)、[06](./06-settings-update-localization.md) | 版本门禁、加载守卫、离线提示、错误边界、全局通知、命令面板、模型/Agent 选择器 |
| `src/hooks/`：`useOpenFile`、`useCommandSearch`、`useMentionSearch`、`useMentionNavigation`、`useSessionUsage`、`useMergedFileDiffs`、`useProviderStore`、`useSessionVisibilitySync`、`useKeyboard`、`useKeyboardShortcuts`、`useClickOutside`、`useDebounce`、`useDropdown` | [04](./04-session-chat.md)、[06](./06-settings-update-localization.md) | 文件打开、命令/mention 搜索与导航、用量估算、diff 合并、键盘/快捷键、可见性同步 |
| `src/lib/`：`dnd.ts`、`dropCoordinator.ts`、`fileUtils.ts`、`keyboardHandler.ts`、`messagesStore.ts`、`messageFormatting.ts`、`task-part.ts`、`task-result.ts`、`partial-tool-input.ts`、`tooltipPolyfill.ts` | [04](./04-session-chat.md)、[05](./05-subtasks-tools-mcp.md) | 拖拽协调、文件处理、键盘兼容、消息存储/格式化、工具 part 解析 |
| `src/utils/`：`path.ts`、`clipboard.ts`、`classNames.ts`、`formatting.ts`、`validation.ts` | [01](./01-webgui-architecture.md)、[02](./02-ide-bridge.md) | 路径归一化、剪贴板兼容、CSS 工具类、格式化、校验 |
| `src/config/shortcuts.ts` | [04](./04-session-chat.md) | 快捷键定义，全局键盘处理 |

## 宿主插件模块索引

| VSCode 模块（`hosts/vscode-plugin/src/`） | 对应页面 | 维护重点 |
| ---------------------------------------- | -------- | -------- |
| `extension.ts`、`globals.ts` | [07](./07-host-plugins.md) | 插件激活入口、全局单例 |
| `backend/`：`BackendLauncher`、`ResourceExtractor`、`kill.ts` | [07](./07-host-plugins.md) | 启动 opencode 后端、解压内嵌 binary、进程清理 |
| `ui/`：`WebviewController`、`WebviewManager`、`ActivityBarProvider`、`CommunicationBridge`、`IdeBridgeServer`、`loading.ts` | [02](./02-ide-bridge.md)、[07](./07-host-plugins.md) | webview 承载、IDE bridge 服务、面板/活动栏切换、加载页 |
| `commands/`：`AddToContextCommand`、`AddLinesToContextCommand`、`PastePathCommand` | [07](./07-host-plugins.md) | 右键菜单命令、文件/行范围添加上下文、粘贴路径 |
| `update/`：`ReleaseChecker`、`UpdateInstaller`、`UpdateService` | [07](./07-host-plugins.md) | GitHub Release 检查、.vsix 下载安装、更新状态机 |
| `settings/`：`SettingsManager` | [07](./07-host-plugins.md) | customCommand / minVersion 配置管理 |
| `utils/`：`ErrorHandler`、`FileMonitor`、`PathInserter`、`RecoveryUtils` | [07](./07-host-plugins.md) | 错误处理、打开文件监控、路径插入、SW 恢复 |

| JetBrains 模块（`hosts/jetbrains-plugin/.../opencode/`） | 对应页面 | 维护重点 |
| ------------------------------------------------------- | -------- | -------- |
| `ui/`：`ChatToolWindowFactory`、`IdeBridge`、`IdeBridgeStorageBackend`、`IdeOpenFilesUpdater`、`DragAndDropInstaller`、`PathInserter`、`BackendLogsVisibilityController` | [02](./02-ide-bridge.md)、[07](./07-host-plugins.md) | 工具窗口、IDE bridge、存储后端、打开文件同步、拖拽安装、日志懒显示 |
| `backendprocess/`：`BackendLauncher`、`BackendProcess`、`TerminalBackendProcess`、`TerminalOutputCapture` | [07](./07-host-plugins.md) | 后端进程抽象、终端输出捕获、连接地址发现 |
| `actions/`：`EditorAddToContextAction`、`EditorAddLinesToContextAction`、`ProjectAddToContextAction`、`ProjectPastePathAction` | [07](./07-host-plugins.md) | 编辑器/项目视图右键菜单、文件/行范围添加上下文 |
| `settings/`：`OpenCodeConfigurable`、`OpenCodeSettings` | [07](./07-host-plugins.md) | 插件设置页、持久化配置服务 |
| `update/`：`MarketplaceVersionSource`、`PluginUpdateService`、`PluginUpdateModels` | [07](./07-host-plugins.md) | JetBrains Marketplace 版本查询、更新状态管理 |
| `util/`：`ResourceExtractor` | [07](./07-host-plugins.md) | 解压内嵌 backend binary |
