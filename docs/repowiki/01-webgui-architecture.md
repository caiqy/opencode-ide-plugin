# WebGUI 架构与本地托管

WebGUI 是本项目的主体界面。它不是上游 opencode TUI 的替代，而是与 TUI 并存的 React SPA，用于在浏览器、VSCode webview、JetBrains JCEF 中提供 IDE 友好的聊天和配置体验。

## 架构分层

```text
IDE Host（VSCode / JetBrains）
  └─ Webview / JCEF
      └─ WebGUI React SPA（/app）
          ├─ IDE Bridge（宿主能力）
          ├─ SDK Client（opencode HTTP API）
          └─ SSE Event Stream（opencode Bus events）
```

关键目录：

- `packages/opencode/webgui/src/main.tsx`：React 入口与全局 Provider 装配。
- `packages/opencode/webgui/src/App.tsx`：主聊天布局、SSE 状态、全局快捷键、宿主事件处理。
- `packages/opencode/webgui/src/lib/api/`：SDK client 与事件流封装。
- `packages/opencode/webgui/src/state/`：Session、Messages、Theme、Update、Tabs、Subtask 等状态。
- `packages/opencode/webgui/src/components/`：聊天、输入、Header、设置、状态面板、子任务抽屉等 UI。

## `/app` 本地托管

插件场景下不能依赖 `https://app.opencode.ai`。本项目将 WebGUI 构建产物嵌入 opencode 包，并由本地 server 在 `/app` 提供。

关键文件：

- `packages/opencode/webgui/vite.config.ts`：WebGUI 构建配置，base 为 `/app`。
- `packages/opencode/src/webgui/embed.generated.ts`：构建产物 base64 嵌入文件。
- `packages/opencode/src/webgui/server/app.ts`：从内存提供 `index.html` 与 `assets/*`。
- `packages/opencode/src/server/server.ts`：挂载 `GET /app` 与 `GET /app/*`。

路由策略：

- `/app` 返回 `index.html`。
- `/app/assets/*` 返回嵌入资源，静态资源可长缓存。
- 无扩展名的 SPA 路径 fallback 到 `index.html`。
- `/app/api/*` 不应回流到旧兼容接口。
- `/app` 路由必须早于 workspace middleware，避免静态资源请求被当成实例 API。

## 开发模式双链路

WebGUI 有两条独立链路：

- **正式链路：** opencode server 提供 embedded WebGUI，并由 `/app` 对外服务。
- **开发链路：** VSCode 直接启动 `packages/opencode/webgui` 的 Vite dev server，用于浏览器/HMR 联调。

关键文件：

- `.vscode/launch.json`
- `.vscode/launch.example.json`（Bun attach 样例，不是标准启动链路）
- `packages/opencode/webgui/package.json`

维护约束：

- `WebGUI: dev` 只启动前端，不自动带起 backend。
- 调试配置优先复用仓库脚本，不分散硬编码 Vite 细节。
- dev 链路只服务联调，不替代 `/app` 正式托管。

## Vite dev 的 backend 发现与代理

关键文件：

- `packages/opencode/webgui/vite.config.ts`
- `packages/opencode/webgui/dev/discoverBackend.ts`
- `packages/opencode/webgui/dev/discoverBackend.test.ts`
- `packages/opencode/webgui/src/lib/api/sdkClient.ts`
- `packages/opencode/webgui/src/lib/api/events.ts`

开发模式下，WebGUI 采用“Node 侧发现 backend + Vite proxy 转发”：浏览器继续按当前 origin 访问 API/SSE，`/app` 和静态资源由 Vite 提供，API/SSE 根路径继续走 proxy。

当前约定：

- backend discovery 属于 dev tooling，不应扩散到正式运行时代码。
- 候选端口是收紧的固定集合，当前顺序为：`4300`、`4096`、`4097`、`4098`、`4099`、`4100`；其中 `4300` 与仓库内 VSCode backend 调试配置保持一致。
- 当前只探测 `127.0.0.1`，不默认覆盖局域网、容器或 SSH 转发。
- 后端识别不能只看 `/app` 是否可访问，必须通过 `/global/config` 做结构化校验。
- 如果所有候选端口都失败，Vite dev 应直接启动失败，而不是进入半可用状态。
- dev 模式还会注入 `__OPENCODE_BACKEND_URL__` 常量，供前端感知已发现的 backend 地址；浏览器侧 API/SSE 入口仍以当前 origin + proxy 为准。
- `WebGUI: dev` 可通过 `OPENCODE_DEV_DIRECTORY_OVERRIDE` 覆盖测试项目路径；Vite 只在 `serve` 模式把该值注入为 `x-opencode-directory`，正式 `vite build` 和 embedded `/app` 不读取这个变量。
- generated image 预览在 dev proxy 中也要转发 `/generated-image` 与 `/app/generated-image`，否则 WebGUI dev 无法预览项目内 `.opencode/generated-images` 文件。

## 与 opencode API 的关系

WebGUI 通过 `sdkClient` 访问 opencode 核心 API。迁移目标是优先使用上游官方 API / SDK，而不是依赖历史 `/app/api/*` 兼容层。

关键适配：

- `packages/opencode/webgui/src/lib/api/sdkClient.ts` 对生成 SDK 做二次封装，保持 WebGUI 调用形状稳定。
- Provider/Auth、session、config、MCP、permission、question 等能力通过该层统一调用。
- 上游 API 暂时没有覆盖的 WebGUI 需求（例如部分 retry/state 语义）由最小兼容逻辑承接。

`sdkClient.ts` 还承担若干插件适配职责：

- 包装 `/global/config` 读取和更新，供设置面板保存 opencode 配置。
- 包装 `session.list`、`session.messages`、分页 cursor 和 roots/limit 参数，供会话列表与消息懒加载使用。
- 提供 revert-aware 的 `session.retry` 兼容逻辑，避免 WebGUI 直接拼底层请求。
- 封装 Provider OAuth 流程、permission 回复、question 回复/拒绝。
- 封装 MCP server/tool 开关与 Skills 开关，减少组件直接依赖后端路由形状。

## 项目与 worktree 上下文

关键文件：

- `packages/opencode/webgui/src/state/ProjectContext.tsx`
- `packages/opencode/webgui/src/state/IdeBridgeContext.tsx`
- `packages/opencode/webgui/src/utils/path.ts`
- `packages/opencode/webgui/src/hooks/useOpenFile.ts`

`ProjectContext` 通过 opencode API 获取当前项目和 worktree 信息，是路径展示、相对路径计算、文件打开和 opened files 映射的基础。`IdeBridgeContext` 接收宿主推送的 `updateOpenedFiles`，再结合 worktree 将 IDE 中打开的文件转换为 WebGUI 可读的相对路径。

维护时要注意：WebGUI 中的文件路径通常服务于 IDE 场景，既要能传给 opencode 后端作为上下文，也要能回传给宿主打开文件。路径归一化和 worktree 计算不能只按浏览器环境理解。

## Generated image 预览入口

图片生成链路会把生成文件落到当前项目的 `.opencode/generated-images/`，WebGUI 中有两个主要消费入口：

- Markdown 图片：`MarkdownRenderer` 识别 `.opencode/generated-images` 相对路径，并通过 `getGeneratedImageUrl(relativePath, directoryOrWorktree)` 生成带实例目录上下文的专用路由。
- Tool attachment 图片：`ToolImageAttachments` 优先使用 attachment 的 `relativePath`，同样通过 generated-image 路由加载；缺少 `relativePath` 的旧 data URL attachment 仍按原 URL 展示。

维护时要保证 ProjectContext 的 `directory/worktree` 与 generated-image 路由一起演进。只改图片组件而忘记实例目录上下文，会导致多项目或 non-git 目录下预览串项目。

## 应用入口职责

`main.tsx` 与 `App.tsx` 共同完成：

- 初始化 `ideBridge`。
- 建立 `/event` SSE 连接。
- 注入 `ProjectProvider`、`SessionProvider`、`MessagesProvider`、`ThemeProvider`、`UpdateProvider` 等上下文。
- 处理 Host → UI 消息，例如 `insertPaths`、`pastePath`、`drag-event`。
- 处理全局快捷键、拖拽、设置面板、命令面板、离线提示。

## 浏览器模式适配

WebGUI 支持两种运行环境：IDE webview 和普通浏览器。在浏览器模式下，部分 IDE 特有功能不可用或需要回退处理：

- **设置面板差异**：浏览器模式下隐藏"打开配置文件"按钮（依赖 IDE bridge），并暂时隐藏通用设置和高级设置标签页。
- **文件打开回退**：浏览器模式通过下载链接代替 IDE bridge 的文件打开能力。
- **剪贴板回退**：浏览器模式使用标准 Clipboard API，IDE 模式优先使用宿主剪贴板。
- **图片保存回退**：浏览器模式回退为下载链接，不调用 IDE bridge `saveImage`。

WebGUI 通过 `ideBridge` 是否可用来判断当前运行模式。不在 IDE 环境时，`ideBridge` 为 null，WebGUI 自动进入浏览器模式降级。

## 全局壳层组件

关键文件：

- `packages/opencode/webgui/src/components/VersionGate.tsx`
- `packages/opencode/webgui/src/components/ChatLoadGuard.tsx`
- `packages/opencode/webgui/src/components/OfflineBanner.tsx`
- `packages/opencode/webgui/src/components/ErrorBoundary.tsx`
- `packages/opencode/webgui/src/components/Toast.tsx`
- `packages/opencode/webgui/src/components/ConfirmModal.tsx`
- `packages/opencode/webgui/src/state/ToastContext.tsx`

职责：

- `VersionGate` 同时参考 IDE bridge `minVersion` 和后端健康信息，阻止不兼容版本继续使用。
- `ChatLoadGuard` 在会话消息未加载、加载失败或 selection 未恢复时阻断输入，并通过 blur/pointer guard 避免误操作。
- `OfflineBanner` 显示 SSE 断线或重连状态。
- `ErrorBoundary` 捕获 React 渲染错误，避免整个 webview 白屏。
- `ToastContext` 是全局通知通道，被更新、打开文件、设置保存、输入/附件错误等场景复用。
- `ConfirmModal` 用于删除、关闭、危险操作等确认流程。

## 通用 UI 组件 (common/)

`packages/opencode/webgui/src/components/common/` 目录提供 WebGUI 全局依赖的基础 UI 组件库。与业务组件不同，这些是纯展示/交互基元，被消息渲染、Header、设置面板、状态弹窗等所有场景复用。

关键文件：

- `packages/opencode/webgui/src/components/common/Button.tsx`：通用按钮组件，支持 variant、loading 等状态。
- `packages/opencode/webgui/src/components/common/Card.tsx`：轻量卡片容器，用于设置面板、session 列表等分组布局。
- `packages/opencode/webgui/src/components/common/IconButton.tsx`：纯图标按钮，通用性高，Header、输入框、附件列表等均使用。
- `packages/opencode/webgui/src/components/common/Input.tsx`：基础输入框，被 MessageInput、设置面板等消费。
- `packages/opencode/webgui/src/components/common/Modal.tsx`：通用模态框，用于设置、确认、命令面板等弹出场景。
- `packages/opencode/webgui/src/components/common/Select.tsx`：下拉选择组件。
- `packages/opencode/webgui/src/components/common/index.ts`：统一导出入口，消费方通过该文件引入。

## 维护注意点

- 修改 server 路由时，必须确认 `/app` 挂载仍在 workspace middleware 之前。
- 修改 WebGUI 构建路径或 asset 命名时，必须同步嵌入脚本与 `webgui/server/app.ts`。
- 修改 `sdkClient.ts` 时，要保持 WebGUI 现有 `{ data, error }` 调用习惯，避免把异常直接抛给组件层。
- 修改 dev 模式链路时，不要把 backend 发现、proxy 或端口探测逻辑泄漏到生产 `/app` 托管路径。
- 修改 common/ 组件时，必须检查所有消费方，避免破坏消息渲染、设置面板、状态弹窗等多个场景。
- 新增全局壳层组件时，注意 `App.tsx` 的 Provider 装配顺序。

## 消息输入与附件系统

消息输入是 WebGUI 的核心交互入口，由多个紧密协作的子模块组成。

关键目录与文件：

- `packages/opencode/webgui/src/components/MessageInput/`：
  - `EditorConfig` — 编辑器配置与初始化。
  - `EditorContent` — 消息正文编辑区。
  - `EditorToolbar` — 编辑器功能工具栏。
  - `FooterPanels` — 底栏面板（附件、命令等子面板的容器）。
  - `MessageActions` — 发送、停止等消息操作按钮。
  - `TodosPanel` — 待办事项面板。
  - `QuickPhraseBar` — 快速短语/快捷指令栏。
- `packages/opencode/webgui/src/components/attachment/`：
  - `AttachmentComponent` — 已上传附件展示组件。
  - `AttachmentNode` — 编辑器内联附件节点。
  - `AttachmentPlugin` — 附件功能的编辑器插件注册。
- `packages/opencode/webgui/src/components/command/`：
  - `CommandPopover` — 命令选择弹出层。
  - `CommandPlugin` — 编辑器命令自动完成插件。
- `packages/opencode/webgui/src/components/mention/`：
  - `MentionNode` — @提及的内联渲染节点。
  - `MentionPopover` — @提及的选择弹出层。
  - `MentionPlugin` — @提及的编辑器插件注册。

这些模块的详细交互流程与状态管理见 [04-session-chat](./04-session-chat.md)。
