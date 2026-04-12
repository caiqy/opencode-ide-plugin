<!-- GSD:project-start source:PROJECT.md -->

## Project

**OpenCode IDE Plugin**

基于开源 opencode 项目的 IDE 插件，提供 WebGUI 前端界面 + VSCode/JetBrains 插件包装，让开发者在 IDE 内直接使用 opencode 的 AI 编码能力，与上游原有的 TUI 终端界面并存。

**核心价值：** 上游合并后构建通过且功能不退化——在持续跟进 opencode 上游更新的同时，保证 webgui 和 IDE 插件始终可用。

### 约束

- **上游兼容**: 合并时尽量同时保留上游和 webgui 的逻辑，需要二选一时提出方案让用户选择
- **技术栈**: 前端 React 19 + Vite + Tailwind，VSCode 用 TypeScript，JetBrains 用 Kotlin
- **包管理**: 根目录用 Bun，VSCode 插件用 pnpm，JetBrains 用 Gradle
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## 语言

- TypeScript 5.8.2（catalog）— 核心后端（`packages/opencode/`）、WebGUI 前端（`packages/opencode/webgui/`）、VSCode 扩展（`hosts/vscode-plugin/`）
- Kotlin 1.9.23 — JetBrains IDE 插件（`hosts/jetbrains-plugin/`）
- Bash — 构建和 CI 脚本（`hosts/scripts/`、`script/`）
- Nix — 可复现构建和开发环境（`flake.nix`、`nix/`）

## 运行时

- Bun 1.3.11 — 核心 `packages/opencode/` 服务器的主要运行时和包管理器
- Node.js 22 — 用作备选/次要目标（`@tsconfig/node22`）
- 浏览器 — 由 opencode 后端在 `/app` 路径提供服务的 React SPA
- Node.js（VS Code 宿主进程）— VSCode 扩展 API 下的扩展运行时
- JVM 21 — IntelliJ Platform 2024.3+（`hosts/jetbrains-plugin/build.gradle.kts`）
- Bun 1.3.11 — 主要（根 `packageManager` 字段）
- pnpm 9.0.0 — VSCode 扩展使用（`hosts/vscode-plugin/package.json`）
- Gradle（Gradle Wrapper）— JetBrains 插件构建（`hosts/jetbrains-plugin/gradlew`）
- 锁文件：根目录存在 `bun.lock`

## 框架

- Hono 4.10.7 — opencode API 的 HTTP 服务器框架（`packages/opencode/src/server/server.ts`）
- Effect 4.0.0-beta.42 — 用于核心中服务组合和类型化错误的函数式 Effect 系统
- Drizzle ORM 1.0.0-beta.19 — 数据库访问层，schema 在 `src/**/*.sql.ts` 中
- React 19.1 — UI 框架
- Vite 7.1.4 — 构建工具和开发服务器（`vite.config.ts`）
- Tailwind CSS 4.1.16 — 原子化 CSS 框架，带 PostCSS 集成
- Lexical 0.37.0 — 消息输入的富文本编辑器（`@lexical/react`）
- VSCode Extension API ^1.74.0 — 扩展框架（`@types/vscode`）
- TypeScript — 通过 `tsc` 编译到 `out/extension.js`
- IntelliJ Platform SDK 2024.3 — 通过 `org.jetbrains.intellij.platform` Gradle 插件 2.2.1 的插件框架
- Jackson 2.17.1 — JSON 序列化（`jackson-module-kotlin`）
- Vitest 4.0.13 — WebGUI 单元测试（`packages/opencode/webgui/vitest.config.ts`）
- Testing Library (React) 16.3.0 — WebGUI 组件测试
- Bun test — 核心 opencode 包测试（`packages/opencode/`）
- Mocha 10.2.0 — VSCode 扩展测试
- JUnit 5.10.0 + Mockito 5.5.0 — JetBrains 插件测试
- Turborepo 2.8.13 — Monorepo 任务编排（`turbo.json`）
- `tsgo`（TypeScript 原生预览 7.0）— 快速类型检查（通过 `tsgo --noEmit` 执行 `bun typecheck`）
- esbuild — 通过 Vite 构建进行压缩
- Prettier 3.6.2 — 代码格式化（semi: false, printWidth: 120）
- ESLint — WebGUI 和 VSCode 扩展的代码检查
- Husky 9.1.7 — Git hooks

## 核心依赖

- `ai` 6.0.138 — Vercel AI SDK（核心）
- `@ai-sdk/anthropic` 3.0.64 — Anthropic 提供商
- `@ai-sdk/openai` 3.0.48 — OpenAI 提供商
- `@ai-sdk/google` 3.0.53 — Google AI 提供商
- `@ai-sdk/amazon-bedrock` 4.0.83 — AWS Bedrock 提供商
- `@ai-sdk/azure` 3.0.49 — Azure AI 提供商
- `@ai-sdk/google-vertex` 4.0.95 — Google Vertex AI 提供商
- `@ai-sdk/xai` 3.0.74 — xAI 提供商
- `@ai-sdk/groq`、`@ai-sdk/mistral`、`@ai-sdk/cerebras`、`@ai-sdk/cohere`、`@ai-sdk/deepinfra`、`@ai-sdk/togetherai`、`@ai-sdk/perplexity`、`@ai-sdk/vercel`、`@ai-sdk/gateway` — 其他提供商
- `@openrouter/ai-sdk-provider` 2.3.3 — OpenRouter
- `gitlab-ai-provider` 6.0.0 — GitLab AI
- `@modelcontextprotocol/sdk` 1.27.1 — MCP（Model Context Protocol）客户端
- `@agentclientprotocol/sdk` 0.14.1 — Agent Client Protocol
- `@octokit/rest` 22.0.1 — GitHub API 客户端
- `hono-openapi` 1.1.2 — 从 Hono 路由生成 OpenAPI 规范
- `@opencode-ai/sdk` workspace — 为 opencode HTTP API 生成的 TypeScript SDK
- `react-syntax-highlighter` 15.6.1 — 代码语法高亮
- `react-markdown` 10.1.0 + `remark-gfm` 4.0.1 — Markdown 渲染
- `diff` ^7.0.0 — 文件变更显示的文本差异比对
- `fuzzysort` 3.1.0 — 命令面板和会话搜索的模糊搜索
- `happy-dom` 20.0.10 / `jsdom` 27.2.0 — 测试 DOM 环境
- `zod` 4.1.8 — Schema 验证
- `solid-js` 1.9.10 — 用于 TUI（终端 UI，非 WebGUI）
- `web-tree-sitter` 0.25.10 + `tree-sitter-bash` — 语法解析
- `chokidar` 4.0.3 — 文件监听
- `@parcel/watcher` 2.5.1 — 原生文件系统监听器（带平台特定二进制文件）
- `bun-pty` 0.4.8 — 用于工具执行的伪终端
- `turndown` 7.2.0 — HTML 到 Markdown 转换

## 配置

- 存在 `.env` 文件 — 包含 API 密钥和服务器配置（仅记录存在性）
- `opencode.json` — 项目级工具/权限配置
- `bunfig.toml` — Bun 配置（精确安装、测试根保护）
- `tsconfig.json`（根目录）— 继承 `@tsconfig/bun`
- `packages/opencode/webgui/tsconfig.json` — app 和 node 配置的项目引用
- `packages/opencode/webgui/vite.config.ts` — Vite 配置：base `/app`，构建到 `../webgui-dist`
- `packages/opencode/webgui/vitest.config.ts` — Vitest：jsdom 环境，`@` 路径别名到 `./src`
- `packages/opencode/webgui/postcss.config.js` — PostCSS 配合 `@tailwindcss/postcss` + autoprefixer
- `packages/opencode/webgui/tailwind.config.js` — Tailwind：darkMode `"class"`，扫描 `./src/**/*.{js,ts,jsx,tsx}`
- `turbo.json` — Turborepo 流水线配置，用于 typecheck、build、test 任务
- `hosts/jetbrains-plugin/build.gradle.kts` — JetBrains 插件的 Gradle 构建
- `hosts/jetbrains-plugin/gradle.properties` — JVM 参数、Gradle 缓存/并行、最低 opencode 版本
- `packages/*`
- `packages/console/*`
- `packages/sdk/js`
- `packages/slack`
- `packages/opencode/webgui`

## 平台要求

- Bun 1.3.11+ 用于核心开发
- Node.js 18+ 用于 VSCode 扩展开发
- JDK 21 用于 JetBrains 插件开发
- pnpm 9+ 用于 VSCode 扩展（`hosts/vscode-plugin/`）
- opencode 后端：编译的 Bun 二进制文件（平台特定：linux/mac/windows × x64/arm64）
- WebGUI：由 opencode HTTP 服务器在 `/app` 路径提供服务的静态构建
- VSCode 扩展：通过 `@vscode/vsce` 发布的 `.vsix` 包
- JetBrains 插件：通过 IntelliJ Platform Gradle 插件构建的 `.zip` 包
- `@opencode-ai/sdk` — 使用 `@hey-api/openapi-ts` 0.90.10 从 Hono OpenAPI 规范生成的 TypeScript SDK
- 通过 `./packages/sdk/js/script/build.ts` 重新生成
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## 风格指南

### 权威来源

### 通用原则

- 除非需要组合或复用，否则将逻辑保留在一个函数中
- 尽可能避免 `try`/`catch`
- 避免使用 `any` 类型
- 尽可能使用单词变量名
- 尽可能使用 Bun API（例如 `Bun.file()`）
- 依赖类型推断；除非为了导出或清晰性，否则避免显式类型注解或接口
- 优先使用函数式数组方法（`flatMap`、`filter`、`map`）而非 `for` 循环；在 `filter` 上使用类型守卫以维持下游的类型推断

### 格式化

- **Prettier**（在根 `package.json` 中配置）：
- **EditorConfig**（`.editorconfig`）：
- **Husky**（`.husky/`）配置了 git hooks（通过 `prepare` 脚本）

### 模块系统

- 所有包使用 `"type": "module"`（ES 模块）
- 仅使用 `import`/`export` 语法，不使用 `require()`

### TypeScript 严格性

- WebGUI（`packages/opencode/webgui/tsconfig.app.json`）：`strict: true`、`noUnusedLocals: true`、`noUnusedParameters: true`、`noFallthroughCasesInSwitch: true`
- VSCode 插件（`hosts/vscode-plugin/tsconfig.json`）：标准 TypeScript 编译
- 根目录继承 `@tsconfig/bun/tsconfig.json`
- 类型检查：始终从包目录运行 `bun typecheck`，不直接使用 `tsc`

## 命名规范

### 强制命名规则（Agent 编写的代码）

### 文件

- **WebGUI 组件：** React 组件使用 PascalCase（`MessageInput.tsx`、`CompactHeader/`、`SubtaskDrawer/`）
- **WebGUI hooks：** camelCase 并以 `use` 为前缀（`useDebounce.ts`、`useClickOutside.ts`）
- **WebGUI 状态：** Context 文件使用 PascalCase（`SessionContext.tsx`、`ThemeContext.tsx`），store 使用 camelCase（`tabStore.ts`、`scopedStorage.ts`）
- **WebGUI lib/utils：** camelCase（`ideBridge.ts`、`classNames.ts`、`formatting.ts`）
- **WebGUI repos（state/repo/）：** camelCase 并以 `Repo` 为后缀（`draftRepo.ts`、`tabsRepo.ts`、`themeRepo.ts`）
- **VSCode 插件：** 类使用 PascalCase（`BackendLauncher.ts`、`WebviewManager.ts`、`ErrorHandler.ts`）
- **VSCode 插件命令：** PascalCase（`AddToContextCommand.ts`、`PastePathCommand.ts`）
- **测试文件：** 同名并置，添加 `.test.ts` 或 `.test.tsx` 后缀（`tabPolicy.test.ts`、`SessionContext.test.tsx`）
- **测试文件（主题范围）：** 在 `.test` 前使用点分隔的主题后缀（`MessagesContext.questions.test.tsx`、`MessagesContext.pagination.test.tsx`）
- **上游 opencode schema：** snake_case 并以 `.sql.ts` 为后缀（`session.sql.ts`、`project.sql.ts`）

### 变量和函数

- 优先使用单词名称：`gate`、`draft`、`proc`、`conn`
- 多词时使用 camelCase：`handleNewSession`、`loadSessionMessages`
- React 回调处理程序：以 `handle` 为前缀（`handleRetrySessionLoad`、`handleOpenPanel`）
- 布尔变量：需要时使用 `is`/`has` 前缀（`isCreating`、`isRunning`、`disposed`）

### 类型和接口

- 类型和接口使用 PascalCase：`Message`、`StorageScope`、`ClassNameValue`
- 仅类型导入：仅导入类型时使用 `import type`
- 品牌 schema 使用 `Schema.brand` 用于单值类型（上游 Effect 代码）

### Drizzle Schema（数据库）

## 解构

## 变量

## 控制流

## 文件组织模式

### WebGUI (`packages/opencode/webgui/src/`)

### VSCode 插件 (`hosts/vscode-plugin/src/`)

### 上游 opencode (`packages/opencode/src/`)

- 按领域组织的功能模块：`session/`、`project/`、`account/`、`share/` 等
- 每个领域在 `*.sql.ts` 文件中有 schema
- 基于 Effect 的架构和服务

## 常用模式

### React Context Provider 模式（WebGUI）

### 从组件中提取可测试的纯函数（WebGUI）

### Scoped Storage / Repo 模式（WebGUI）

### VSCode 扩展类模式

### IDE 桥接通信

- 使用 EventSource 接收服务端推送事件
- 通过 POST 请求配合关联 ID 实现请求/响应
- 指数退避重连
- Scoped storage（global/workspace/mem）用于状态持久化

### 输入指示器模式

## 错误处理

### WebGUI

- SDK 调用的错误返回 `{ data, error }` 元组——检查 `error` 字段而非使用 try/catch
- 通过 `useToast()` context 以 Toast 通知显示面向用户的错误
- `ErrorBoundary` 组件包裹整个应用以捕获 React 渲染错误
- 使用 `[Component]` 前缀的 console 日志用于调试：`console.log("[App] Session created:", id)`

### VSCode 插件

- 集中式 `ErrorHandler` 工具，带分类错误（`ErrorCategory`、`ErrorSeverity`）
- `errorHandler.handleError()` 带结构化错误上下文
- 特化处理程序：`handleBackendLaunchError()`、`handleWebviewLoadError()`、`handleFileOperationError()`
- 安全释放模式：释放期间的错误被捕获和记录，清理继续：

### 上游 opencode

- 基于 Effect 的错误处理，使用 `Schema.TaggedErrorClass` 实现类型化错误
- `yield* new MyError(...)` 用于在 `Effect.gen` / `Effect.fn` 中提前失败
- 如 AGENTS.md 所述，避免 `try`/`catch`

## 导入/导出模式

### WebGUI 导入顺序（观察到的）

### WebGUI 重导出

### VSCode 插件导入顺序

### 路径别名

- WebGUI 使用 `@/` 别名映射到 `./src/`（在 `vitest.config.ts` 中配置，但未一致使用——大多数导入使用相对路径）

### 模块导出

- WebGUI：优先使用命名导出而非默认导出（例外：`App.tsx` 的默认导出）
- 上游：通过 `package.json` 的 `exports` 字段进行桶导出：`"./*": "./src/*.ts"`
- VSCode 插件：命名类导出

## 语言说明

- 部分测试描述和 UI 字符串使用中文（例如 `"replyQuestion 遇到结构化 error 时不应移除本地问题"`、`"创建会话失败"`）
- 这是有意为之，属于本分叉的代码库规范
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## 系统概览

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

## 组件图

### 1. Opencode 核心 (`packages/opencode/`)

- **用途：** AI Agent 编排、会话管理、代码编辑、工具执行
- **入口点：** `packages/opencode/src/index.ts`（通过 yargs 的 CLI）
- **服务器：** `packages/opencode/src/server/server.ts`（支持 SSE 的 Hono HTTP 服务器）
- **核心子系统：**

### 2. WebGUI (`packages/opencode/webgui/`)

- **嵌入模式：** 预构建并 base64 编码到 `packages/opencode/src/webgui/embed.generated.ts`，由 opencode 服务器在 `/app` 路径提供服务
- **开发模式：** Vite 开发服务器，代理请求到 opencode 后端
- **用途：** 聊天界面、会话管理、设置、文件浏览
- **入口点：** `packages/opencode/webgui/src/main.tsx`
- **核心区域：**

### 3. VSCode 插件 (`hosts/vscode-plugin/`)

- **用途：** 将 opencode 集成到 VSCode 活动栏面板中
- **入口点：** `hosts/vscode-plugin/src/extension.ts`
- **核心组件：**

### 4. JetBrains 插件 (`hosts/jetbrains-plugin/`)

- **用途：** 将 opencode 集成到 JetBrains IDE 的工具窗口中
- **入口点：** `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`
- **核心组件：**

### 5. SDK (`packages/sdk/js/`)

- **用途：** opencode HTTP API 的类型安全客户端
- **来源：** `packages/sdk/openapi.json`（从 Hono 路由元数据生成）
- **使用者：** WebGUI（`packages/opencode/webgui/src/lib/api/sdkClient.ts`）

## 数据流

### 聊天消息流

### IDE 插件生命周期（VSCode）

### IDE 插件生命周期（JetBrains）

### IDE 桥接通信

### 状态管理（WebGUI）

- **SessionContext：** 当前会话选择、会话 CRUD、会话列表管理
- **MessagesContext：** 按会话的消息存储，处理 SSE 事件用于实时更新
- **ThemeContext：** 明/暗模式检测和同步
- **ProjectContext：** 当前项目目录信息
- **ProvidersContext：** AI 提供商配置
- **UISettingsContext：** 用户偏好设置（通过 IDE 桥接存储持久化）
- **TabStore：** 多标签页会话管理
- **SubtaskDrawerContext：** Agent 子任务可视化

## 核心模式

### 事件驱动架构

- 所有领域事件通过 `BusEvent.define()` 配合 Zod schema 定义
- 组件发布事件；SSE `/event` 路由订阅所有事件并流式传输
- `Bus.subscribeAll()` 是 SSE 消费者的主要模式
- 每 10 秒发送心跳以防止连接过期

### 实例/工作区隔离

- 每个请求携带 `directory` 查询参数或 `x-opencode-directory` 请求头
- `Instance.provide()` 为每个请求设置 AsyncLocalStorage 上下文
- `InstanceState`（Effect `ScopedCache`）管理每个目录的状态，支持自动清理

### 嵌入式 Web UI 模式

- 构建：`packages/opencode/webgui/` → Vite 构建 → `packages/opencode/webgui-dist/`
- 嵌入：生成到 `packages/opencode/src/webgui/embed.generated.ts`
- 服务：`packages/opencode/src/webgui/server/app.ts` 解析路径，从内存提供服务
- 路由：Hono 服务器上的 `/app` 和 `/app/*`

### 统一 IDE 桥接协议

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
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, or `.github/skills/` with a `SKILL.md` index file.

<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.

<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.

<!-- GSD:profile-end -->
