# 技术栈

**分析日期：** 2026-04-12

## 语言

**主要：**

- TypeScript 5.8.2（catalog）— 核心后端（`packages/opencode/`）、WebGUI 前端（`packages/opencode/webgui/`）、VSCode 扩展（`hosts/vscode-plugin/`）
- Kotlin 1.9.23 — JetBrains IDE 插件（`hosts/jetbrains-plugin/`）

**次要：**

- Bash — 构建和 CI 脚本（`hosts/scripts/`、`script/`）
- Nix — 可复现构建和开发环境（`flake.nix`、`nix/`）

## 运行时

**后端（opencode 核心）：**

- Bun 1.3.11 — 核心 `packages/opencode/` 服务器的主要运行时和包管理器
- Node.js 22 — 用作备选/次要目标（`@tsconfig/node22`）

**WebGUI 前端：**

- 浏览器 — 由 opencode 后端在 `/app` 路径提供服务的 React SPA

**VSCode 扩展：**

- Node.js（VS Code 宿主进程）— VSCode 扩展 API 下的扩展运行时

**JetBrains 插件：**

- JVM 21 — IntelliJ Platform 2024.3+（`hosts/jetbrains-plugin/build.gradle.kts`）

**包管理器：**

- Bun 1.3.11 — 主要（根 `packageManager` 字段）
- pnpm 9.0.0 — VSCode 扩展使用（`hosts/vscode-plugin/package.json`）
- Gradle（Gradle Wrapper）— JetBrains 插件构建（`hosts/jetbrains-plugin/gradlew`）
- 锁文件：根目录存在 `bun.lock`

## 框架

**核心后端：**

- Hono 4.10.7 — opencode API 的 HTTP 服务器框架（`packages/opencode/src/server/server.ts`）
- Effect 4.0.0-beta.42 — 用于核心中服务组合和类型化错误的函数式 Effect 系统
- Drizzle ORM 1.0.0-beta.19 — 数据库访问层，schema 在 `src/**/*.sql.ts` 中

**WebGUI 前端（`packages/opencode/webgui/`）：**

- React 19.1 — UI 框架
- Vite 7.1.4 — 构建工具和开发服务器（`vite.config.ts`）
- Tailwind CSS 4.1.16 — 原子化 CSS 框架，带 PostCSS 集成
- Lexical 0.37.0 — 消息输入的富文本编辑器（`@lexical/react`）

**VSCode 扩展（`hosts/vscode-plugin/`）：**

- VSCode Extension API ^1.74.0 — 扩展框架（`@types/vscode`）
- TypeScript — 通过 `tsc` 编译到 `out/extension.js`

**JetBrains 插件（`hosts/jetbrains-plugin/`）：**

- IntelliJ Platform SDK 2024.3 — 通过 `org.jetbrains.intellij.platform` Gradle 插件 2.2.1 的插件框架
- Jackson 2.17.1 — JSON 序列化（`jackson-module-kotlin`）

**测试：**

- Vitest 4.0.13 — WebGUI 单元测试（`packages/opencode/webgui/vitest.config.ts`）
- Testing Library (React) 16.3.0 — WebGUI 组件测试
- Bun test — 核心 opencode 包测试（`packages/opencode/`）
- Mocha 10.2.0 — VSCode 扩展测试
- JUnit 5.10.0 + Mockito 5.5.0 — JetBrains 插件测试

**构建/开发：**

- Turborepo 2.8.13 — Monorepo 任务编排（`turbo.json`）
- `tsgo`（TypeScript 原生预览 7.0）— 快速类型检查（通过 `tsgo --noEmit` 执行 `bun typecheck`）
- esbuild — 通过 Vite 构建进行压缩
- Prettier 3.6.2 — 代码格式化（semi: false, printWidth: 120）
- ESLint — WebGUI 和 VSCode 扩展的代码检查
- Husky 9.1.7 — Git hooks

## 核心依赖

**AI/LLM SDK（在 `packages/opencode/` 中）：**

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

**协议/集成：**

- `@modelcontextprotocol/sdk` 1.27.1 — MCP（Model Context Protocol）客户端
- `@agentclientprotocol/sdk` 0.14.1 — Agent Client Protocol
- `@octokit/rest` 22.0.1 — GitHub API 客户端
- `hono-openapi` 1.1.2 — 从 Hono 路由生成 OpenAPI 规范

**WebGUI 专用（`packages/opencode/webgui/`）：**

- `@opencode-ai/sdk` workspace — 为 opencode HTTP API 生成的 TypeScript SDK
- `react-syntax-highlighter` 15.6.1 — 代码语法高亮
- `react-markdown` 10.1.0 + `remark-gfm` 4.0.1 — Markdown 渲染
- `diff` ^7.0.0 — 文件变更显示的文本差异比对
- `fuzzysort` 3.1.0 — 命令面板和会话搜索的模糊搜索
- `happy-dom` 20.0.10 / `jsdom` 27.2.0 — 测试 DOM 环境

**核心工具：**

- `zod` 4.1.8 — Schema 验证
- `solid-js` 1.9.10 — 用于 TUI（终端 UI，非 WebGUI）
- `web-tree-sitter` 0.25.10 + `tree-sitter-bash` — 语法解析
- `chokidar` 4.0.3 — 文件监听
- `@parcel/watcher` 2.5.1 — 原生文件系统监听器（带平台特定二进制文件）
- `bun-pty` 0.4.8 — 用于工具执行的伪终端
- `turndown` 7.2.0 — HTML 到 Markdown 转换

## 配置

**环境：**

- 存在 `.env` 文件 — 包含 API 密钥和服务器配置（仅记录存在性）
- `opencode.json` — 项目级工具/权限配置
- `bunfig.toml` — Bun 配置（精确安装、测试根保护）

**构建配置：**

- `tsconfig.json`（根目录）— 继承 `@tsconfig/bun`
- `packages/opencode/webgui/tsconfig.json` — app 和 node 配置的项目引用
- `packages/opencode/webgui/vite.config.ts` — Vite 配置：base `/app`，构建到 `../webgui-dist`
- `packages/opencode/webgui/vitest.config.ts` — Vitest：jsdom 环境，`@` 路径别名到 `./src`
- `packages/opencode/webgui/postcss.config.js` — PostCSS 配合 `@tailwindcss/postcss` + autoprefixer
- `packages/opencode/webgui/tailwind.config.js` — Tailwind：darkMode `"class"`，扫描 `./src/**/*.{js,ts,jsx,tsx}`
- `turbo.json` — Turborepo 流水线配置，用于 typecheck、build、test 任务
- `hosts/jetbrains-plugin/build.gradle.kts` — JetBrains 插件的 Gradle 构建
- `hosts/jetbrains-plugin/gradle.properties` — JVM 参数、Gradle 缓存/并行、最低 opencode 版本

**Monorepo 工作区（来自根 `package.json`）：**

- `packages/*`
- `packages/console/*`
- `packages/sdk/js`
- `packages/slack`
- `packages/opencode/webgui`

## 平台要求

**开发：**

- Bun 1.3.11+ 用于核心开发
- Node.js 18+ 用于 VSCode 扩展开发
- JDK 21 用于 JetBrains 插件开发
- pnpm 9+ 用于 VSCode 扩展（`hosts/vscode-plugin/`）

**生产/分发：**

- opencode 后端：编译的 Bun 二进制文件（平台特定：linux/mac/windows × x64/arm64）
- WebGUI：由 opencode HTTP 服务器在 `/app` 路径提供服务的静态构建
- VSCode 扩展：通过 `@vscode/vsce` 发布的 `.vsix` 包
- JetBrains 插件：通过 IntelliJ Platform Gradle 插件构建的 `.zip` 包

**SDK 生成：**

- `@opencode-ai/sdk` — 使用 `@hey-api/openapi-ts` 0.90.10 从 Hono OpenAPI 规范生成的 TypeScript SDK
- 通过 `./packages/sdk/js/script/build.ts` 重新生成

---

_技术栈分析：2026-04-12_
