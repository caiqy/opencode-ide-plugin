# 能力总索引（Capabilities Index）

> 本文件是本知识库的**骨干**：列出 OpenCode IDE Plugin 当前所有能力，每一项都能指向代码真源。
> 新增/移除能力时，先改这里，再写/删对应的 `reference/business/*.md`。

## 如何使用

- **找一项能力的细节**：查下表 → 打开 `业务文档` 列指向的 `reference/business/*.md`。
- **确认代码真源**：每行 `代码入口` 列给出可定位的文件/目录；用 `codegraph_search` 或直接打开确认。
- **判断是否漂移**：`基线` 列标注该能力是否在 2026-05-18 基线清单（`specs/000-existing-capabilities/overview.md`）中。标 `新增` 的是基线之后补的，是历史文档最容易漏或写错的部分。

## 能力清单

本项目是 opencode 的 IDE fork。**上游 opencode 的底层能力（会话存储、Provider SDK、Bus/SSE、MCP 客户端、Permission 判定、Effect service）不在本索引中逐条展开**——只记录本 fork 为 IDE/WebGUI 场景新增或适配的能力。上游边界见 `business/upstream-compatibility.md`。

### A. WebGUI 托管与运行时

| # | 能力 | 代码入口 | 业务文档 | 基线 |
|---|------|----------|----------|------|
| A1 | 嵌入式 WebGUI `/app` 托管 | `packages/opencode/src/webgui/server/app.ts`、`src/server/server.ts`、`webgui/vite.config.ts` | [embedded-webgui-serving](business/embedded-webgui-serving.md) | 基线 |
| A2 | 浏览器/IDE 双模式与开发链路 | `webgui/src/main.tsx`、`webgui/dev/discoverBackend.ts` | [embedded-webgui-serving](business/embedded-webgui-serving.md) | 基线 |
| A3 | 中文本地化（固定中文、无 i18n） | `webgui/src/**`（UI 文案）、`ToolPart/utils.tsx` | [localization](business/localization.md) | 基线 |

### B. 会话与聊天体验

| # | 能力 | 代码入口 | 业务文档 | 基线 |
|---|------|----------|----------|------|
| B1 | 会话状态与生命周期（创建/切换/fork/revert/retry） | `webgui/src/state/SessionContext.tsx`、`useSessionActivation.ts` | [session-chat](business/session-chat.md) | 基线 |
| B2 | 消息流、分页、SSE 增量 | `webgui/src/state/MessagesContext.tsx`、`lib/messagesStore.ts` | [session-chat](business/session-chat.md) | 基线 |
| B3 | 多标签页会话工作台 | `webgui/src/state/tabStore.ts`、`tabPolicy.ts`、`CompactHeader/TabBar.tsx` | [session-chat](business/session-chat.md) | 基线 |
| B4 | 选择恢复（provider/model/agent/variant） | `webgui/src/lib/selection/selectionFromMessages.ts`、`state/repo/selectionRepo.ts` | [model-selection](business/model-selection.md) | 基线 |
| B5 | 滚动稳态与历史锚定 | `MessageList/hooks/useMessageScroll.ts` 等 | [session-chat](business/session-chat.md) | 基线 |
| B6 | 消息输入、附件、mention、command | `webgui/src/components/MessageInput/`、`attachment/`、`mention/`、`command/` | [message-input](business/message-input.md) | 基线 |
| B7 | 快捷短语（preset/custom、双击发送/回填） | `state/repo/quickPhraseRepo.ts`、`MessageInput/QuickPhraseBar.tsx`、`settings/QuickPhrasesTab.tsx` | [message-input](business/message-input.md) | **新增** |

### C. 工具、子任务与可视化

| # | 能力 | 代码入口 | 业务文档 | 基线 |
|---|------|----------|----------|------|
| C1 | 工具调用卡片渲染（ToolPart） | `webgui/src/components/parts/ToolPart/` | [tool-rendering](business/tool-rendering.md) | 基线 |
| C2 | 流式工具预览（write/edit/apply_patch 实时行数/文件名/内容） | `ToolPart/usePartialToolInput.ts`、`lib/partial-tool-input.ts`、`src/session/*`（STREAMABLE_TOOLS） | [tool-rendering](business/tool-rendering.md) | **新增** |
| C3 | 子任务抽屉（独立消息列表、宽度拖拽、阻塞态） | `state/SubtaskDrawerContext.tsx`、`components/SubtaskDrawer/` | [subtask-drawer](business/subtask-drawer.md) | 基线 |
| C4 | `generate_image` 工具与图片预览/保存 | `src/tool/generate-image/`、`ToolPart/ToolImageAttachments.tsx`、`parts/ImageOverlay.tsx` | [generated-image](business/generated-image.md) | 基线 |
| C5 | Diff / patch / 文件变更浏览 | `components/DiffModal/`、`parts/PatchPart.tsx`、`FileChangesPanel.tsx`、`hooks/useMergedFileDiffs.ts` | [diff-file-changes](business/diff-file-changes.md) | **新增** |

### D. 状态面板与运行时开关

| # | 能力 | 代码入口 | 业务文档 | 基线 |
|---|------|----------|----------|------|
| D1 | 状态面板（Server/SSE/IDE bridge/路径/后端地址） | `CompactHeader/StatusPopover.tsx`、`useStatusPopoverData.ts` | [status-panel](business/status-panel.md) | **新增** |
| D2 | MCP server/tool 启停 | `useStatusPopoverData.ts`、`lib/api/sdkClient.ts`、`src/mcp/index.ts` | [status-panel](business/status-panel.md) | **新增** |
| D3 | Skills 启停（runtime overlay） | `useStatusPopoverData.ts`、`src/skill/index.ts`、`src/permission/index.ts`、`src/session/tool-permission.ts` | [status-panel](business/status-panel.md) | **新增** |
| D4 | LSP / Plugins 可观测性 | `useStatusPopoverData.ts` | [status-panel](business/status-panel.md) | **新增** |

### E. 设置、Provider、Agent

| # | 能力 | 代码入口 | 业务文档 | 基线 |
|---|------|----------|----------|------|
| E1 | 设置面板壳层（5 tab：provider/general/agents/advanced/quick-phrases） | `components/SettingsPanel/index.tsx`、`settings/` | [settings-panel](business/settings-panel.md) | 部分（tab 组成为**新增**） |
| E2 | Provider 设置页（接口地址/API key/模型白名单、远程覆盖合并） | `settings/ProviderSettingsTab.tsx`、`providerSettingsUtils.ts` | [provider-settings](business/provider-settings.md) | **新增** |
| E3 | Agent 配置热重载（model/variant/prompt 不 dispose Instance） | `settings/AgentConfigTab.tsx`、`src/server/routes/instance/httpapi/handlers/instance.ts` | [agent-config](business/agent-config.md) | **新增** |
| E4 | 模型/Agent/Variant 选择器 | `components/ModelSelector.tsx`、`AgentSelector.tsx`、`VariantSelector.tsx`、`state/repo/modelPrefsRepo.ts` | [model-selection](business/model-selection.md) | 基线 |
| E5 | 主题偏好 | `state/ThemeContext.tsx`、`state/repo/themeRepo.ts` | [scoped-storage](business/scoped-storage.md) | 基线 |

### F. 状态持久化

| # | 能力 | 代码入口 | 业务文档 | 基线 |
|---|------|----------|----------|------|
| F1 | scoped storage（global/workspace/mem） | `state/scopedStorage.ts`、`state/repo/*` | [scoped-storage](business/scoped-storage.md) | 基线 |
| F2 | non-git 项目目录隔离 | `src/project/project.ts`、`src/project/schema.ts` | [project-identity](business/project-identity.md) | 基线 |

### G. IDE Bridge 与宿主能力

| # | 能力 | 代码入口 | 业务文档 | 基线 |
|---|------|----------|----------|------|
| G1 | IDE Bridge 协议（token + SSE + POST） | `webgui/src/lib/ideBridge.ts`、VSCode `ui/IdeBridgeServer.ts`、JetBrains `ui/IdeBridge.kt` | [ide-bridge](business/ide-bridge.md) | 基线 |
| G2 | IDE 上下文插入（add file/lines/paste/drag） | VSCode `commands/`、JetBrains `actions/`、WebGUI `MessageInput` bridge handlers | [context-insertion](business/context-insertion.md) | 基线 |
| G3 | 宿主动作（open file/url/clipboard/saveImage/reloadPath） | 各宿主 bridge handlers、`webgui/src/hooks/useOpenFile.ts`、`utils/clipboard.ts` | [host-actions](business/host-actions.md) | 基线 |
| G4 | 宿主重启（VSCode reload window / JetBrains restart IDE） | bridge `restartHost`、`settings/RestartRequiredModal.tsx` | [host-restart](business/host-restart.md) | 基线 |
| G5 | 打开文件同步（updateOpenedFiles） | VSCode `utils/FileMonitor.ts`、JetBrains `ui/IdeOpenFilesUpdater.kt`、`state/IdeBridgeContext.tsx` | [host-actions](business/host-actions.md) | 基线 |

### H. 宿主生命周期与集成

| # | 能力 | 代码入口 | 业务文档 | 基线 |
|---|------|----------|----------|------|
| H1 | 后端启动生命周期 | VSCode `backend/BackendLauncher.ts`、JetBrains `backendprocess/BackendLauncher.kt`、`TerminalBackendProcess.kt` | [backend-launch](business/backend-launch.md) | 基线 |
| H2 | Webview/JCEF 承载 | VSCode `ui/WebviewController.ts`、`WebviewManager.ts`、`ActivityBarProvider.ts`、JetBrains `ui/ChatToolWindowFactory.kt` | [host-webview-integration](business/host-webview-integration.md) | 基线 |
| H3 | JetBrains 后端日志懒显示 | JetBrains `ui/BackendLogsVisibilityController.kt`、`backendprocess/TerminalOutputCapture.kt` | [host-webview-integration](business/host-webview-integration.md) | 基线 |

### I. 版本、更新与发布

| # | 能力 | 代码入口 | 业务文档 | 基线 |
|---|------|----------|----------|------|
| I1 | 版本门禁 + 更新流（WebGUI 展示层） | `webgui/src/components/VersionGate.tsx`、`state/UpdateContext.tsx`、`UpdateBanner.tsx` | [version-update](business/version-update.md) | 基线 |
| I2 | VSCode 更新（GitHub Release + .vsix） | VSCode `update/ReleaseChecker.ts`、`UpdateInstaller.ts`、`UpdateService.ts` | [version-update](business/version-update.md) | 基线 |
| I3 | JetBrains 更新（public Marketplace 查询 + 手动安装） | JetBrains `update/MarketplaceVersionSource.kt`、`PluginUpdateService.kt` | [version-update](business/version-update.md) | 基线 |
| I4 | 插件打包（VSCode VSIX / JetBrains Gradle） | `hosts/scripts/build_vscode.sh`、`hosts/jetbrains-plugin/build.gradle.kts` | [packaging-release](business/packaging-release.md) | 基线 |
| I5 | 发布内容共享真源 + Marketplace 发布 | `docs/release-content/`、`script/release-content*.ts`、`.github/workflows/release.yml` | [packaging-release](business/packaging-release.md) | 基线 |

### J. 上游适配边界（同步风险点）

| # | 能力 | 代码入口 | 业务文档 | 基线 |
|---|------|----------|----------|------|
| J1 | 前台读取优先于后台 diff | `src/session/summary-scheduler.ts`、`summary-scheduler-foreground.ts`、`webgui/src/hooks/useSessionVisibilitySync.ts` | [foreground-read-priority](business/foreground-read-priority.md) | 基线 |
| J2 | 流超时/Responses 流错误恢复 | `src/session/retry.ts`、`status.ts`、`src/provider/provider.ts` | [stream-error-recovery](business/stream-error-recovery.md) | **新增** |
| J3 | 工具外部目录安全边界 | `src/tool/external-directory.ts` | [tool-safety-boundary](business/tool-safety-boundary.md) | 基线 |
| J4 | 上游 opencode 兼容边界（总览） | `src/config/config.ts`、`src/provider/provider.ts`、`src/server/server.ts` 等 | [upstream-compatibility](business/upstream-compatibility.md) | 基线 |

## 交叉核验状态（Step 5）

- 每个能力都有唯一业务文档，且业务文档标题与其代码契约名称一致（详见各业务文档头部的「代码真源」段）。
- 标 **新增** 的能力是相对基线 `specs/000-existing-capabilities/overview.md`（2026-05-18）的漂移；这些能力在提交历史 2026-05~06 引入，基线清单未覆盖。建库时对照代码已修正的事实：
  - `overview.md` 缺 Provider 设置、Agent 配置热重载、Quick phrases、流式工具预览、状态面板、Diff 浏览等行——本索引已补齐。
  - 设置面板实际有 5 个 `TabType`（`provider`/`general`/`agents`/`advanced`/`quick-phrases`，默认 `provider`），代码真源 `SettingsPanel/index.tsx`；见 [settings-panel](business/settings-panel.md)。
  - `external-directory.ts` 的实际行为是「项目外路径触发 `external_directory` permission ask」，不是无条件拒绝；见 [tool-safety-boundary](business/tool-safety-boundary.md)。

## 组织方式

本知识库按 Diátaxis 象限组织，是本项目唯一的知识库真源：

- `reference/business/*` 记录每项能力的**意图 + 代码锚点 + 运行时待核验**。
- `reference/repositories/*` 记录每个仓库/包的结构与逐文件模块地图。
- `explanation/*` 解释设计与「为什么」，`how-to/*` 给操作步骤，`adr/*` 追溯历史决策。
