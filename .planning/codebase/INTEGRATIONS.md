# 外部集成

**分析日期：** 2026-04-12

## API 与外部服务

**AI/LLM 提供商（通过 `packages/opencode/` 中的 Vercel AI SDK）：**

- Anthropic — `@ai-sdk/anthropic` 3.0.64
- OpenAI — `@ai-sdk/openai` 3.0.48
- Google AI — `@ai-sdk/google` 3.0.53
- Google Vertex AI — `@ai-sdk/google-vertex` 4.0.95
- AWS Bedrock — `@ai-sdk/amazon-bedrock` 4.0.83
- Azure AI — `@ai-sdk/azure` 3.0.49
- xAI (Grok) — `@ai-sdk/xai` 3.0.74
- Groq — `@ai-sdk/groq` 3.0.31
- Mistral — `@ai-sdk/mistral` 3.0.27
- Cerebras — `@ai-sdk/cerebras` 2.0.41
- Cohere — `@ai-sdk/cohere` 3.0.27
- DeepInfra — `@ai-sdk/deepinfra` 2.0.41
- Together AI — `@ai-sdk/togetherai` 2.0.41
- Perplexity — `@ai-sdk/perplexity` 3.0.26
- Vercel AI Gateway — `@ai-sdk/gateway` 3.0.80 和 `@ai-sdk/vercel` 2.0.39
- OpenRouter — `@openrouter/ai-sdk-provider` 2.3.3
- GitLab AI — `gitlab-ai-provider` 6.0.0
- 通过 `@ai-sdk/openai-compatible` 2.0.37 支持其他兼容提供商

**GitHub 集成：**

- `@octokit/rest` 22.0.1 — GitHub REST API 客户端
- `@octokit/graphql` 9.0.2 — GitHub GraphQL API 客户端
- `@actions/core` + `@actions/github` — CI/CD 的 GitHub Actions 集成

**认证：**

- `@openauthjs/openauth` 0.0.0-20250322224806 — OAuth 提供商认证
- `opencode-gitlab-auth` 2.0.0 — GitLab 专用 OAuth
- `opencode-poe-auth` 0.0.1 — Poe 认证
- `google-auth-library` 10.5.0 — Google OAuth/服务账号凭证
- `@aws-sdk/credential-providers` 3.993.0 — Bedrock 的 AWS 凭证解析

**MCP（Model Context Protocol）：**

- `@modelcontextprotocol/sdk` 1.27.1 — MCP 工具/资源服务器客户端
- 端点：`/mcp/{name}/tools` — 列出 MCP 服务器工具
- 端点：`/mcp/{name}/enabled` — 启用/禁用 MCP 服务器

**Agent Client Protocol：**

- `@agentclientprotocol/sdk` 0.14.1 — Agent 协议集成

**网络发现：**

- `bonjour-service` 1.3.0 — mDNS 服务发现（`packages/opencode/src/server/mdns.ts`）

## IDE 集成点

### VSCode 扩展 (`hosts/vscode-plugin/`)

**扩展入口点：** `hosts/vscode-plugin/src/extension.ts`

- 激活事件：`onView:opencode.main`、命令（openPanel、addFileToContext、addLinesToContext、pastePath、showDiagnostics）
- 主要输出：`hosts/vscode-plugin/out/extension.js`

**组件：**

- `BackendLauncher`（`hosts/vscode-plugin/src/backend/BackendLauncher.ts`）— 启动 opencode 后端二进制文件，解析 stdout 获取连接信息（端口 + URL），管理进程生命周期
- `ResourceExtractor`（`hosts/vscode-plugin/src/backend/ResourceExtractor.ts`）— 从扩展资源中提取打包的平台特定 opencode 二进制文件
- `WebviewManager`（`hosts/vscode-plugin/src/ui/WebviewManager.ts`）— 创建和管理 VSCode 编辑器标签页 webview 面板
- `ActivityBarProvider`（`hosts/vscode-plugin/src/ui/ActivityBarProvider.ts`）— 在侧边栏活动栏中渲染 WebGUI 的 `WebviewViewProvider`
- `WebviewController`（`hosts/vscode-plugin/src/ui/WebviewController.ts`）— 共享的 webview 生命周期控制器、HTML 注入和 Chromium SW bug 的重试逻辑
- `CommunicationBridge`（`hosts/vscode-plugin/src/ui/CommunicationBridge.ts`）— VSCode 宿主与 webview 之间的双向消息传递
- `IdeBridgeServer`（`hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`）— 用于 IDE ↔ WebGUI 通信的本地 HTTP+SSE 服务器
- `SettingsManager`（`hosts/vscode-plugin/src/settings/SettingsManager.ts`）— VSCode 设置的配置和同步

**命令：**

- `opencode.openPanel` — 打开主 webview 面板并启动后端
- `opencode.addFileToContext` — 将文件/文件夹添加到 AI 上下文（资源管理器/编辑器右键菜单，快捷键 `Ctrl+'`）
- `opencode.addLinesToContext` — 将选中行添加到上下文（快捷键 `Ctrl+Shift+'`）
- `opencode.pastePath` — 将目录路径粘贴到输入框
- `opencode.showDiagnostics` — 显示扩展诊断信息

**Remote-SSH 支持：**

- `WebviewController` 使用 `vscode.env.asExternalUri(...)` 将后端 UI URL 和 ideBridge 服务器 URL 外部化，用于 SSH 隧道

**配置设置：**

- `opencode.customCommand` — 后端进程的自定义命令
- `opencode.minVersion` — 最低要求的 opencode 服务器版本（默认：`1.1.1`）

### JetBrains 插件 (`hosts/jetbrains-plugin/`)

**插件入口点：** `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`

- 注册一个创建 JCEF webview 的工具窗口工厂

**组件：**

- `IdeBridge`（`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`）— 单例 HTTP+SSE 服务器（与 VSCode 协议相同），管理每个项目的会话，处理 `openFile`、`openUrl`、`reloadPath`、`clipboardWrite`、storage 操作
- `BackendLauncher`（`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/backendprocess/BackendLauncher.kt`）— 启动 opencode 后端二进制文件
- `BackendProcess` / `TerminalBackendProcess`（`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/backendprocess/`）— 后端进程管理，带终端集成
- `DragAndDropInstaller`（`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/DragAndDropInstaller.kt`）— 文件拖放到 webview 的支持
- `IdeOpenFilesUpdater`（`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeOpenFilesUpdater.kt`）— 将打开的编辑器文件变更通知 WebGUI
- `PathInserter`（`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/PathInserter.kt`）— 向 WebGUI 上下文发送文件路径
- `IdeBridgeStorageBackend`（`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridgeStorageBackend.kt`）— 基于 IDE 属性的持久化键值存储

**平台兼容性：**

- 起始构建版本：243（IntelliJ 2024.3）
- 截止构建版本：261.\*（向前兼容）
- 需要 Java 21

### WebGUI 前端 (`packages/opencode/webgui/`)

**入口点：** `packages/opencode/webgui/src/main.tsx`

- 创建 React 19 根节点，初始化 ideBridge、tooltip polyfill、全局拖放

**IDE 桥接客户端：** `packages/opencode/webgui/src/lib/ideBridge.ts`

- 从 URL 查询参数读取 `ideBridge` 和 `ideBridgeToken`
- 打开 `EventSource`（SSE）到 `{bridgeBase}/events?token=...` 接收宿主→UI 消息
- 通过 `fetch(POST {bridgeBase}/send?token=...)` 发送 UI→宿主消息
- 基于 `id`/`replyTo` 关联的 Promise RPC
- 指数退避重连（1 秒 → 最大 30 秒）
- Storage API：`storageGet(scope, keys)` 和 `storageSet(scope, key, value)`，scope 有 `global`、`workspace`、`mem`

## 通信协议

### opencode HTTP API（后端 ↔ WebGUI）

**服务器：** `packages/opencode/src/server/server.ts` 中基于 Hono 的 HTTP 服务器

- 在临时端口上服务（从 stdout 解析：`opencode server listening on http://...`）
- WebGUI 静态资源从 `packages/opencode/webgui-dist/` 在 `/app` 路径提供服务
- 为 localhost 来源、`tauri://localhost`、VSCode webview 来源启用 CORS
- 通过 `OPENCODE_SERVER_PASSWORD` / `OPENCODE_SERVER_USERNAME` 环境变量支持可选的基本认证
- 通过 Hono 中间件压缩（SSE 和流式端点跳过）

**SDK 客户端：** `packages/opencode/webgui/src/lib/api/sdkClient.ts`

- 使用 `@opencode-ai/sdk/client`（`createOpencodeClient`）指向 `window.location.origin`
- 用额外方法包装 SDK：`session.list`、`session.retry`、`mcp.tools`、`config.allProviders`、`auth.*`、`permissions.respond`、`question.reply`

**核心 REST 端点（WebGUI 使用）：**

- `GET /session` — 列出会话（可选 directory、limit、roots 参数）
- `GET /session/{id}` — 获取会话详情
- `GET /session/{id}/messages` — 获取会话消息历史
- `POST /session/{id}/prompt` — 向会话发送提示
- `POST /session` — 创建新会话
- `DELETE /session/{id}` — 删除会话
- `GET /event` — 实时更新的 SSE 事件流
- `GET /global/event` — 全局 SSE 事件流
- `GET /config` / `PATCH /config` — 项目配置
- `GET /global/config` / `PATCH /global/config` — 全局配置
- `GET /provider` — 列出 AI 提供商及连接状态
- `GET /provider/auth` — 获取每个提供商的认证方法
- `POST /provider/{id}/oauth/authorize` — 启动 OAuth 流程
- `POST /provider/{id}/oauth/callback` — 完成 OAuth 流程
- `GET /auth/{id}` / `PUT /auth/{id}` / `DELETE /auth/{id}` — 认证凭证管理
- `GET /mcp/{name}/tools` — 列出 MCP 服务器工具
- `PATCH /mcp/{name}/enabled` — 切换 MCP 服务器
- `PATCH /mcp/{name}/tools/{toolId}` — 切换单个 MCP 工具
- `GET /skill` — 列出可用技能
- `PATCH /skill/{name}/enabled` — 切换技能
- `GET /path` — 获取目录路径（state、config、worktree、directory）
- `POST /permission/{requestID}/reply` — 响应权限请求
- `POST /question/{requestID}/reply` — 回复 Agent 问题
- `POST /question/{requestID}/reject` — 拒绝 Agent 问题

### SSE 事件流（后端 → WebGUI）

**端点：** `packages/opencode/webgui/src/lib/api/events.ts` 中通过 `EventSource` 的 `GET /event`

- 指数退避重连（1 秒 → 最大 30 秒，无限重试）

**事件类型：**

- `server.connected` — 初始连接确认
- `session.created` / `session.updated` / `session.deleted` — 会话生命周期
- `session.error` — 会话级错误
- `session.status` — 会话状态变更（含重试信息）
- `session.idle` — 会话变为空闲
- `session.compacted` — 会话历史已压缩
- `session.diff` — 会话的文件 diff 更新
- `message.updated` — 消息元数据变更
- `message.removed` — 消息已删除
- `message.part.updated` — 消息部分内容更新（可选增量）
- `message.part.delta` — 流式传输的增量文本
- `message.part.removed` — 消息部分已移除
- `permission.asked` / `permission.replied` — 权限流程事件
- `question.asked` / `question.replied` / `question.rejected` — 问题流程事件
- `file.edited` / `file.updated` — 文件变更通知
- `lsp.diagnostics` — LSP 诊断事件
- `todo.updated` — 待办列表更新

### IDE 桥接协议（IDE 宿主 ↔ WebGUI）

**传输层：** `127.0.0.1` 上的 HTTP + SSE，使用临时端口

- 完整规范：`hosts/IDE_BRIDGE_HTTP_SSE.md`
- 基于会话，使用 UUID 的 `sessionId` 和 `token` 认证
- SSE keepalive ping 每 15 秒一次

**WebGUI → IDE 宿主消息：**

- `openFile` — 在编辑器中打开文件：`{ path: string, line?: number }`
- `openUrl` — 在浏览器中打开 URL：`{ url: string }`
- `reloadPath` — 触发 IDE 中的文件重载：`{ path: string, operation?: "write" | "edit" | "apply_patch" }`
- `clipboardWrite` — 写入系统剪贴板：`{ text: string }`
- `restartHost` — 重启 IDE/扩展宿主
- `ensureAndOpenFile` — 如果文件不存在则创建，然后打开：`{ path: string }`
- `storageGet` — 从 scoped storage 读取：`{ scope, keys }`
- `storageSet` — 写入 scoped storage：`{ scope, key, value }`

**IDE 宿主 → WebGUI 消息（通过 SSE）：**

- `insertPaths` — 将文件路径插入输入框：`{ paths: string[] }`
- `pastePath` — 粘贴单个路径：`{ path: string }`
- `updateOpenedFiles` — 同步打开的编辑器标签页：`{ openedFiles: string[], currentFile?: string | null }`
- `drag-event` — 转发拖放事件（macOS VSCode 变通方案）

**请求/响应模式：**

- 请求包含 `id: string`
- 响应包含匹配请求 `id` 的 `replyTo: string`、`ok: boolean`、可选 `error: string`

### VSCode Webview 通信

**传统 postMessage（CommunicationBridge）：** `hosts/vscode-plugin/src/ui/CommunicationBridge.ts`

- `vscode.Webview.postMessage()` / `webview.onDidReceiveMessage()` 用于直接的 VSCode ↔ webview 消息传递
- 与 ideBridge HTTP+SSE 传输并用
- 处理：文件操作、状态同步、设置

## 数据存储

**数据库（opencode 核心）：**

- 通过 Drizzle ORM 的 SQLite — 用于会话、消息、项目、账户的本地数据库
  - Schema：`packages/opencode/src/**/*.sql.ts`
  - 核心表：`session`、`project`、`account`、`workspace`、`share`、`event`、`schema`（storage）
  - 平台特定 DB 驱动：`packages/opencode/src/storage/db.bun.ts`（Bun）/ `db.node.ts`（Node）
  - 迁移：`packages/opencode/migration/`，由 Drizzle Kit 生成

**云基础设施（上游，非 IDE 插件）：**

- SST (Serverless Stack) 3.18.10 — `sst.config.ts` 中的基础设施即代码
- Cloudflare（SST 的 home provider）
- PlanetScale — MySQL 兼容数据库（通过 `planetscale` SST provider）
- Stripe — 支付集成（通过 `stripe` SST provider）
- AWS S3 — `@aws-sdk/client-s3` 用于文件存储

**IDE 级存储：**

- VSCode `ExtensionContext.globalState` / `workspaceState` — 通过 ideBridge `storageGet`/`storageSet` 访问的持久化键值存储
- VSCode 内存 map — 临时 `mem` scope 存储
- JetBrains `PropertiesComponent` — 基于 IDE 属性的持久化存储（`IdeBridgePropertiesStorageBackend`）
- JetBrains `ConcurrentHashMap` — 每个会话的内存 `mem` scope
- WebGUI `scopedStorage` — 委托给 IDE 存储后端的客户端状态持久化（`packages/opencode/webgui/src/state/scopedStorage.ts`）

**文件存储：**

- 本地文件系统用于项目文件、生成的代码和配置
- 使用 XDG 基目录存放配置/状态路径（`xdg-basedir` 5.1.0）

**缓存：**

- 没有专用缓存服务——依赖 SQLite、内存状态和 Bun/Node 运行时缓存

## CI/CD 与部署

**CI 平台：** GitHub Actions

**关键工作流：**

- `.github/workflows/test.yml` — 测试套件
- `.github/workflows/typecheck.yml` — TypeScript 类型检查
- `.github/workflows/publish-vscode.yml` — VSCode 扩展发布（手动触发）
  - 运行器：`blacksmith-4vcpu-ubuntu-2404`
  - 通过 `@vscode/vsce` 发布，使用 `VSCE_PAT` 和 `OPENVSX_TOKEN` 密钥
- `.github/workflows/release.yml` — 发布自动化
- `.github/workflows/publish.yml` — 通用发布
- `.github/workflows/beta.yml` — Beta 发布通道
- `.github/workflows/containers.yml` — 容器构建

**构建脚本（IDE 插件用）：**

- `hosts/scripts/build_vscode.sh` / `build_vscode.bat` — VSCode 扩展打包（编译 TS，打包 opencode 二进制文件，创建 .vsix）
- `hosts/scripts/build_jetbrains.sh` / `build_jetbrains.bat` — JetBrains 插件打包（Gradle 构建，打包 opencode 二进制文件，创建 .zip）
- `hosts/scripts/build_opencode.sh` / `build_opencode.bat` — 构建用于打包的 opencode 后端二进制文件
- `hosts/scripts/dev_vscode.sh` — VSCode 扩展的开发模式
- `hosts/scripts/test_vscode.sh` — VSCode 扩展测试运行器

**部署目标：**

- VSCode Marketplace — 通过 `@vscode/vsce` 发布
- Open VSX Registry — 通过 `OPENVSX_TOKEN`
- JetBrains Marketplace — 通过 Gradle IntelliJ Platform 插件（签名 + 验证）
- Cloudflare — SST 管理的控制台/企业版基础设施（上游）

## 环境配置

**必需的环境变量（仅记录存在性，不读取值）：**

- 各层级存在 `.env` 文件
- `OPENCODE_BIN` — VSCode 扩展中 opencode 二进制文件的覆盖路径
- `OPENCODE_SERVER_PASSWORD` / `OPENCODE_SERVER_USERNAME` — 服务器的可选基本认证
- `OPENCODE_DISABLE_SHARE` — 禁用共享功能
- AI 提供商 API 密钥 — 通过 opencode 配置/认证系统配置

**版本同步：**

- WebGUI 版本：`26.3.301`（`packages/opencode/webgui/package.json`）
- VSCode 扩展版本：`26.3.301`（`hosts/vscode-plugin/package.json`）
- opencode 核心版本：`1.3.3`（`packages/opencode/package.json`）
- SDK 版本：`1.3.3`（`packages/sdk/js/package.json`）
- IDE 插件强制的最低服务器版本：`1.1.1`（可配置）
- WebGUI `__APP_VERSION__` 在构建时通过 Vite `define` 注入

---

_集成审计：2026-04-12_
