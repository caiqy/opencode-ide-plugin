# Technology Stack

**Analysis Date:** 2026-04-12

## Languages

**Primary:**

- TypeScript 5.8.2 (catalog) — Core backend (`packages/opencode/`), WebGUI frontend (`packages/opencode/webgui/`), VSCode extension (`hosts/vscode-plugin/`)
- Kotlin 1.9.23 — JetBrains IDE plugin (`hosts/jetbrains-plugin/`)

**Secondary:**

- Bash — Build and CI scripts (`hosts/scripts/`, `script/`)
- Nix — Reproducible builds and development environments (`flake.nix`, `nix/`)

## Runtime

**Backend (opencode core):**

- Bun 1.3.11 — Primary runtime and package manager for the core `packages/opencode/` server
- Node.js 22 — Used as fallback/secondary target (`@tsconfig/node22`)

**WebGUI Frontend:**

- Browser — React SPA served by the opencode backend at `/app`

**VSCode Extension:**

- Node.js (VS Code host process) — Extension runtime under VSCode's extension API

**JetBrains Plugin:**

- JVM 21 — IntelliJ Platform 2024.3+ (`hosts/jetbrains-plugin/build.gradle.kts`)

**Package Manager:**

- Bun 1.3.11 — Primary (root `packageManager` field)
- pnpm 9.0.0 — Used by the VSCode extension (`hosts/vscode-plugin/package.json`)
- Gradle (Gradle Wrapper) — JetBrains plugin build (`hosts/jetbrains-plugin/gradlew`)
- Lockfile: `bun.lock` present at root

## Frameworks

**Core Backend:**

- Hono 4.10.7 — HTTP server framework for the opencode API (`packages/opencode/src/server/server.ts`)
- Effect 4.0.0-beta.42 — Functional effect system for service composition and typed errors across the core
- Drizzle ORM 1.0.0-beta.19 — Database access layer with schema in `src/**/*.sql.ts`

**WebGUI Frontend (`packages/opencode/webgui/`):**

- React 19.1 — UI framework
- Vite 7.1.4 — Build tool and dev server (`vite.config.ts`)
- Tailwind CSS 4.1.16 — Utility CSS framework with PostCSS integration
- Lexical 0.37.0 — Rich text editor for the message input (`@lexical/react`)

**VSCode Extension (`hosts/vscode-plugin/`):**

- VSCode Extension API ^1.74.0 — Extension framework (`@types/vscode`)
- TypeScript — Compiled with `tsc` to `out/extension.js`

**JetBrains Plugin (`hosts/jetbrains-plugin/`):**

- IntelliJ Platform SDK 2024.3 — Plugin framework via `org.jetbrains.intellij.platform` Gradle plugin 2.2.1
- Jackson 2.17.1 — JSON serialization (`jackson-module-kotlin`)

**Testing:**

- Vitest 4.0.13 — WebGUI unit tests (`packages/opencode/webgui/vitest.config.ts`)
- Testing Library (React) 16.3.0 — Component tests for WebGUI
- Bun test — Core opencode package tests (`packages/opencode/`)
- Mocha 10.2.0 — VSCode extension tests
- JUnit 5.10.0 + Mockito 5.5.0 — JetBrains plugin tests

**Build/Dev:**

- Turborepo 2.8.13 — Monorepo task orchestration (`turbo.json`)
- `tsgo` (TypeScript native preview 7.0) — Fast type checking (`bun typecheck` via `tsgo --noEmit`)
- esbuild — Minification via Vite build
- Prettier 3.6.2 — Code formatting (semi: false, printWidth: 120)
- ESLint — Linting for WebGUI and VSCode extension
- Husky 9.1.7 — Git hooks

## Key Dependencies

**AI/LLM SDKs (in `packages/opencode/`):**

- `ai` 6.0.138 — Vercel AI SDK (core)
- `@ai-sdk/anthropic` 3.0.64 — Anthropic provider
- `@ai-sdk/openai` 3.0.48 — OpenAI provider
- `@ai-sdk/google` 3.0.53 — Google AI provider
- `@ai-sdk/amazon-bedrock` 4.0.83 — AWS Bedrock provider
- `@ai-sdk/azure` 3.0.49 — Azure AI provider
- `@ai-sdk/google-vertex` 4.0.95 — Google Vertex AI provider
- `@ai-sdk/xai` 3.0.74 — xAI provider
- `@ai-sdk/groq`, `@ai-sdk/mistral`, `@ai-sdk/cerebras`, `@ai-sdk/cohere`, `@ai-sdk/deepinfra`, `@ai-sdk/togetherai`, `@ai-sdk/perplexity`, `@ai-sdk/vercel`, `@ai-sdk/gateway` — Additional providers
- `@openrouter/ai-sdk-provider` 2.3.3 — OpenRouter
- `gitlab-ai-provider` 6.0.0 — GitLab AI

**Protocol/Integration:**

- `@modelcontextprotocol/sdk` 1.27.1 — MCP (Model Context Protocol) client
- `@agentclientprotocol/sdk` 0.14.1 — Agent Client Protocol
- `@octokit/rest` 22.0.1 — GitHub API client
- `hono-openapi` 1.1.2 — OpenAPI spec generation from Hono routes

**WebGUI-specific (`packages/opencode/webgui/`):**

- `@opencode-ai/sdk` workspace — Generated TypeScript SDK for the opencode HTTP API
- `react-syntax-highlighter` 15.6.1 — Code syntax highlighting
- `react-markdown` 10.1.0 + `remark-gfm` 4.0.1 — Markdown rendering
- `diff` ^7.0.0 — Text diffing for file change display
- `fuzzysort` 3.1.0 — Fuzzy search for command palette and session search
- `happy-dom` 20.0.10 / `jsdom` 27.2.0 — Test DOM environments

**Core Utilities:**

- `zod` 4.1.8 — Schema validation
- `solid-js` 1.9.10 — Used in the TUI (terminal UI, not WebGUI)
- `web-tree-sitter` 0.25.10 + `tree-sitter-bash` — Syntax parsing
- `chokidar` 4.0.3 — File watching
- `@parcel/watcher` 2.5.1 — Native file system watcher (with platform-specific binaries)
- `bun-pty` 0.4.8 — Pseudo-terminal for tool execution
- `turndown` 7.2.0 — HTML to Markdown conversion

## Configuration

**Environment:**

- `.env` files present — Contains API keys and server configuration (existence noted only)
- `opencode.json` — Project-level tool/permission configuration
- `bunfig.toml` — Bun configuration (exact installs, test root guard)

**Build Configuration:**

- `tsconfig.json` (root) — Extends `@tsconfig/bun`
- `packages/opencode/webgui/tsconfig.json` — Project references for app and node configs
- `packages/opencode/webgui/vite.config.ts` — Vite config: base `/app`, builds to `../webgui-dist`
- `packages/opencode/webgui/vitest.config.ts` — Vitest: jsdom environment, `@` path alias to `./src`
- `packages/opencode/webgui/postcss.config.js` — PostCSS with `@tailwindcss/postcss` + autoprefixer
- `packages/opencode/webgui/tailwind.config.js` — Tailwind: darkMode `"class"`, scans `./src/**/*.{js,ts,jsx,tsx}`
- `turbo.json` — Turborepo pipeline config for typecheck, build, test tasks
- `hosts/jetbrains-plugin/build.gradle.kts` — Gradle build for JetBrains plugin
- `hosts/jetbrains-plugin/gradle.properties` — JVM args, Gradle caching/parallel, min opencode version

**Monorepo Workspaces (from root `package.json`):**

- `packages/*`
- `packages/console/*`
- `packages/sdk/js`
- `packages/slack`
- `packages/opencode/webgui`

## Platform Requirements

**Development:**

- Bun 1.3.11+ for core development
- Node.js 18+ for VSCode extension development
- JDK 21 for JetBrains plugin development
- pnpm 9+ for VSCode extension (`hosts/vscode-plugin/`)

**Production/Distribution:**

- opencode backend: Compiled Bun binary (platform-specific: linux/mac/windows × x64/arm64)
- WebGUI: Static build served by the opencode HTTP server at `/app` path
- VSCode extension: `.vsix` package published via `@vscode/vsce`
- JetBrains plugin: `.zip` package built via IntelliJ Platform Gradle plugin

**SDK Generation:**

- `@opencode-ai/sdk` — TypeScript SDK generated with `@hey-api/openapi-ts` 0.90.10 from the Hono OpenAPI spec
- Regenerate via `./packages/sdk/js/script/build.ts`

---

_Stack analysis: 2026-04-12_
