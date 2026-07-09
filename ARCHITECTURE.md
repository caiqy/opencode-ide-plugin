## Architecture

### 系统概览

```
|                  IDE Host Layer                       |
|  +----------------+    +------------------------+    |
|  | VSCode Plugin  |    | JetBrains Plugin       |    |
|  | (TypeScript)   |    | (Kotlin/JVM)           |    |
|  +------+---------+    +----------+-------------+    |
|         |                         |                  |
|         |   IdeBridge (HTTP+SSE)  |                  |
|         +------------+------------+                  |
|                      |                               |
|              WebGUI (React SPA)                      |
|  Rendered inside IDE webview, communicates with      |
|  opencode server via REST/SSE on same origin         |
|           Opencode Server (Bun/Hono)                 |
|  +--------+  +----------+  +---------+  +--------+  |
|  | Session|  | Provider |  | Agent   |  | MCP    |  |
|  | Mgmt   |  | (AI SDK) |  | System  |  | Server |  |
|  +--------+  +----------+  +---------+  +--------+  |
|  +--------+  +----------+  +---------+  +--------+  |
|  | Config |  | Bus/Event|  | Storage |  | File   |  |
|  | System |  | System   |  | (SQLite)|  | System |  |
|  +--------+  +----------+  +---------+  +--------+  |
```

### 组件

| #   | 组件           | 用途                              | 入口点                                                |
| --- | -------------- | --------------------------------- | ----------------------------------------------------- |
| 1   | Opencode 核心  | AI Agent 编排、会话管理、工具执行 | `packages/opencode/src/index.ts`                      |
| 2   | WebGUI         | 聊天界面、会话管理、设置          | `packages/opencode/webgui/src/main.tsx`               |
| 3   | VSCode 插件    | 集成到 VSCode 活动栏              | `hosts/vscode-plugin/src/extension.ts`                |
| 4   | JetBrains 插件 | 集成到 JetBrains 工具窗口         | `hosts/jetbrains-plugin/.../ChatToolWindowFactory.kt` |
| 5   | SDK            | opencode HTTP API 类型安全客户端  | `packages/sdk/js/`                                    |

---

### 核心模式

#### 事件驱动架构

- 领域事件通过 `BusEvent.define()` + Zod schema 定义
- SSE `/event` 路由订阅所有事件并流式传输
- `Bus.subscribeAll()` 是 SSE 消费者的主要模式
- 每 10 秒心跳防止连接过期

#### 实例/工作区隔离

- 请求携带 `directory` 查询参数或 `x-opencode-directory` 请求头
- `Instance.provide()` 设置 AsyncLocalStorage 上下文
- `InstanceState`（Effect `ScopedCache`）管理每目录状态

#### 嵌入式 Web UI

- 构建：`webgui/` → Vite → `webgui-dist/`
- 嵌入：生成到 `src/webgui/embed.generated.ts`
- 服务：`src/webgui/server/app.ts` 从内存提供，路由 `/app` 和 `/app/*`

#### 统一 IDE 桥接协议

- 本地 HTTP 服务器 `127.0.0.1:0`（临时端口）
- 基于会话 UUID token
- SSE 服务端推送 + HTTP POST 客户端发送
- 每 15 秒 Keepalive ping
- 支持 VSCode Remote-SSH（`vscode.env.asExternalUri()`）

---

### 入口点

| 入口        | 位置                                   | 触发方式                               |
| ----------- | -------------------------------------- | -------------------------------------- |
| CLI         | `packages/opencode/src/index.ts`       | `opencode` 命令（`serve`/`run`/`web`） |
| HTTP 服务器 | `src/server/server.ts`                 | `opencode serve`，默认 `0.0.0.0:4096`  |
| WebGUI      | `webgui/src/main.tsx`                  | 浏览器/webview 加载 `/app`             |
| VSCode      | `hosts/vscode-plugin/src/extension.ts` | `onView:opencode.main`                 |
| JetBrains   | `ChatToolWindowFactory.kt`             | `plugin.xml` 注册的工具窗口            |

---

### 状态管理（WebGUI）

- **SessionContext** — 会话选择、CRUD、列表
- **MessagesContext** — 按会话消息存储，SSE 实时更新
- **ThemeContext** — 明/暗模式
- **ProjectContext** — 当前项目目录
- **ProvidersContext** — AI 提供商配置
- **UISettingsContext** — 用户偏好（IDE 桥接存储持久化）
- **TabStore** — 多标签页会话
- **SubtaskDrawerContext** — Agent 子任务可视化

---

### 横切关注点

**日志：**

- 后端：`Log` 工具（文件日志 + 服务标签）
- WebGUI：`[Component]` 前缀 console.log + `POST /log` 远程日志
- IDE 插件：VSCode `OutputChannel` / JetBrains `Logger`

**配置：**

- 后端：`opencode.json` + XDG 全局配置
- WebGUI：`sdk.config.get()` HTTP API
- VSCode：`vscode.workspace.getConfiguration("opencode")`
- JetBrains：`OpenCodeSettings` 持久化状态

**认证：**

- AI 提供商：OAuth + API 密钥（`/auth`、`/provider` 路由）
- 服务器：可选 `OPENCODE_SERVER_PASSWORD` 基本认证
- IDE 桥接：每会话随机 UUID token

**构建流水线：**

- Monorepo：Bun 工作区 + Turborepo
- WebGUI：Vite → `webgui-dist/` → 嵌入脚本 → `embed.generated.ts`
- VSCode：`hosts/scripts/build_vscode.sh` → `.vsix`
- JetBrains：Gradle + `org.jetbrains.intellij.platform` → `.zip`
