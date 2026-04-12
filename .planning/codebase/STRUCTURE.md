# 代码结构

**分析日期：** 2026-04-12

## 目录布局

```
opencode-ide-plugin/
├── packages/                    # Monorepo 包（Bun 工作区）
│   ├── opencode/                # 核心 opencode CLI + 服务器（主包）
│   │   ├── src/                 # 后端源代码
│   │   ├── webgui/              # React WebGUI 前端（独立工作区）
│   │   ├── webgui-dist/         # WebGUI 构建输出（生成）
│   │   ├── test/                # 后端测试
│   │   ├── bin/                 # CLI 二进制入口
│   │   ├── migration/           # Drizzle 数据库迁移
│   │   ├── script/              # 构建脚本
│   │   └── types/               # 类型声明
│   ├── sdk/                     # SDK 包
│   │   ├── js/                  # JavaScript/TypeScript SDK（自动生成）
│   │   └── openapi.json         # OpenAPI 规范（从服务器路由生成）
│   ├── app/                     # Web 应用（上游 SolidJS TUI）
│   ├── plugin/                  # 插件系统类型
│   ├── ui/                      # 共享 UI 组件（上游 SolidJS）
│   ├── util/                    # 共享工具
│   ├── script/                  # 构建/发布脚本
│   ├── console/                 # 控制台仪表盘
│   ├── desktop/                 # 桌面应用（Tauri）
│   ├── desktop-electron/        # 桌面应用（Electron）
│   ├── web/                     # Web 部署
│   ├── storybook/               # 组件 Storybook
│   ├── enterprise/              # 企业版功能
│   ├── extensions/              # 扩展系统
│   ├── function/                # Serverless 函数
│   ├── identity/                # 认证/身份
│   ├── containers/              # 容器配置
│   ├── docs/                    # 文档站点
│   └── slack/                   # Slack 集成
├── hosts/                       # IDE 插件宿主
│   ├── vscode-plugin/           # VSCode 扩展
│   ├── jetbrains-plugin/        # JetBrains 扩展
│   ├── scripts/                 # 两个插件的构建脚本
│   └── IDE_BRIDGE_HTTP_SSE.md   # 桥接协议文档
├── sdks/                        # 外部 SDK 输出
│   └── vscode/                  # VSCode 专用 SDK
├── infra/                       # 基础设施配置
├── script/                      # 根级脚本
├── specs/                       # 规范和设计文档
├── tasks/                       # 任务定义
├── docs/                        # 文档
├── patches/                     # 依赖补丁
├── nix/                         # Nix 构建配置
├── github/                      # GitHub 专用配置
├── .planning/                   # 规划文档
│   └── codebase/                # 代码库分析文档
├── turbo.json                   # Turborepo 配置
├── package.json                 # 根工作区配置
├── bunfig.toml                  # Bun 配置
├── tsconfig.json                # 根 TypeScript 配置
├── sst.config.ts                # SST（serverless）配置
├── opencode.json                # Opencode 项目配置
└── flake.nix                    # Nix flake 开发环境
```

## 目录用途

### `packages/opencode/src/`（后端核心）

系统的核心。包含按领域组织的所有后端逻辑。

```
src/
├── index.ts              # CLI 入口点（yargs）
├── node.ts               # Node.js 兼容性入口
├── agent/                # AI Agent 定义与编排
├── session/              # 聊天会话生命周期
├── provider/             # AI 模型提供商（Anthropic、OpenAI 等）
├── tool/                 # Agent 工具（文件编辑、shell 等）
├── server/               # HTTP API 服务器（Hono）
│   ├── server.ts         # 服务器设置、CORS、中间件
│   ├── router.ts         # 工作区路由中间件
│   ├── instance.ts       # 实例作用域的路由注册
│   ├── routes/           # 按领域组织的路由处理程序
│   │   ├── session.ts    # 会话 CRUD + 消息
│   │   ├── event.ts      # SSE 事件流
│   │   ├── config.ts     # 配置 API
│   │   ├── provider.ts   # 提供商管理
│   │   ├── mcp.ts        # MCP 服务器管理
│   │   ├── file.ts       # 文件操作
│   │   ├── permission.ts # 权限请求
│   │   ├── question.ts   # 交互式问题
│   │   ├── project.ts    # 项目信息
│   │   ├── pty.ts        # PTY/终端
│   │   ├── global.ts     # 全局（非实例）路由
│   │   └── workspace.ts  # 工作区管理
│   ├── event.ts          # 服务器事件定义
│   ├── middleware.ts      # 错误处理中间件
│   ├── projectors.ts     # 事件投影器
│   └── error.ts          # 错误响应辅助函数
├── bus/                  # 事件总线（Effect PubSub）
│   ├── index.ts          # 总线服务和层
│   ├── bus-event.ts      # 事件定义辅助函数
│   └── global.ts         # 全局总线（跨实例）
├── config/               # 配置系统
├── storage/              # 数据库（通过 Drizzle 的 SQLite）
├── project/              # 项目/工作区管理
│   └── instance.ts       # 实例上下文（AsyncLocalStorage）
├── cli/                  # CLI 命令和 UI
│   ├── cmd/              # 命令实现
│   │   ├── serve.ts      # `opencode serve`
│   │   ├── run.ts        # `opencode`（默认 TUI）
│   │   ├── web.ts        # `opencode web`
│   │   └── ...           # 其他命令
│   └── ui.ts             # CLI UI 辅助函数
├── webgui/               # WebGUI 服务
│   ├── embed.generated.ts  # 嵌入的 WebGUI 资源（生成）
│   └── server/
│       └── app.ts        # 从嵌入数据提供静态文件服务
├── effect/               # Effect 框架工具
├── auth/                 # 认证
├── mcp/                  # Model Context Protocol
├── plugin/               # 插件系统
├── skill/                # 技能系统
├── lsp/                  # 语言服务器协议
├── file/                 # 文件操作
├── filesystem/           # 文件系统工具
├── shell/                # Shell 命令执行
├── pty/                  # PTY 管理
├── permission/           # 权限系统
├── question/             # 交互式问题系统
├── snapshot/             # 文件快照/差异
├── command/              # 命令执行
├── format/               # 输出格式化
├── global/               # 全局状态/路径
├── env/                  # 环境检测
├── flag/                 # 特性标志
├── id/                   # ID 生成
├── installation/         # 安装管理
├── worktree/             # Git worktree 管理
├── sync/                 # 状态同步
├── share/                # 会话共享
├── patch/                # 补丁应用
├── control-plane/        # 工作区/适配器编排
├── acp/                  # Agent Control Protocol
├── ide/                  # IDE 集成钩子
└── util/                 # 共享工具
    ├── log.ts            # 日志工具
    ├── filesystem.ts     # 文件系统辅助函数
    ├── context.ts        # AsyncLocalStorage 上下文
    ├── lazy.ts           # 延迟初始化
    ├── queue.ts          # 异步队列
    └── error.ts          # 错误工具
```

### `packages/opencode/webgui/src/`（WebGUI 前端）

React 19 SPA，配合 Tailwind CSS。

```
webgui/src/
├── main.tsx              # React 入口点，Provider 树
├── App.tsx               # 根组件（事件流、会话管理）
├── index.css             # 全局样式
├── vite-env.d.ts         # Vite 类型声明
├── components/           # React 组件
│   ├── MessageList/      # 消息显示（含虚拟化）
│   ├── MessageInput/     # 带 mention 的富文本输入
│   ├── CompactHeader/    # 会话头部栏
│   ├── CommandPalette.tsx  # Cmd+K 命令面板
│   ├── KeyboardShortcutsHelp.tsx  # 快捷键参考
│   ├── OfflineBanner.tsx # 连接状态横幅
│   ├── ChatLoadGuard.tsx # 加载/错误状态
│   ├── VersionGate.tsx   # 服务器版本检查
│   ├── ErrorBoundary.tsx # React 错误边界
│   ├── ModelSelector.tsx # AI 模型选择器
│   ├── AgentSelector.tsx # Agent 选择器
│   ├── MarkdownRenderer.tsx  # Markdown 显示
│   ├── CodeBlock.tsx     # 语法高亮代码块
│   ├── Toast.tsx         # Toast 通知
│   ├── DiffModal/        # 文件差异查看器
│   ├── SubtaskDrawer/    # Agent 子任务面板
│   ├── SettingsPanel/    # 设置 UI
│   ├── parts/            # 消息部分渲染器
│   ├── mention/          # @-mention 系统
│   ├── attachment/       # 文件附件处理
│   ├── command/          # 命令面板命令
│   ├── common/           # 共享 UI 组件
│   └── settings/         # 设置组件
├── state/                # React Context 提供者
│   ├── SessionContext.tsx # 会话管理
│   ├── MessagesContext.tsx  # 消息存储（最大的状态逻辑）
│   ├── ThemeContext.tsx   # 明/暗主题
│   ├── ProjectContext.tsx # 项目元数据
│   ├── ProvidersContext.tsx  # AI 提供商配置
│   ├── UISettingsContext.tsx  # 用户 UI 偏好
│   ├── ToastContext.tsx   # Toast 通知系统
│   ├── IdeBridgeContext.tsx  # IDE 桥接状态
│   ├── SubtaskDrawerContext.tsx  # 子任务抽屉状态
│   ├── tabStore.ts       # 多标签页状态管理
│   ├── tabPolicy.ts      # 标签页行为规则
│   ├── scopedStorage.ts  # Scoped storage（带 IDE 桥接回退）
│   ├── switchSession.ts  # 会话切换逻辑（带标签页回滚）
│   ├── useSessionActivation.ts  # 会话激活 hook
│   ├── sessionPaging.ts  # 会话列表分页
│   └── repo/             # 数据仓库
├── lib/                  # 核心库
│   ├── api/              # API 通信层
│   │   ├── sdkClient.ts  # 扩展的 SDK 客户端（带额外方法）
│   │   ├── events.ts     # SSE 事件流 hook 和 EventEmitter
│   │   └── useSessionEvents.ts  # 会话专用事件处理程序
│   ├── ideBridge.ts      # IDE 桥接客户端（HTTP+SSE）
│   ├── keyboardHandler.ts  # webview 键盘快捷键修复
│   ├── messagesStore.ts  # 消息数据结构辅助函数
│   ├── messageFormatting.ts  # 消息显示格式化
│   ├── dnd.ts            # 拖放处理
│   ├── fileUtils.ts      # 文件路径工具
│   ├── tooltipPolyfill.ts  # Tooltip CSS polyfill
│   ├── selection/        # 文本选择工具
│   ├── task-part.ts      # 任务部分解析
│   └── task-result.ts    # 任务结果解析
├── hooks/                # 自定义 React hooks
│   ├── useKeyboardShortcuts.ts  # 全局键盘快捷键
│   ├── useClickOutside.ts  # 点击外部检测
│   ├── useDebounce.ts    # 防抖值
│   ├── useDropdown.ts    # 下拉框状态
│   ├── useKeyboard.ts    # 键盘事件辅助函数
│   ├── useMentionNavigation.ts  # Mention 导航
│   ├── useMentionSearch.ts  # Mention 搜索
│   ├── useCommandSearch.ts  # 命令搜索
│   ├── useOpenFile.ts    # 通过 IDE 桥接打开文件
│   ├── useMergedFileDiffs.ts  # 差异合并
│   └── useSessionUsage.ts  # Token 用量追踪
├── utils/                # 工具函数
├── types/                # TypeScript 类型定义
├── config/               # WebGUI 配置
├── assets/               # 静态资源
└── test/                 # 测试工具和设置
```

### `hosts/vscode-plugin/src/`（VSCode 扩展）

```
vscode-plugin/src/
├── extension.ts          # 扩展入口（activate/deactivate）
├── globals.ts            # Logger 和共享全局变量
├── backend/              # 后端进程管理
│   ├── BackendLauncher.ts  # 启动/管理 opencode 进程
│   ├── ResourceExtractor.ts  # 提取打包的二进制文件
│   └── kill.ts           # 进程树 kill 工具
├── ui/                   # UI 组件
│   ├── ActivityBarProvider.ts  # 侧边栏 webview 提供者
│   ├── WebviewManager.ts  # 编辑器面板 webview
│   ├── WebviewController.ts  # 共享 webview 生命周期
│   ├── CommunicationBridge.ts  # IDE↔WebGUI 桥接
│   ├── IdeBridgeServer.ts  # HTTP+SSE 桥接服务器
│   └── loading.ts        # 加载 HTML 生成器
├── commands/             # VSCode 命令处理程序
│   ├── AddToContextCommand.ts  # 添加文件到上下文
│   ├── AddLinesToContextCommand.ts  # 添加选中行
│   └── PastePathCommand.ts  # 粘贴目录路径
├── settings/             # 设置管理
│   └── SettingsManager.ts  # VSCode 配置桥接
├── utils/                # 工具类
│   ├── ErrorHandler.ts   # 分类错误处理
│   ├── FileMonitor.ts    # 打开文件追踪
│   ├── PathInserter.ts   # 文件路径插入路由
│   └── RecoveryUtils.ts  # 恢复工具
├── types/                # TypeScript 类型定义
└── test/                 # 测试文件
```

### `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/`（JetBrains 插件）

```
paviko/opencode/
├── ui/                   # UI 层
│   ├── ChatToolWindowFactory.kt  # 工具窗口工厂（主入口）
│   ├── IdeBridge.kt      # HTTP+SSE 桥接服务器
│   ├── IdeBridgeStorageBackend.kt  # 桥接的存储实现
│   ├── DragAndDropInstaller.kt  # 文件拖放支持
│   ├── IdeOpenFilesUpdater.kt  # 打开文件追踪
│   ├── PathInserter.kt   # 文件路径插入
│   └── ConnInfo.kt       # 连接信息数据类
├── backendprocess/       # 后端进程管理
│   ├── BackendLauncher.kt  # 在终端中启动 opencode
│   ├── BackendProcess.kt   # 进程抽象
│   ├── TerminalBackendProcess.kt  # 基于终端的进程
│   ├── RunningTerminalBackendProcess.kt  # 运行中的进程包装器
│   └── TerminalOutputCapture.kt  # 终端输出捕获
├── actions/              # IDE 操作
│   ├── EditorAddToContextAction.kt  # 从编辑器添加文件
│   ├── EditorAddLinesToContextAction.kt  # 从编辑器添加行
│   ├── ProjectAddToContextAction.kt  # 从项目树添加文件
│   └── ProjectPastePathAction.kt  # 从项目树粘贴路径
├── settings/             # 插件设置
│   ├── OpenCodeSettings.kt  # 持久化状态
│   └── OpenCodeConfigurable.kt  # 设置 UI
└── util/
    └── ResourceExtractor.kt  # 二进制资源提取
```

## 核心入口点

| 组件           | 入口文件                                                                             | 用途                                      |
| -------------- | ------------------------------------------------------------------------------------ | ----------------------------------------- |
| CLI            | `packages/opencode/src/index.ts`                                                     | 通过 yargs 的命令行界面                   |
| HTTP 服务器    | `packages/opencode/src/server/server.ts`                                             | Hono HTTP 服务器                          |
| Serve 命令     | `packages/opencode/src/cli/cmd/serve.ts`                                             | `opencode serve` 无头服务器               |
| WebGUI         | `packages/opencode/webgui/src/main.tsx`                                              | React 应用引导                            |
| WebGUI 构建    | `packages/opencode/webgui/vite.config.ts`                                            | Vite 构建配置（输出到 `../webgui-dist/`） |
| 嵌入式 WebGUI  | `packages/opencode/src/webgui/server/app.ts`                                         | 在 `/app` 路径提供嵌入资源服务            |
| VSCode 插件    | `hosts/vscode-plugin/src/extension.ts`                                               | `activate()` / `deactivate()`             |
| JetBrains 插件 | `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt` | 工具窗口工厂                              |
| SDK 生成器     | `packages/sdk/js/script/build.ts`                                                    | 从 OpenAPI 重新生成 JS SDK                |
| OpenAPI 规范   | `packages/sdk/openapi.json`                                                          | 生成的 API 规范                           |

## 模块组织

### 后端路由注册

路由在两个层次注册：

1. **全局路由**（`src/server/server.ts`）：
   - `/global/*` - 全局配置、事件、同步
   - `/auth/*` - 认证
   - `/log` - 远程日志
   - `/app/*` - 嵌入式 WebGUI 静态文件
   - `/doc` - OpenAPI 规范

2. **实例路由**（`src/server/instance.ts`，通过 `WorkspaceRouterMiddleware`）：
   - `/session/*` - 会话管理
   - `/config/*` - 实例配置
   - `/provider/*` - 提供商管理
   - `/mcp/*` - MCP 服务器管理
   - `/event` - SSE 事件流
   - `/permission/*` - 权限系统
   - `/question/*` - 问题系统
   - `/project/*` - 项目信息
   - `/file/*` - 文件操作
   - `/pty/*` - 终端/PTY
   - `/path` - 目录路径
   - `/skill` - 技能
   - `/tui/*` - TUI 专用路由

### 数据库 Schema

Schema 文件遵循 `src/**/*.sql.ts` 模式：

- 表使用 `snake_case` 列名
- Drizzle ORM 配合 `drizzle-kit` 用于迁移
- 迁移在 `packages/opencode/migration/`
- SQLite 数据库位于 `{dataDir}/opencode.db`

## 配置文件

| 文件                                          | 用途                                                     |
| --------------------------------------------- | -------------------------------------------------------- |
| `package.json`（根目录）                      | Monorepo 工作区配置，catalog 依赖                        |
| `turbo.json`                                  | Turborepo 任务配置                                       |
| `bunfig.toml`                                 | Bun 包管理器配置                                         |
| `tsconfig.json`（根目录）                     | 基础 TypeScript 配置                                     |
| `packages/opencode/package.json`              | 核心包配置、依赖、脚本                                   |
| `packages/opencode/tsconfig.json`             | 后端 TypeScript 配置                                     |
| `packages/opencode/drizzle.config.ts`         | Drizzle 迁移配置                                         |
| `packages/opencode/webgui/package.json`       | WebGUI 包配置                                            |
| `packages/opencode/webgui/vite.config.ts`     | Vite 构建配置（base: `/app`，output: `../webgui-dist/`） |
| `packages/opencode/webgui/tailwind.config.js` | Tailwind CSS 配置                                        |
| `packages/opencode/webgui/tsconfig.json`      | WebGUI TypeScript 配置                                   |
| `packages/opencode/webgui/vitest.config.ts`   | Vitest 测试配置                                          |
| `hosts/vscode-plugin/package.json`            | VSCode 扩展清单（命令、视图、菜单）                      |
| `hosts/vscode-plugin/tsconfig.json`           | VSCode 扩展 TypeScript 配置                              |
| `hosts/jetbrains-plugin/build.gradle.kts`     | JetBrains 插件的 Gradle 构建                             |
| `hosts/jetbrains-plugin/gradle.properties`    | 插件版本和元数据                                         |
| `opencode.json`                               | 项目级 opencode 配置                                     |
| `sst.config.ts`                               | SST serverless 基础设施配置                              |

## 命名规范

### 文件

- **后端模块：** 小写、kebab-case 目录，尽可能单词：`src/agent/`、`src/bus/`、`src/tool/`
- **SQL schema 文件：** `*.sql.ts` 模式：`src/session/session.sql.ts`
- **React 组件：** PascalCase：`MessageList.tsx`、`CompactHeader.tsx`
- **React Context：** PascalCase 带 `Context` 后缀：`SessionContext.tsx`、`ThemeContext.tsx`
- **React hooks：** camelCase 带 `use` 前缀：`useKeyboardShortcuts.ts`、`useDebounce.ts`
- **测试文件：** 同名带 `.test.ts` 或 `.test.tsx` 后缀，并置：`ideBridge.test.ts`
- **VSCode 命令：** PascalCase 带 `Command` 后缀：`AddToContextCommand.ts`
- **JetBrains 操作：** PascalCase 带 `Action` 后缀：`EditorAddToContextAction.kt`

### 目录

- 后端：小写、单词：`agent/`、`bus/`、`server/`、`tool/`
- WebGUI：小写：`components/`、`state/`、`hooks/`、`lib/`
- VSCode：小写：`backend/`、`ui/`、`commands/`、`settings/`、`utils/`
- JetBrains：小写：`ui/`、`backendprocess/`、`actions/`、`settings/`

## 新代码添加位置

### 新后端 API 路由

1. 在 `packages/opencode/src/server/routes/{domain}.ts` 中创建路由处理程序
2. 在 `packages/opencode/src/server/instance.ts`（实例作用域）或 `server.ts`（全局）中注册
3. 使用 `hono-openapi` 的 `describeRoute()` + `validator()` 生成 OpenAPI 规范

### 新 WebGUI 组件

1. 在 `packages/opencode/webgui/src/components/{ComponentName}.tsx` 中创建组件
2. 复杂组件使用目录：`components/{ComponentName}/`
3. 并置测试：`components/{ComponentName}.test.tsx`
4. 如果组件需要共享状态，在 `packages/opencode/webgui/src/state/` 中添加 Context
5. 如果组件需要新的 API 调用，扩展 `packages/opencode/webgui/src/lib/api/sdkClient.ts`

### 新 WebGUI Hook

1. 在 `packages/opencode/webgui/src/hooks/use{Name}.ts` 中创建
2. 并置测试：`hooks/use{Name}.test.ts`

### 新 VSCode 命令

1. 在 `hosts/vscode-plugin/src/commands/{Name}Command.ts` 中创建命令类
2. 在 `hosts/vscode-plugin/src/extension.ts` → `registerCommands()` 中注册
3. 在 `hosts/vscode-plugin/package.json` → `contributes.commands` 中添加命令元数据
4. 在 `hosts/vscode-plugin/package.json` → `contributes.keybindings` 中添加快捷键

### 新 JetBrains 操作

1. 在 `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/actions/{Name}Action.kt` 中创建操作类
2. 在 `src/main/resources/META-INF/plugin.xml` 中注册

### 新 IDE 桥接消息类型

1. 在两处添加处理程序：
   - `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts` → `handleSend()`
   - `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt` → `handleInbound()`
2. 在 `packages/opencode/webgui/src/lib/ideBridge.ts` 中添加客户端处理
3. 更新 `hosts/IDE_BRIDGE_HTTP_SSE.md` 文档

### 新后端领域模块

1. 在 `packages/opencode/src/{domain}/` 中创建目录
2. 对于 SQL 表，按照 Drizzle 模式创建 `{domain}.sql.ts`
3. 生成迁移：从 `packages/opencode/` 运行 `bun run db generate --name {slug}`
4. 对于 Effect 服务，使用 `InstanceState.make()` 管理每个工作区的状态
5. 对于总线事件，在模块中使用 `BusEvent.define()` 定义

## 特殊目录

### `packages/opencode/webgui-dist/`

- **用途：** WebGUI 的 Vite 构建输出
- **是否生成：** 是，通过 `bun --cwd packages/opencode/webgui run build`
- **是否提交：** 是（用于生成嵌入资源）
- **使用者：** 创建 `embed.generated.ts` 的构建脚本

### `packages/opencode/src/webgui/embed.generated.ts`

- **用途：** Base64 编码的 WebGUI 静态资源，用于嵌入式服务
- **是否生成：** 是，由 opencode 构建脚本生成
- **是否提交：** 是
- **内容：** 所有 HTML/JS/CSS/图片作为 TypeScript 数组中的 base64 字符串

### `packages/opencode/migration/`

- **用途：** Drizzle SQL 迁移文件
- **是否生成：** 是，通过 `bun run db generate --name {slug}`
- **是否提交：** 是
- **格式：** `{timestamp}_{slug}/migration.sql` + `snapshot.json`

### `hosts/vscode-plugin/out/`

- **用途：** 编译后的 VSCode 扩展 JavaScript
- **是否生成：** 是，通过 `tsc`
- **是否提交：** 否（在 `.gitignore` 中）

### `hosts/jetbrains-plugin/build/`

- **用途：** Gradle 构建输出
- **是否生成：** 是，通过 Gradle
- **是否提交：** 否（在 `.gitignore` 中）

### `packages/sdk/js/`

- **用途：** 从 OpenAPI 规范自动生成的 TypeScript SDK
- **是否生成：** 是，通过 `packages/sdk/js/script/build.ts`
- **是否提交：** 是
- **使用者：** WebGUI 的 `sdkClient.ts` 导入 `@opencode-ai/sdk/client`

---

_结构分析：2026-04-12_
