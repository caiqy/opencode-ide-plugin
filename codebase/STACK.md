## Technology Stack

### 语言

- TypeScript 5.8.2（catalog）— 核心后端（`packages/opencode/`）、WebGUI 前端（`packages/opencode/webgui/`）、VSCode 扩展（`hosts/vscode-plugin/`）
- Kotlin 1.9.23 — JetBrains IDE 插件（`hosts/jetbrains-plugin/`）
- Bash — 构建和 CI 脚本（`hosts/scripts/`、`script/`）
- Nix — 可复现构建和开发环境（`flake.nix`、`nix/`）

### 运行时

- Bun 1.3.11 — 核心 `packages/opencode/` 服务器的主要运行时和包管理器
- Node.js 22 — 用作备选/次要目标（`@tsconfig/node22`）
- 浏览器 — 由 opencode 后端在 `/app` 路径提供服务的 React SPA
- Node.js（VS Code 宿主进程）— VSCode 扩展 API 下的扩展运行时
- JVM 21 — IntelliJ Platform 2024.3+（`hosts/jetbrains-plugin/build.gradle.kts`）

### 包管理

- Bun 1.3.11 — 主要（根 `packageManager` 字段）
- pnpm 9.0.0 — VSCode 扩展使用（`hosts/vscode-plugin/package.json`）
- Gradle（Gradle Wrapper）— JetBrains 插件构建（`hosts/jetbrains-plugin/gradlew`）
- 锁文件：根目录存在 `bun.lock`

### 框架

| 类别        | 框架                         | 用途                                   |
| ----------- | ---------------------------- | -------------------------------------- |
| HTTP 服务器 | Hono 4.10.7                  | opencode API（`src/server/server.ts`） |
| Effect 系统 | Effect 4.0.0-beta.42         | 服务组合、类型化错误                   |
| ORM         | Drizzle ORM 1.0.0-beta.19    | 数据库访问，schema 在 `*.sql.ts`       |
| UI          | React 19.1                   | WebGUI 前端                            |
| 构建        | Vite 7.1.4                   | 构建工具和开发服务器                   |
| CSS         | Tailwind CSS 4.1.16          | 原子化 CSS，带 PostCSS                 |
| 富文本      | Lexical 0.37.0               | 消息输入编辑器                         |
| VSCode      | Extension API ^1.74.0        | 扩展框架                               |
| JetBrains   | IntelliJ Platform SDK 2024.3 | 插件框架（Gradle 插件 2.2.1）          |
| JSON        | Jackson 2.17.1               | JetBrains 插件序列化                   |

### 测试

- Vitest 4.0.13 — WebGUI 单元测试
- Testing Library (React) 16.3.0 — WebGUI 组件测试
- Bun test — 核心 opencode 包测试
- Mocha 10.2.0 — VSCode 扩展测试
- JUnit 5.10.0 + Mockito 5.5.0 — JetBrains 插件测试

### 构建工具链

- Turborepo 2.8.13 — Monorepo 任务编排（`turbo.json`）
- `tsgo`（TypeScript 原生预览 7.0）— 快速类型检查（`bun typecheck`）
- esbuild — 通过 Vite 构建进行压缩
- Prettier 3.6.2 — 代码格式化（semi: false, printWidth: 120）
- ESLint — WebGUI 和 VSCode 扩展的代码检查
- Husky 9.1.7 — Git hooks

### 核心依赖

**AI SDK 生态：**

- `ai` 6.0.138 — Vercel AI SDK（核心）
- `@ai-sdk/anthropic`、`@ai-sdk/openai`、`@ai-sdk/google`、`@ai-sdk/amazon-bedrock`、`@ai-sdk/azure`、`@ai-sdk/google-vertex`、`@ai-sdk/xai` — 主要提供商
- `@ai-sdk/groq`、`@ai-sdk/mistral`、`@ai-sdk/cerebras`、`@ai-sdk/cohere`、`@ai-sdk/deepinfra`、`@ai-sdk/togetherai`、`@ai-sdk/perplexity`、`@ai-sdk/vercel`、`@ai-sdk/gateway` — 其他提供商
- `@openrouter/ai-sdk-provider` 2.3.3、`gitlab-ai-provider` 6.0.0

**协议与 API：**

- `@modelcontextprotocol/sdk` 1.27.1 — MCP 客户端
- `@agentclientprotocol/sdk` 0.14.1 — Agent Client Protocol
- `@octokit/rest` 22.0.1 — GitHub API
- `hono-openapi` 1.1.2 — OpenAPI 规范生成
- `@opencode-ai/sdk` workspace — 生成的 TypeScript SDK

**前端：**

- `react-syntax-highlighter`、`react-markdown` + `remark-gfm` — 渲染
- `diff` ^7.0.0 — 文本差异比对
- `fuzzysort` 3.1.0 — 模糊搜索

**运行时工具：**

- `zod` 4.1.8 — Schema 验证
- `web-tree-sitter` 0.25.10 — 语法解析
- `chokidar` 4.0.3 / `@parcel/watcher` 2.5.1 — 文件监听
- `bun-pty` 0.4.8 — 伪终端
- `turndown` 7.2.0 — HTML→Markdown

### 配置文件

| 文件                                        | 用途                                       |
| ------------------------------------------- | ------------------------------------------ |
| `opencode.json`                             | 项目级工具/权限配置                        |
| `bunfig.toml`                               | Bun 配置（精确安装、测试根保护）           |
| `tsconfig.json`（根）                       | 继承 `@tsconfig/bun`                       |
| `packages/opencode/webgui/vite.config.ts`   | Vite：base `/app`，构建到 `../webgui-dist` |
| `packages/opencode/webgui/vitest.config.ts` | Vitest：jsdom，`@` → `./src`               |
| `turbo.json`                                | Turborepo 流水线                           |
| `hosts/jetbrains-plugin/build.gradle.kts`   | JetBrains Gradle 构建                      |

### 平台要求

- Bun 1.3.11+ 用于核心开发
- Node.js 18+ 用于 VSCode 扩展开发
- JDK 21 用于 JetBrains 插件开发
- pnpm 9+ 用于 VSCode 扩展（`hosts/vscode-plugin/`）
- `@opencode-ai/sdk` — 使用 `@hey-api/openapi-ts` 0.90.10 从 Hono OpenAPI 规范生成
