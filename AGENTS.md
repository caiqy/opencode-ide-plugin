- To regenerate the JavaScript SDK, run `./packages/sdk/js/script/build.ts`.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- The default branch in this repo is `dev`.
- Local `main` ref may not exist; use `dev` or `origin/dev` for diffs.
- Prefer automation: execute requested actions without confirmation unless blocked by missing info or safety/irreversibility.

## Style Guide

### General Principles

- Keep things in one function unless composable or reusable
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Prefer single word variable names where possible
- Use Bun APIs when possible, like `Bun.file()`
- Rely on type inference when possible; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (flatMap, filter, map) over for loops; use type guards on filter to maintain type inference downstream

### Naming

Prefer single word names for variables and functions. Only use multiple words if necessary.

### Naming Enforcement (Read This)

THIS RULE IS MANDATORY FOR AGENT WRITTEN CODE.

- Use single word names by default for new locals, params, and helper functions.
- Multi-word names are allowed only when a single word would be unclear or ambiguous.
- Do not introduce new camelCase compounds when a short single-word alternative is clear.
- Before finishing edits, review touched lines and shorten newly introduced identifiers where possible.
- Good short names to prefer: `pid`, `cfg`, `err`, `opts`, `dir`, `root`, `child`, `state`, `timeout`.
- Examples to avoid unless truly required: `inputPID`, `existingClient`, `connectTimeout`, `workerPath`.

```ts
// Good
const foo = 1
function journal(dir: string) {}

// Bad
const fooBar = 1
function prepareJournal(dir: string) {}
```

Reduce total variable count by inlining when a value is only used once.

```ts
// Good
const journal = await Bun.file(path.join(dir, "journal.json")).json()

// Bad
const journalPath = path.join(dir, "journal.json")
const journal = await Bun.file(journalPath).json()
```

### Destructuring

Avoid unnecessary destructuring. Use dot notation to preserve context.

```ts
// Good
obj.a
obj.b

// Bad
const { a, b } = obj
```

### Variables

Prefer `const` over `let`. Use ternaries or early returns instead of reassignment.

```ts
// Good
const foo = condition ? 1 : 2

// Bad
let foo
if (condition) foo = 1
else foo = 2
```

### Control Flow

Avoid `else` statements. Prefer early returns.

```ts
// Good
function foo() {
  if (condition) return 1
  return 2
}

// Bad
function foo() {
  if (condition) return 1
  else return 2
}
```

### Schema Definitions (Drizzle)

Use snake_case for field names so column names don't need to be redefined as strings.

```ts
// Good
const table = sqliteTable("session", {
  id: text().primaryKey(),
  project_id: text().notNull(),
  created_at: integer().notNull(),
})

// Bad
const table = sqliteTable("session", {
  id: text("id").primaryKey(),
  projectID: text("project_id").notNull(),
  createdAt: integer("created_at").notNull(),
})
```

## Testing

- Avoid mocks as much as possible
- Test actual implementation, do not duplicate logic into tests
- Tests cannot run from repo root (guard: `do-not-run-tests-from-root`); run from package dirs like `packages/opencode`.

## Type Checking

- Always run `bun typecheck` from package directories (e.g., `packages/opencode`), never `tsc` directly.

<!-- GSD:project-start source:PROJECT.md -->
## Project

**OpenCode IDE Plugin**

基于开源 opencode 项目的 IDE 插件，提供 WebGUI 前端界面 + VSCode/JetBrains 插件包装，让开发者在 IDE 内直接使用 opencode 的 AI 编码能力，与上游原有的 TUI 终端界面并存。

**Core Value:** 上游合并后构建通过且功能不退化——在持续跟进 opencode 上游更新的同时，保证 webgui 和 IDE 插件始终可用。

### Constraints

- **上游兼容**: 合并时尽量同时保留上游和 webgui 的逻辑，需要二选一时提出方案让用户选择
- **技术栈**: 前端 React 19 + Vite + Tailwind，VSCode 用 TypeScript，JetBrains 用 Kotlin
- **包管理**: 根目录用 Bun，VSCode 插件用 pnpm，JetBrains 用 Gradle
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.8.2 (catalog) — Core backend (`packages/opencode/`), WebGUI frontend (`packages/opencode/webgui/`), VSCode extension (`hosts/vscode-plugin/`)
- Kotlin 1.9.23 — JetBrains IDE plugin (`hosts/jetbrains-plugin/`)
- Bash — Build and CI scripts (`hosts/scripts/`, `script/`)
- Nix — Reproducible builds and development environments (`flake.nix`, `nix/`)
## Runtime
- Bun 1.3.11 — Primary runtime and package manager for the core `packages/opencode/` server
- Node.js 22 — Used as fallback/secondary target (`@tsconfig/node22`)
- Browser — React SPA served by the opencode backend at `/app`
- Node.js (VS Code host process) — Extension runtime under VSCode's extension API
- JVM 21 — IntelliJ Platform 2024.3+ (`hosts/jetbrains-plugin/build.gradle.kts`)
- Bun 1.3.11 — Primary (root `packageManager` field)
- pnpm 9.0.0 — Used by the VSCode extension (`hosts/vscode-plugin/package.json`)
- Gradle (Gradle Wrapper) — JetBrains plugin build (`hosts/jetbrains-plugin/gradlew`)
- Lockfile: `bun.lock` present at root
## Frameworks
- Hono 4.10.7 — HTTP server framework for the opencode API (`packages/opencode/src/server/server.ts`)
- Effect 4.0.0-beta.42 — Functional effect system for service composition and typed errors across the core
- Drizzle ORM 1.0.0-beta.19 — Database access layer with schema in `src/**/*.sql.ts`
- React 19.1 — UI framework
- Vite 7.1.4 — Build tool and dev server (`vite.config.ts`)
- Tailwind CSS 4.1.16 — Utility CSS framework with PostCSS integration
- Lexical 0.37.0 — Rich text editor for the message input (`@lexical/react`)
- VSCode Extension API ^1.74.0 — Extension framework (`@types/vscode`)
- TypeScript — Compiled with `tsc` to `out/extension.js`
- IntelliJ Platform SDK 2024.3 — Plugin framework via `org.jetbrains.intellij.platform` Gradle plugin 2.2.1
- Jackson 2.17.1 — JSON serialization (`jackson-module-kotlin`)
- Vitest 4.0.13 — WebGUI unit tests (`packages/opencode/webgui/vitest.config.ts`)
- Testing Library (React) 16.3.0 — Component tests for WebGUI
- Bun test — Core opencode package tests (`packages/opencode/`)
- Mocha 10.2.0 — VSCode extension tests
- JUnit 5.10.0 + Mockito 5.5.0 — JetBrains plugin tests
- Turborepo 2.8.13 — Monorepo task orchestration (`turbo.json`)
- `tsgo` (TypeScript native preview 7.0) — Fast type checking (`bun typecheck` via `tsgo --noEmit`)
- esbuild — Minification via Vite build
- Prettier 3.6.2 — Code formatting (semi: false, printWidth: 120)
- ESLint — Linting for WebGUI and VSCode extension
- Husky 9.1.7 — Git hooks
## Key Dependencies
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
- `@modelcontextprotocol/sdk` 1.27.1 — MCP (Model Context Protocol) client
- `@agentclientprotocol/sdk` 0.14.1 — Agent Client Protocol
- `@octokit/rest` 22.0.1 — GitHub API client
- `hono-openapi` 1.1.2 — OpenAPI spec generation from Hono routes
- `@opencode-ai/sdk` workspace — Generated TypeScript SDK for the opencode HTTP API
- `react-syntax-highlighter` 15.6.1 — Code syntax highlighting
- `react-markdown` 10.1.0 + `remark-gfm` 4.0.1 — Markdown rendering
- `diff` ^7.0.0 — Text diffing for file change display
- `fuzzysort` 3.1.0 — Fuzzy search for command palette and session search
- `happy-dom` 20.0.10 / `jsdom` 27.2.0 — Test DOM environments
- `zod` 4.1.8 — Schema validation
- `solid-js` 1.9.10 — Used in the TUI (terminal UI, not WebGUI)
- `web-tree-sitter` 0.25.10 + `tree-sitter-bash` — Syntax parsing
- `chokidar` 4.0.3 — File watching
- `@parcel/watcher` 2.5.1 — Native file system watcher (with platform-specific binaries)
- `bun-pty` 0.4.8 — Pseudo-terminal for tool execution
- `turndown` 7.2.0 — HTML to Markdown conversion
## Configuration
- `.env` files present — Contains API keys and server configuration (existence noted only)
- `opencode.json` — Project-level tool/permission configuration
- `bunfig.toml` — Bun configuration (exact installs, test root guard)
- `tsconfig.json` (root) — Extends `@tsconfig/bun`
- `packages/opencode/webgui/tsconfig.json` — Project references for app and node configs
- `packages/opencode/webgui/vite.config.ts` — Vite config: base `/app`, builds to `../webgui-dist`
- `packages/opencode/webgui/vitest.config.ts` — Vitest: jsdom environment, `@` path alias to `./src`
- `packages/opencode/webgui/postcss.config.js` — PostCSS with `@tailwindcss/postcss` + autoprefixer
- `packages/opencode/webgui/tailwind.config.js` — Tailwind: darkMode `"class"`, scans `./src/**/*.{js,ts,jsx,tsx}`
- `turbo.json` — Turborepo pipeline config for typecheck, build, test tasks
- `hosts/jetbrains-plugin/build.gradle.kts` — Gradle build for JetBrains plugin
- `hosts/jetbrains-plugin/gradle.properties` — JVM args, Gradle caching/parallel, min opencode version
- `packages/*`
- `packages/console/*`
- `packages/sdk/js`
- `packages/slack`
- `packages/opencode/webgui`
## Platform Requirements
- Bun 1.3.11+ for core development
- Node.js 18+ for VSCode extension development
- JDK 21 for JetBrains plugin development
- pnpm 9+ for VSCode extension (`hosts/vscode-plugin/`)
- opencode backend: Compiled Bun binary (platform-specific: linux/mac/windows × x64/arm64)
- WebGUI: Static build served by the opencode HTTP server at `/app` path
- VSCode extension: `.vsix` package published via `@vscode/vsce`
- JetBrains plugin: `.zip` package built via IntelliJ Platform Gradle plugin
- `@opencode-ai/sdk` — TypeScript SDK generated with `@hey-api/openapi-ts` 0.90.10 from the Hono OpenAPI spec
- Regenerate via `./packages/sdk/js/script/build.ts`
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Style Guide
### Authoritative Source
### General Principles
- Keep things in one function unless composable or reusable
- Avoid `try`/`catch` where possible
- Avoid using the `any` type
- Prefer single word variable names where possible
- Use Bun APIs when possible (e.g., `Bun.file()`)
- Rely on type inference; avoid explicit type annotations or interfaces unless necessary for exports or clarity
- Prefer functional array methods (`flatMap`, `filter`, `map`) over `for` loops; use type guards on `filter` to maintain type inference downstream
### Formatting
- **Prettier** (configured in root `package.json`):
- **EditorConfig** (`.editorconfig`):
- **Husky** (`.husky/`) is configured for git hooks (via `prepare` script)
### Module System
- All packages use `"type": "module"` (ES modules)
- Use `import`/`export` syntax exclusively, never `require()`
### TypeScript Strictness
- WebGUI (`packages/opencode/webgui/tsconfig.app.json`): `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, `noFallthroughCasesInSwitch: true`
- VSCode plugin (`hosts/vscode-plugin/tsconfig.json`): standard TypeScript compilation
- Root extends `@tsconfig/bun/tsconfig.json`
- Type checking: always run `bun typecheck` from package directories, never `tsc` directly
## Naming Conventions
### MANDATORY Naming Enforcement (Agent-Written Code)
### Files
- **WebGUI components:** PascalCase for React components (`MessageInput.tsx`, `CompactHeader/`, `SubtaskDrawer/`)
- **WebGUI hooks:** camelCase prefixed with `use` (`useDebounce.ts`, `useClickOutside.ts`)
- **WebGUI state:** PascalCase for Context files (`SessionContext.tsx`, `ThemeContext.tsx`), camelCase for stores (`tabStore.ts`, `scopedStorage.ts`)
- **WebGUI lib/utils:** camelCase (`ideBridge.ts`, `classNames.ts`, `formatting.ts`)
- **WebGUI repos (state/repo/):** camelCase suffixed with `Repo` (`draftRepo.ts`, `tabsRepo.ts`, `themeRepo.ts`)
- **VSCode plugin:** PascalCase for classes (`BackendLauncher.ts`, `WebviewManager.ts`, `ErrorHandler.ts`)
- **VSCode plugin commands:** PascalCase (`AddToContextCommand.ts`, `PastePathCommand.ts`)
- **Test files:** co-located, same name with `.test.ts` or `.test.tsx` suffix (`tabPolicy.test.ts`, `SessionContext.test.tsx`)
- **Test files (topic-scoped):** dot-separated topic suffix before `.test` (`MessagesContext.questions.test.tsx`, `MessagesContext.pagination.test.tsx`)
- **Upstream opencode schemas:** snake_case suffixed with `.sql.ts` (`session.sql.ts`, `project.sql.ts`)
### Variables and Functions
- Prefer single word names: `gate`, `draft`, `proc`, `conn`
- camelCase when multi-word is necessary: `handleNewSession`, `loadSessionMessages`
- React callback handlers: prefix with `handle` (`handleRetrySessionLoad`, `handleOpenPanel`)
- Boolean variables: use `is`/`has` prefix when needed (`isCreating`, `isRunning`, `disposed`)
### Types and Interfaces
- PascalCase for types and interfaces: `Message`, `StorageScope`, `ClassNameValue`
- Type-only imports: use `import type` when importing types only
- Branded schemas use `Schema.brand` for single-value types (upstream Effect code)
### Drizzle Schema (Database)
## Destructuring
## Variables
## Control Flow
## File Organization Patterns
### WebGUI (`packages/opencode/webgui/src/`)
### VSCode Plugin (`hosts/vscode-plugin/src/`)
### Upstream opencode (`packages/opencode/src/`)
- Feature modules organized by domain: `session/`, `project/`, `account/`, `share/`, etc.
- Each domain has schema in `*.sql.ts` files
- Effect-based architecture with services
## Common Patterns
### React Context Provider Pattern (WebGUI)
### Testable Pure Functions Extracted from Components (WebGUI)
### Scoped Storage / Repo Pattern (WebGUI)
### VSCode Extension Class Pattern
### IDE Bridge Communication
- Uses EventSource for server-sent events
- Request/response via POST with correlation IDs
- Reconnection with exponential backoff
- Scoped storage (global/workspace/mem) for state persistence
### Typing Indicator Pattern
## Error Handling
### WebGUI
- Errors from SDK calls return `{ data, error }` tuples — check `error` field rather than using try/catch
- Toast notifications for user-facing errors via `useToast()` context
- `ErrorBoundary` component wraps the entire app for React rendering errors
- Console logging with `[Component]` prefixes for debug: `console.log("[App] Session created:", id)`
### VSCode Plugin
- Centralized `ErrorHandler` utility with categorized errors (`ErrorCategory`, `ErrorSeverity`)
- `errorHandler.handleError()` with structured error contexts
- Specialized handlers: `handleBackendLaunchError()`, `handleWebviewLoadError()`, `handleFileOperationError()`
- Safe disposal pattern: errors during dispose are caught and logged, cleanup continues:
### Upstream opencode
- Effect-based error handling with `Schema.TaggedErrorClass` for typed errors
- `yield* new MyError(...)` for early failure in `Effect.gen` / `Effect.fn`
- Avoid `try`/`catch` as stated in AGENTS.md
## Import/Export Patterns
### WebGUI Import Order (Observed)
### WebGUI Re-exports
### VSCode Plugin Import Order
### Path Aliases
- WebGUI uses `@/` alias mapped to `./src/` (configured in `vitest.config.ts`, but not consistently used — most imports use relative paths)
### Module Exports
- WebGUI: named exports preferred over default exports (exception: `App.tsx` default export)
- Upstream: barrel exports from `exports` field in `package.json`: `"./*": "./src/*.ts"`
- VSCode plugin: named class exports
## Language Notes
- Some test descriptions and UI strings are in Chinese (e.g., `"replyQuestion 遇到结构化 error 时不应移除本地问题"`, `"创建会话失败"`)
- This is intentional and part of the codebase conventions for this fork
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## System Overview
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
## Component Map
### 1. Opencode Core (`packages/opencode/`)
- **Purpose:** AI agent orchestration, session management, code editing, tool execution
- **Entry Point:** `packages/opencode/src/index.ts` (CLI via yargs)
- **Server:** `packages/opencode/src/server/server.ts` (Hono HTTP server with SSE)
- **Key Subsystems:**
### 2. WebGUI (`packages/opencode/webgui/`)
- **Embedded:** Pre-built and base64-encoded into `packages/opencode/src/webgui/embed.generated.ts`, served at `/app` by the opencode server
- **Development:** Vite dev server with proxy to opencode backend
- **Purpose:** Chat interface, session management, settings, file browsing
- **Entry Point:** `packages/opencode/webgui/src/main.tsx`
- **Key Areas:**
### 3. VSCode Plugin (`hosts/vscode-plugin/`)
- **Purpose:** Integrate opencode into VSCode as an activity bar panel
- **Entry Point:** `hosts/vscode-plugin/src/extension.ts`
- **Key Components:**
### 4. JetBrains Plugin (`hosts/jetbrains-plugin/`)
- **Purpose:** Integrate opencode into JetBrains IDEs as a tool window
- **Entry Point:** `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`
- **Key Components:**
### 5. SDK (`packages/sdk/js/`)
- **Purpose:** Type-safe client for the opencode HTTP API
- **Source:** `packages/sdk/openapi.json` (generated from Hono route metadata)
- **Used by:** WebGUI (`packages/opencode/webgui/src/lib/api/sdkClient.ts`)
## Data Flow
### Chat Message Flow
### IDE Plugin Lifecycle (VSCode)
### IDE Plugin Lifecycle (JetBrains)
### IDE Bridge Communication
### State Management (WebGUI)
- **SessionContext:** Current session selection, session CRUD, session list management
- **MessagesContext:** Per-session message store, handles SSE events for live updates
- **ThemeContext:** Light/dark mode detection and synchronization
- **ProjectContext:** Current project directory info
- **ProvidersContext:** AI provider configuration
- **UISettingsContext:** User preferences (persisted via IDE bridge storage)
- **TabStore:** Multi-tab session management
- **SubtaskDrawerContext:** Agent subtask visualization
## Key Patterns
### Event-Driven Architecture
- All domain events are defined as `BusEvent.define()` with Zod schemas
- Components publish events; the SSE `/event` route subscribes to all events and streams them
- `Bus.subscribeAll()` is the primary pattern for SSE consumers
- Heartbeats every 10s prevent stale connections
### Instance/Workspace Isolation
- Each request carries a `directory` query param or `x-opencode-directory` header
- `Instance.provide()` sets up AsyncLocalStorage context per request
- `InstanceState` (Effect `ScopedCache`) manages per-directory state with automatic cleanup
### Embedded Web UI Pattern
- Build: `packages/opencode/webgui/` -> Vite build -> `packages/opencode/webgui-dist/`
- Embed: Generated into `packages/opencode/src/webgui/embed.generated.ts`
- Serve: `packages/opencode/src/webgui/server/app.ts` resolves paths, serves from memory
- Routes: `/app` and `/app/*` on the Hono server
### Unified IDE Bridge Protocol
- Local HTTP server on `127.0.0.1:0` (ephemeral port)
- Session-based with UUID tokens
- SSE for server-push, HTTP POST for client-send
- Keepalive pings every 15s
- Supports VSCode Remote-SSH via `vscode.env.asExternalUri()`
## Entry Points
### CLI
- **Location:** `packages/opencode/src/index.ts`
- **Triggers:** `opencode` binary via yargs CLI
- **Key Commands:** `serve` (headless server), `run` (TUI), `web` (browser UI)
### HTTP Server
- **Location:** `packages/opencode/src/server/server.ts`
- **Triggers:** `opencode serve` command
- **Listens:** Configurable hostname/port (default `0.0.0.0:4096`)
- **Routes:** Global routes at `/global/*`, instance routes via workspace middleware, WebGUI at `/app/*`
### WebGUI
- **Location:** `packages/opencode/webgui/src/main.tsx`
- **Triggers:** Browser/webview loads `/app` URL
- **Connects to:** Same-origin opencode server (REST + SSE)
### VSCode Extension
- **Location:** `hosts/vscode-plugin/src/extension.ts`
- **Triggers:** `onView:opencode.main`, `onCommand:opencode.openPanel`
- **Exports:** `activate()`, `deactivate()`
### JetBrains Plugin
- **Location:** `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`
- **Triggers:** Tool window factory registration in `plugin.xml`
## Error Handling
### Server-Side
- **Strategy:** Hono `onError` middleware catches and formats errors
- **Typed Errors:** `NamedError` base class with structured `toObject()` serialization
- **Logging:** `Log` utility writes to file-based logs
### WebGUI
- **Strategy:** `ErrorBoundary` component at top level catches React render errors
- **API Errors:** SDK client returns `{ data, error }` tuples (never throws)
- **Connection Errors:** `OfflineBanner` shows when SSE connection drops
- **Reconnection:** Exponential backoff in `useEventStream` (1s initial, 30s max)
### IDE Plugins
- **VSCode:** `ErrorHandler` utility with categorized errors (`BACKEND_LAUNCH`, `NETWORK`, `PERMISSION`, etc.)
- **JetBrains:** Standard IntelliJ `Logger` with error panels in tool window
## Cross-Cutting Concerns
### Logging
- **Backend:** `Log` utility from `packages/opencode/src/util/log.ts` - file-based, with service tags
- **WebGUI:** `console.log` with `[App]`, `[SSE Event]` prefixes; `sdk` also logs remotely via `POST /log`
- **IDE Plugins:** VSCode `OutputChannel` (`logger` in `globals.ts`); JetBrains IntelliJ `Logger`
### Configuration
- **Backend:** `opencode.json` in project root + global config in XDG data dir
- **WebGUI:** Reads config via `sdk.config.get()` HTTP API
- **VSCode:** `vscode.workspace.getConfiguration("opencode")` for `customCommand`, `minVersion`
- **JetBrains:** `OpenCodeSettings` persistent state component
### Authentication
- **AI Providers:** OAuth flow and API key management via `/auth` and `/provider` routes
- **Server Auth:** Optional basic auth via `OPENCODE_SERVER_PASSWORD` env var
- **IDE Bridge:** Per-session random UUID tokens (not persistent)
### Build Pipeline
- **Monorepo:** Bun workspaces + Turborepo for task orchestration
- **WebGUI Build:** Vite -> `webgui-dist/` -> embed script -> `embed.generated.ts`
- **VSCode Plugin:** `hosts/scripts/build_vscode.sh` - compiles TS, optionally bundles opencode binary, packages `.vsix`
- **JetBrains Plugin:** Gradle with `org.jetbrains.intellij.platform` plugin -> `.zip`
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
