# 架构

**分析日期：** 2026-04-12

## 系统概览

本系统是基于开源 **opencode** 项目构建的 AI 驱动开发工具，并扩展了 IDE 插件支持。采用**客户端-服务器架构，内嵌 Web UI**：

```
+------------------------------------------------------+
|                  IDE Host Layer                       |
|  +----------------+    +------------------------+    |
|  | VSCode Plugin  |    | JetBrains Plugin       |    |
|  | (TypeScript)   |    | (Kotlin/JVM)           |    |
|  +------+---------+    +----------+-------------+    |
|         |                         |                  |
|         |   IdeBridge (HTTP+SSE)  |                  |
|         +------------+------------+                  |
|                      |                               |
+------------------------------------------------------+
                       |
+------------------------------------------------------+
|              WebGUI (React SPA)                      |
|  Rendered inside IDE webview, communicates with      |
|  opencode server via REST/SSE on same origin         |
+------------------------------------------------------+
                       |
                  REST / SSE
                       |
+------------------------------------------------------+
|           Opencode Server (Bun/Hono)                 |
|  +--------+  +----------+  +---------+  +--------+  |
|  | Session|  | Provider |  | Agent   |  | MCP    |  |
|  | Mgmt   |  | (AI SDK) |  | System  |  | Server |  |
|  +--------+  +----------+  +---------+  +--------+  |
|  +--------+  +----------+  +---------+  +--------+  |
|  | Config |  | Bus/Event|  | Storage |  | File   |  |
|  | System |  | System   |  | (SQLite)|  | System |  |
|  +--------+  +----------+  +---------+  +--------+  |
+------------------------------------------------------+
```

## 组件图

### 1. Opencode 核心 (`packages/opencode/`)

主要后端：基于 Bun 和 Hono 构建的 CLI 工具及 HTTP 服务器。

- **用途：** AI Agent 编排、会话管理、代码编辑、工具执行
- **入口点：** `packages/opencode/src/index.ts`（通过 yargs 的 CLI）
- **服务器：** `packages/opencode/src/server/server.ts`（支持 SSE 的 Hono HTTP 服务器）
- **核心子系统：**
  - `src/agent/` - AI Agent 定义与编排
  - `src/session/` - 聊天会话生命周期和消息管理
  - `src/provider/` - AI 模型提供商集成（Anthropic、OpenAI、Google 等）
  - `src/tool/` - 工具实现：文件编辑、Shell 命令等
  - `src/bus/` - 内部事件总线（基于 Effect PubSub）
  - `src/config/` - 配置管理（`opencode.json`）
  - `src/storage/` - SQLite 数据库（Drizzle ORM）
  - `src/mcp/` - Model Context Protocol 服务端/客户端
  - `src/project/` - 项目/工作区检测与管理
  - `src/server/` - HTTP API 服务器及路由

### 2. WebGUI (`packages/opencode/webgui/`)

一个 React 19 单页应用（SPA），提供聊天 UI。基于 Vite 构建，有两种服务方式：

- **嵌入模式：** 预构建并 base64 编码到 `packages/opencode/src/webgui/embed.generated.ts`，由 opencode 服务器在 `/app` 路径提供服务
- **开发模式：** Vite 开发服务器，代理请求到 opencode 后端

- **用途：** 聊天界面、会话管理、设置、文件浏览
- **入口点：** `packages/opencode/webgui/src/main.tsx`
- **核心区域：**
  - `src/components/` - React 组件（MessageList、MessageInput、CommandPalette 等）
  - `src/state/` - React Context 提供者（SessionContext、MessagesContext、ThemeContext 等）
  - `src/lib/api/` - SDK 客户端和 SSE 事件流
  - `src/lib/ideBridge.ts` - IDE 桥接客户端，用于宿主通信
  - `src/hooks/` - 自定义 React hooks

### 3. VSCode 插件 (`hosts/vscode-plugin/`)

TypeScript 扩展，在 VSCode webview 中承载 WebGUI。

- **用途：** 将 opencode 集成到 VSCode 活动栏面板中
- **入口点：** `hosts/vscode-plugin/src/extension.ts`
- **核心组件：**
  - `src/backend/BackendLauncher.ts` - 以子进程方式启动 `opencode serve`
  - `src/ui/ActivityBarProvider.ts` - VSCode `WebviewViewProvider`，用于侧边栏
  - `src/ui/WebviewController.ts` - 管理 webview 生命周期、iframe 加载、桥接设置
  - `src/ui/IdeBridgeServer.ts` - 本地 HTTP+SSE 服务器，用于 IDE↔WebGUI 通信
  - `src/ui/CommunicationBridge.ts` - 在 IDE 和 webview 之间路由消息
  - `src/commands/` - VSCode 命令（添加文件到上下文、粘贴路径等）
  - `src/settings/SettingsManager.ts` - VSCode 设置集成

### 4. JetBrains 插件 (`hosts/jetbrains-plugin/`)

Kotlin/JVM 插件，在 JCEF 浏览器面板中承载 WebGUI。

- **用途：** 将 opencode 集成到 JetBrains IDE 的工具窗口中
- **入口点：** `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`
- **核心组件：**
  - `backendprocess/BackendLauncher.kt` - 在 IDE 终端中启动 `opencode serve`
  - `ui/IdeBridge.kt` - 本地 HTTP+SSE 服务器（与 VSCode 协议相同）
  - `ui/ChatToolWindowFactory.kt` - JCEF 浏览器设置和后端协调
  - `ui/DragAndDropInstaller.kt` - 拖放文件支持
  - `ui/IdeOpenFilesUpdater.kt` - 追踪打开的文件并向 WebGUI 发送更新
  - `actions/` - IDE 操作（添加到上下文、粘贴路径等）
  - `settings/OpenCodeSettings.kt` - 插件设置

### 5. SDK (`packages/sdk/js/`)

从 OpenAPI 规范自动生成的 TypeScript SDK。

- **用途：** opencode HTTP API 的类型安全客户端
- **来源：** `packages/sdk/openapi.json`（从 Hono 路由元数据生成）
- **使用者：** WebGUI（`packages/opencode/webgui/src/lib/api/sdkClient.ts`）

## 数据流

### 聊天消息流

1. 用户在 WebGUI 的 `MessageInput` 组件中输入
2. WebGUI 通过 HTTP POST 调用 `sdk.session.prompt()` 到 `/session/{id}/message`
3. Opencode 服务器通过 `WorkspaceRouterMiddleware` 将请求路由到 `SessionRoutes`
4. 后端创建 Agent 任务，通过事件总线流式传输响应
5. 总线发布 `message.part.updated`、`message.part.delta` 事件
6. 事件通过 `/event` 端点的 SSE 流向 WebGUI
7. `events.ts` 中的 `useEventStream` hook 通过 `EventSource` 接收事件
8. `EventEmitter` 分发到 `MessagesContext`，更新 React 状态
9. `MessageList` 组件使用新的/更新的消息部分重新渲染

### IDE 插件生命周期（VSCode）

1. 扩展激活，调用 `OpenCodeExtension.initialize()`
2. `ActivityBarProvider` 注册为 `opencode.main` 的 `WebviewViewProvider`
3. 首次 webview 解析时：
   a. `BackendLauncher.launchBackend()` 生成 `opencode serve` 进程
   b. 解析 stdout 中的 `opencode server listening on http://...` 获取端口
   c. `IdeBridgeServer` 在临时端口启动，创建带处理程序的会话
   d. `WebviewController.load()` 构建带桥接参数的 iframe URL
   e. WebGUI 在 iframe 中加载，连接 opencode 服务器和 IDE 桥接

### IDE 插件生命周期（JetBrains）

1. 调用 `ChatToolWindowFactory.createToolWindowContent()`
2. `BackendLauncher.launchBackend()` 在 IDE 终端中启动 `opencode serve`
3. 解析终端输出获取服务器 URL
4. 创建 JCEF 浏览器，`IdeBridge.createSession()` 提供桥接参数
5. 浏览器加载带有 `ideBridge` 和 `ideBridgeToken` 查询参数的 WebGUI URL

### IDE 桥接通信

两个 IDE 插件均使用相同的 HTTP+SSE 传输协议（文档见 `hosts/IDE_BRIDGE_HTTP_SSE.md`）：

1. **WebGUI → IDE：** HTTP POST 到 `{bridgeBase}/send?token=...`
   - 消息类型：`openFile`、`openUrl`、`reloadPath`、`clipboardWrite`、`storageGet`、`storageSet`、`restartHost`、`ensureAndOpenFile`
2. **IDE → WebGUI：** SSE 流在 `{bridgeBase}/events?token=...`
   - 消息类型：`insertPaths`、`pastePath`、`updateOpenedFiles`
3. **请求/响应：** 带有 `id`/`replyTo` 的 JSON 消息，用于 RPC 风格调用
4. **认证：** 每个会话使用随机 UUID token 作为查询参数

### 状态管理（WebGUI）

- **SessionContext：** 当前会话选择、会话 CRUD、会话列表管理
- **MessagesContext：** 按会话的消息存储，处理 SSE 事件用于实时更新
- **ThemeContext：** 明/暗模式检测和同步
- **ProjectContext：** 当前项目目录信息
- **ProvidersContext：** AI 提供商配置
- **UISettingsContext：** 用户偏好设置（通过 IDE 桥接存储持久化）
- **TabStore：** 多标签页会话管理
- **SubtaskDrawerContext：** Agent 子任务可视化

状态通过 React Context 向下传递。服务端事件通过 SSE → EventEmitter → Context 更新向上传递。

## 核心模式

### 事件驱动架构

opencode 核心使用**基于 Effect 的 PubSub 事件总线**（`src/bus/index.ts`）：

- 所有领域事件通过 `BusEvent.define()` 配合 Zod schema 定义
- 组件发布事件；SSE `/event` 路由订阅所有事件并流式传输
- `Bus.subscribeAll()` 是 SSE 消费者的主要模式
- 每 10 秒发送心跳以防止连接过期

### 实例/工作区隔离

服务器通过 `WorkspaceRouterMiddleware` 支持多个并发工作区：

- 每个请求携带 `directory` 查询参数或 `x-opencode-directory` 请求头
- `Instance.provide()` 为每个请求设置 AsyncLocalStorage 上下文
- `InstanceState`（Effect `ScopedCache`）管理每个目录的状态，支持自动清理

### 嵌入式 Web UI 模式

WebGUI 编译为静态资源，然后 base64 编码到生成的 TypeScript 文件中：

- 构建：`packages/opencode/webgui/` → Vite 构建 → `packages/opencode/webgui-dist/`
- 嵌入：生成到 `packages/opencode/src/webgui/embed.generated.ts`
- 服务：`packages/opencode/src/webgui/server/app.ts` 解析路径，从内存提供服务
- 路由：Hono 服务器上的 `/app` 和 `/app/*`

### 统一 IDE 桥接协议

VSCode 和 JetBrains 插件均实现相同的 HTTP+SSE 桥接协议：

- 在 `127.0.0.1:0` 上的本地 HTTP 服务器（临时端口）
- 基于会话，使用 UUID token
- SSE 用于服务端推送，HTTP POST 用于客户端发送
- 每 15 秒 Keepalive ping
- 通过 `vscode.env.asExternalUri()` 支持 VSCode Remote-SSH

## 入口点

### CLI

- **位置：** `packages/opencode/src/index.ts`
- **触发方式：** 通过 yargs CLI 的 `opencode` 二进制文件
- **关键命令：** `serve`（无头服务器）、`run`（TUI）、`web`（浏览器 UI）

### HTTP 服务器

- **位置：** `packages/opencode/src/server/server.ts`
- **触发方式：** `opencode serve` 命令
- **监听：** 可配置的主机名/端口（默认 `0.0.0.0:4096`）
- **路由：** 全局路由在 `/global/*`，实例路由通过工作区中间件，WebGUI 在 `/app/*`

### WebGUI

- **位置：** `packages/opencode/webgui/src/main.tsx`
- **触发方式：** 浏览器/webview 加载 `/app` URL
- **连接到：** 同源 opencode 服务器（REST + SSE）

### VSCode 扩展

- **位置：** `hosts/vscode-plugin/src/extension.ts`
- **触发方式：** `onView:opencode.main`、`onCommand:opencode.openPanel`
- **导出：** `activate()`、`deactivate()`

### JetBrains 插件

- **位置：** `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`
- **触发方式：** 在 `plugin.xml` 中注册的工具窗口工厂

## 错误处理

### 服务端

- **策略：** Hono `onError` 中间件捕获并格式化错误
- **类型化错误：** `NamedError` 基类，带有结构化 `toObject()` 序列化
- **日志：** `Log` 工具写入文件日志

### WebGUI

- **策略：** 顶层 `ErrorBoundary` 组件捕获 React 渲染错误
- **API 错误：** SDK 客户端返回 `{ data, error }` 元组（不抛出异常）
- **连接错误：** SSE 连接断开时显示 `OfflineBanner`
- **重连：** `useEventStream` 中的指数退避重连（初始 1 秒，最大 30 秒）

### IDE 插件

- **VSCode：** `ErrorHandler` 工具，带分类错误（`BACKEND_LAUNCH`、`NETWORK`、`PERMISSION` 等）
- **JetBrains：** 标准 IntelliJ `Logger`，在工具窗口中显示错误面板

## 横切关注点

### 日志

- **后端：** `packages/opencode/src/util/log.ts` 的 `Log` 工具——基于文件，带服务标签
- **WebGUI：** 带 `[App]`、`[SSE Event]` 前缀的 `console.log`；`sdk` 也通过 `POST /log` 远程记录日志
- **IDE 插件：** VSCode `OutputChannel`（`globals.ts` 中的 `logger`）；JetBrains IntelliJ `Logger`

### 配置

- **后端：** 项目根目录的 `opencode.json` + XDG 数据目录中的全局配置
- **WebGUI：** 通过 `sdk.config.get()` HTTP API 读取配置
- **VSCode：** `vscode.workspace.getConfiguration("opencode")` 获取 `customCommand`、`minVersion`
- **JetBrains：** `OpenCodeSettings` 持久化状态组件

### 认证

- **AI 提供商：** 通过 `/auth` 和 `/provider` 路由的 OAuth 流程和 API 密钥管理
- **服务器认证：** 通过 `OPENCODE_SERVER_PASSWORD` 环境变量的可选基本认证
- **IDE 桥接：** 每个会话使用随机 UUID token（非持久化）

### 构建流水线

- **Monorepo：** Bun 工作区 + Turborepo 任务编排
- **WebGUI 构建：** Vite → `webgui-dist/` → 嵌入脚本 → `embed.generated.ts`
- **VSCode 插件：** `hosts/scripts/build_vscode.sh` - 编译 TS，可选打包 opencode 二进制文件，打包 `.vsix`
- **JetBrains 插件：** Gradle 配合 `org.jetbrains.intellij.platform` 插件 → `.zip`

---

_架构分析：2026-04-12_
