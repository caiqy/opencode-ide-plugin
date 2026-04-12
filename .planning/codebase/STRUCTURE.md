# Code Structure

**Analysis Date:** 2026-04-12

## Directory Layout

```
opencode-ide-plugin/
├── packages/                    # Monorepo packages (Bun workspaces)
│   ├── opencode/                # Core opencode CLI + server (main package)
│   │   ├── src/                 # Backend source code
│   │   ├── webgui/              # React WebGUI frontend (separate workspace)
│   │   ├── webgui-dist/         # WebGUI build output (generated)
│   │   ├── test/                # Backend tests
│   │   ├── bin/                 # CLI binary entry
│   │   ├── migration/           # Drizzle DB migrations
│   │   ├── script/              # Build scripts
│   │   └── types/               # Type declarations
│   ├── sdk/                     # SDK packages
│   │   ├── js/                  # JavaScript/TypeScript SDK (auto-generated)
│   │   └── openapi.json         # OpenAPI spec (generated from server routes)
│   ├── app/                     # Web app (upstream SolidJS TUI)
│   ├── plugin/                  # Plugin system types
│   ├── ui/                      # Shared UI components (upstream SolidJS)
│   ├── util/                    # Shared utilities
│   ├── script/                  # Build/release scripts
│   ├── console/                 # Console dashboard
│   ├── desktop/                 # Desktop app (Tauri)
│   ├── desktop-electron/        # Desktop app (Electron)
│   ├── web/                     # Web deployment
│   ├── storybook/               # Component storybook
│   ├── enterprise/              # Enterprise features
│   ├── extensions/              # Extension system
│   ├── function/                # Serverless functions
│   ├── identity/                # Auth/identity
│   ├── containers/              # Container configs
│   ├── docs/                    # Documentation site
│   └── slack/                   # Slack integration
├── hosts/                       # IDE plugin hosts
│   ├── vscode-plugin/           # VSCode extension
│   ├── jetbrains-plugin/        # JetBrains extension
│   ├── scripts/                 # Build scripts for both plugins
│   └── IDE_BRIDGE_HTTP_SSE.md   # Bridge protocol documentation
├── sdks/                        # External SDK outputs
│   └── vscode/                  # VSCode-specific SDK
├── infra/                       # Infrastructure configuration
├── script/                      # Root-level scripts
├── specs/                       # Specifications and design docs
├── tasks/                       # Task definitions
├── docs/                        # Documentation
├── patches/                     # Dependency patches
├── nix/                         # Nix build configuration
├── github/                      # GitHub-specific configs
├── .planning/                   # Planning documents
│   └── codebase/                # Codebase analysis docs
├── turbo.json                   # Turborepo configuration
├── package.json                 # Root workspace config
├── bunfig.toml                  # Bun configuration
├── tsconfig.json                # Root TypeScript config
├── sst.config.ts                # SST (serverless) config
├── opencode.json                # Opencode project config
└── flake.nix                    # Nix flake for dev environment
```

## Directory Purposes

### `packages/opencode/src/` (Backend Core)

The heart of the system. Contains all backend logic organized by domain.

```
src/
├── index.ts              # CLI entry point (yargs)
├── node.ts               # Node.js compatibility entry
├── agent/                # AI agent definitions and orchestration
├── session/              # Chat session lifecycle
├── provider/             # AI model providers (Anthropic, OpenAI, etc.)
├── tool/                 # Agent tools (file edit, shell, etc.)
├── server/               # HTTP API server (Hono)
│   ├── server.ts         # Server setup, CORS, middleware
│   ├── router.ts         # Workspace routing middleware
│   ├── instance.ts       # Instance-scoped route registration
│   ├── routes/           # Route handlers by domain
│   │   ├── session.ts    # Session CRUD + messaging
│   │   ├── event.ts      # SSE event stream
│   │   ├── config.ts     # Configuration API
│   │   ├── provider.ts   # Provider management
│   │   ├── mcp.ts        # MCP server management
│   │   ├── file.ts       # File operations
│   │   ├── permission.ts # Permission requests
│   │   ├── question.ts   # Interactive questions
│   │   ├── project.ts    # Project info
│   │   ├── pty.ts        # PTY/terminal
│   │   ├── global.ts     # Global (non-instance) routes
│   │   └── workspace.ts  # Workspace management
│   ├── event.ts          # Server event definitions
│   ├── middleware.ts      # Error handler middleware
│   ├── projectors.ts     # Event projectors
│   └── error.ts          # Error response helpers
├── bus/                  # Event bus (Effect PubSub)
│   ├── index.ts          # Bus service and layer
│   ├── bus-event.ts      # Event definition helpers
│   └── global.ts         # Global bus (cross-instance)
├── config/               # Configuration system
├── storage/              # Database (SQLite via Drizzle)
├── project/              # Project/workspace management
│   └── instance.ts       # Instance context (AsyncLocalStorage)
├── cli/                  # CLI commands and UI
│   ├── cmd/              # Command implementations
│   │   ├── serve.ts      # `opencode serve`
│   │   ├── run.ts        # `opencode` (default TUI)
│   │   ├── web.ts        # `opencode web`
│   │   └── ...           # Other commands
│   └── ui.ts             # CLI UI helpers
├── webgui/               # WebGUI serving
│   ├── embed.generated.ts  # Embedded WebGUI assets (generated)
│   └── server/
│       └── app.ts        # Static file serving from embedded data
├── effect/               # Effect framework utilities
├── auth/                 # Authentication
├── mcp/                  # Model Context Protocol
├── plugin/               # Plugin system
├── skill/                # Skill system
├── lsp/                  # Language Server Protocol
├── file/                 # File operations
├── filesystem/           # Filesystem utilities
├── shell/                # Shell command execution
├── pty/                  # PTY management
├── permission/           # Permission system
├── question/             # Interactive question system
├── snapshot/             # File snapshot/diff
├── command/              # Command execution
├── format/               # Output formatting
├── global/               # Global state/paths
├── env/                  # Environment detection
├── flag/                 # Feature flags
├── id/                   # ID generation
├── installation/         # Installation management
├── worktree/             # Git worktree management
├── sync/                 # State synchronization
├── share/                # Session sharing
├── patch/                # Patch application
├── control-plane/        # Workspace/adaptor orchestration
├── acp/                  # Agent Control Protocol
├── ide/                  # IDE integration hooks
└── util/                 # Shared utilities
    ├── log.ts            # Logging utility
    ├── filesystem.ts     # Filesystem helpers
    ├── context.ts        # AsyncLocalStorage context
    ├── lazy.ts           # Lazy initialization
    ├── queue.ts          # Async queue
    └── error.ts          # Error utilities
```

### `packages/opencode/webgui/src/` (WebGUI Frontend)

React 19 SPA with Tailwind CSS.

```
webgui/src/
├── main.tsx              # React entry point, provider tree
├── App.tsx               # Root component (event stream, session management)
├── index.css             # Global styles
├── vite-env.d.ts         # Vite type declarations
├── components/           # React components
│   ├── MessageList/      # Message display with virtualization
│   ├── MessageInput/     # Rich text input with mentions
│   ├── CompactHeader/    # Session header bar
│   ├── CommandPalette.tsx  # Cmd+K command palette
│   ├── KeyboardShortcutsHelp.tsx  # Shortcut reference
│   ├── OfflineBanner.tsx # Connection status banner
│   ├── ChatLoadGuard.tsx # Loading/error states
│   ├── VersionGate.tsx   # Server version check
│   ├── ErrorBoundary.tsx # React error boundary
│   ├── ModelSelector.tsx # AI model picker
│   ├── AgentSelector.tsx # Agent picker
│   ├── MarkdownRenderer.tsx  # Markdown display
│   ├── CodeBlock.tsx     # Syntax-highlighted code
│   ├── Toast.tsx         # Toast notifications
│   ├── DiffModal/        # File diff viewer
│   ├── SubtaskDrawer/    # Agent subtask panel
│   ├── SettingsPanel/    # Settings UI
│   ├── parts/            # Message part renderers
│   ├── mention/          # @-mention system
│   ├── attachment/       # File attachment handling
│   ├── command/          # Command palette commands
│   ├── common/           # Shared UI components
│   └── settings/         # Settings components
├── state/                # React context providers
│   ├── SessionContext.tsx # Session management
│   ├── MessagesContext.tsx  # Message store (largest state logic)
│   ├── ThemeContext.tsx   # Dark/light theme
│   ├── ProjectContext.tsx # Project metadata
│   ├── ProvidersContext.tsx  # AI provider config
│   ├── UISettingsContext.tsx  # User UI preferences
│   ├── ToastContext.tsx   # Toast notification system
│   ├── IdeBridgeContext.tsx  # IDE bridge state
│   ├── SubtaskDrawerContext.tsx  # Subtask drawer state
│   ├── tabStore.ts       # Multi-tab state management
│   ├── tabPolicy.ts      # Tab behavior rules
│   ├── scopedStorage.ts  # Scoped storage with IDE bridge fallback
│   ├── switchSession.ts  # Session switch logic with tab rollback
│   ├── useSessionActivation.ts  # Session activation hook
│   ├── sessionPaging.ts  # Session list pagination
│   └── repo/             # Data repositories
├── lib/                  # Core libraries
│   ├── api/              # API communication layer
│   │   ├── sdkClient.ts  # Extended SDK client with extra methods
│   │   ├── events.ts     # SSE event stream hook and EventEmitter
│   │   └── useSessionEvents.ts  # Session-specific event handlers
│   ├── ideBridge.ts      # IDE bridge client (HTTP+SSE)
│   ├── keyboardHandler.ts  # Keyboard shortcut fixes for webview
│   ├── messagesStore.ts  # Message data structure helpers
│   ├── messageFormatting.ts  # Message display formatting
│   ├── dnd.ts            # Drag-and-drop handling
│   ├── fileUtils.ts      # File path utilities
│   ├── tooltipPolyfill.ts  # Tooltip CSS polyfill
│   ├── selection/        # Text selection utilities
│   ├── task-part.ts      # Task part parsing
│   └── task-result.ts    # Task result parsing
├── hooks/                # Custom React hooks
│   ├── useKeyboardShortcuts.ts  # Global keyboard shortcuts
│   ├── useClickOutside.ts  # Click outside detection
│   ├── useDebounce.ts    # Debounced values
│   ├── useDropdown.ts    # Dropdown state
│   ├── useKeyboard.ts    # Keyboard event helpers
│   ├── useMentionNavigation.ts  # Mention navigation
│   ├── useMentionSearch.ts  # Mention search
│   ├── useCommandSearch.ts  # Command search
│   ├── useOpenFile.ts    # File opening via IDE bridge
│   ├── useMergedFileDiffs.ts  # Diff merging
│   └── useSessionUsage.ts  # Token usage tracking
├── utils/                # Utility functions
├── types/                # TypeScript type definitions
├── config/               # WebGUI configuration
├── assets/               # Static assets
└── test/                 # Test utilities and setup
```

### `hosts/vscode-plugin/src/` (VSCode Extension)

```
vscode-plugin/src/
├── extension.ts          # Extension entry (activate/deactivate)
├── globals.ts            # Logger and shared globals
├── backend/              # Backend process management
│   ├── BackendLauncher.ts  # Spawn/manage opencode process
│   ├── ResourceExtractor.ts  # Extract bundled binary
│   └── kill.ts           # Process tree kill utility
├── ui/                   # UI components
│   ├── ActivityBarProvider.ts  # Sidebar webview provider
│   ├── WebviewManager.ts  # Editor panel webview
│   ├── WebviewController.ts  # Shared webview lifecycle
│   ├── CommunicationBridge.ts  # IDE<->WebGUI bridge
│   ├── IdeBridgeServer.ts  # HTTP+SSE bridge server
│   └── loading.ts        # Loading HTML generator
├── commands/             # VSCode command handlers
│   ├── AddToContextCommand.ts  # Add file to context
│   ├── AddLinesToContextCommand.ts  # Add selected lines
│   └── PastePathCommand.ts  # Paste directory path
├── settings/             # Settings management
│   └── SettingsManager.ts  # VSCode configuration bridge
├── utils/                # Utility classes
│   ├── ErrorHandler.ts   # Categorized error handling
│   ├── FileMonitor.ts    # Open file tracking
│   ├── PathInserter.ts   # File path insertion routing
│   └── RecoveryUtils.ts  # Recovery utilities
├── types/                # TypeScript type definitions
└── test/                 # Test files
```

### `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/` (JetBrains Plugin)

```
paviko/opencode/
├── ui/                   # UI layer
│   ├── ChatToolWindowFactory.kt  # Tool window factory (main entry)
│   ├── IdeBridge.kt      # HTTP+SSE bridge server
│   ├── IdeBridgeStorageBackend.kt  # Storage implementation for bridge
│   ├── DragAndDropInstaller.kt  # File DnD support
│   ├── IdeOpenFilesUpdater.kt  # Open file tracking
│   ├── PathInserter.kt   # File path insertion
│   └── ConnInfo.kt       # Connection info data class
├── backendprocess/       # Backend process management
│   ├── BackendLauncher.kt  # Launch opencode in terminal
│   ├── BackendProcess.kt   # Process abstraction
│   ├── TerminalBackendProcess.kt  # Terminal-based process
│   ├── RunningTerminalBackendProcess.kt  # Running process wrapper
│   └── TerminalOutputCapture.kt  # Terminal output capture
├── actions/              # IDE actions
│   ├── EditorAddToContextAction.kt  # Add file from editor
│   ├── EditorAddLinesToContextAction.kt  # Add lines from editor
│   ├── ProjectAddToContextAction.kt  # Add file from project tree
│   └── ProjectPastePathAction.kt  # Paste path from project tree
├── settings/             # Plugin settings
│   ├── OpenCodeSettings.kt  # Persistent state
│   └── OpenCodeConfigurable.kt  # Settings UI
└── util/
    └── ResourceExtractor.kt  # Binary resource extraction
```

## Key Entry Points

| Component        | Entry File                                                                           | Purpose                                         |
| ---------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------- |
| CLI              | `packages/opencode/src/index.ts`                                                     | Command-line interface via yargs                |
| HTTP Server      | `packages/opencode/src/server/server.ts`                                             | Hono HTTP server                                |
| Serve Command    | `packages/opencode/src/cli/cmd/serve.ts`                                             | `opencode serve` headless server                |
| WebGUI           | `packages/opencode/webgui/src/main.tsx`                                              | React app bootstrap                             |
| WebGUI Build     | `packages/opencode/webgui/vite.config.ts`                                            | Vite build config (output to `../webgui-dist/`) |
| Embedded WebGUI  | `packages/opencode/src/webgui/server/app.ts`                                         | Serve embedded assets at `/app`                 |
| VSCode Plugin    | `hosts/vscode-plugin/src/extension.ts`                                               | `activate()` / `deactivate()`                   |
| JetBrains Plugin | `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt` | Tool window factory                             |
| SDK Generator    | `packages/sdk/js/script/build.ts`                                                    | Regenerate JS SDK from OpenAPI                  |
| OpenAPI Spec     | `packages/sdk/openapi.json`                                                          | Generated API specification                     |

## Module Organization

### Backend Route Registration

Routes are registered in two layers:

1. **Global routes** (`src/server/server.ts`):
   - `/global/*` - Global config, events, sync
   - `/auth/*` - Authentication
   - `/log` - Remote logging
   - `/app/*` - Embedded WebGUI static files
   - `/doc` - OpenAPI spec

2. **Instance routes** (`src/server/instance.ts`, via `WorkspaceRouterMiddleware`):
   - `/session/*` - Session management
   - `/config/*` - Instance config
   - `/provider/*` - Provider management
   - `/mcp/*` - MCP server management
   - `/event` - SSE event stream
   - `/permission/*` - Permission system
   - `/question/*` - Question system
   - `/project/*` - Project info
   - `/file/*` - File operations
   - `/pty/*` - Terminal/PTY
   - `/path` - Directory paths
   - `/skill` - Skills
   - `/tui/*` - TUI-specific routes

### Database Schema

Schema files follow the pattern `src/**/*.sql.ts`:

- Tables use `snake_case` column names
- Drizzle ORM with `drizzle-kit` for migrations
- Migrations in `packages/opencode/migration/`
- SQLite database at `{dataDir}/opencode.db`

## Configuration Files

| File                                          | Purpose                                                     |
| --------------------------------------------- | ----------------------------------------------------------- |
| `package.json` (root)                         | Monorepo workspace config, catalog dependencies             |
| `turbo.json`                                  | Turborepo task configuration                                |
| `bunfig.toml`                                 | Bun package manager configuration                           |
| `tsconfig.json` (root)                        | Base TypeScript configuration                               |
| `packages/opencode/package.json`              | Core package config, dependencies, scripts                  |
| `packages/opencode/tsconfig.json`             | Backend TypeScript config                                   |
| `packages/opencode/drizzle.config.ts`         | Drizzle migration configuration                             |
| `packages/opencode/webgui/package.json`       | WebGUI package config                                       |
| `packages/opencode/webgui/vite.config.ts`     | Vite build config (base: `/app`, output: `../webgui-dist/`) |
| `packages/opencode/webgui/tailwind.config.js` | Tailwind CSS configuration                                  |
| `packages/opencode/webgui/tsconfig.json`      | WebGUI TypeScript config                                    |
| `packages/opencode/webgui/vitest.config.ts`   | Vitest test configuration                                   |
| `hosts/vscode-plugin/package.json`            | VSCode extension manifest (commands, views, menus)          |
| `hosts/vscode-plugin/tsconfig.json`           | VSCode extension TypeScript config                          |
| `hosts/jetbrains-plugin/build.gradle.kts`     | Gradle build for JetBrains plugin                           |
| `hosts/jetbrains-plugin/gradle.properties`    | Plugin version and metadata                                 |
| `opencode.json`                               | Project-level opencode configuration                        |
| `sst.config.ts`                               | SST serverless infrastructure config                        |

## Naming Conventions

### Files

- **Backend modules:** lowercase, kebab-case directories, single-word when possible: `src/agent/`, `src/bus/`, `src/tool/`
- **SQL schema files:** `*.sql.ts` pattern: `src/session/session.sql.ts`
- **React components:** PascalCase: `MessageList.tsx`, `CompactHeader.tsx`
- **React contexts:** PascalCase with `Context` suffix: `SessionContext.tsx`, `ThemeContext.tsx`
- **React hooks:** camelCase with `use` prefix: `useKeyboardShortcuts.ts`, `useDebounce.ts`
- **Test files:** Same name with `.test.ts` or `.test.tsx` suffix, co-located: `ideBridge.test.ts`
- **VSCode commands:** PascalCase with `Command` suffix: `AddToContextCommand.ts`
- **JetBrains actions:** PascalCase with `Action` suffix: `EditorAddToContextAction.kt`

### Directories

- Backend: lowercase, single-word: `agent/`, `bus/`, `server/`, `tool/`
- WebGUI: lowercase: `components/`, `state/`, `hooks/`, `lib/`
- VSCode: lowercase: `backend/`, `ui/`, `commands/`, `settings/`, `utils/`
- JetBrains: lowercase: `ui/`, `backendprocess/`, `actions/`, `settings/`

## Where to Add New Code

### New Backend API Route

1. Create route handler in `packages/opencode/src/server/routes/{domain}.ts`
2. Register in `packages/opencode/src/server/instance.ts` (instance-scoped) or `server.ts` (global)
3. Use `describeRoute()` + `validator()` from `hono-openapi` for OpenAPI spec generation

### New WebGUI Component

1. Create component in `packages/opencode/webgui/src/components/{ComponentName}.tsx`
2. For complex components, use a directory: `components/{ComponentName}/`
3. Co-locate tests: `components/{ComponentName}.test.tsx`
4. If component needs shared state, add context in `packages/opencode/webgui/src/state/`
5. If component needs new API calls, extend `packages/opencode/webgui/src/lib/api/sdkClient.ts`

### New WebGUI Hook

1. Create in `packages/opencode/webgui/src/hooks/use{Name}.ts`
2. Co-locate test: `hooks/use{Name}.test.ts`

### New VSCode Command

1. Create command class in `hosts/vscode-plugin/src/commands/{Name}Command.ts`
2. Register in `hosts/vscode-plugin/src/extension.ts` -> `registerCommands()`
3. Add command metadata in `hosts/vscode-plugin/package.json` -> `contributes.commands`
4. Add keybinding in `hosts/vscode-plugin/package.json` -> `contributes.keybindings`

### New JetBrains Action

1. Create action class in `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/actions/{Name}Action.kt`
2. Register in `src/main/resources/META-INF/plugin.xml`

### New IDE Bridge Message Type

1. Add handler in both:
   - `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts` -> `handleSend()`
   - `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt` -> `handleInbound()`
2. Add client-side handling in `packages/opencode/webgui/src/lib/ideBridge.ts`
3. Update `hosts/IDE_BRIDGE_HTTP_SSE.md` documentation

### New Backend Domain Module

1. Create directory in `packages/opencode/src/{domain}/`
2. For SQL tables, create `{domain}.sql.ts` following Drizzle patterns
3. Generate migration: `bun run db generate --name {slug}` from `packages/opencode/`
4. For Effect services, use `InstanceState.make()` for per-workspace state
5. For bus events, define with `BusEvent.define()` in the module

## Special Directories

### `packages/opencode/webgui-dist/`

- **Purpose:** Vite build output for the WebGUI
- **Generated:** Yes, by `bun --cwd packages/opencode/webgui run build`
- **Committed:** Yes (used to generate embedded assets)
- **Consumed by:** Build script that creates `embed.generated.ts`

### `packages/opencode/src/webgui/embed.generated.ts`

- **Purpose:** Base64-encoded WebGUI static assets for embedded serving
- **Generated:** Yes, by opencode build script
- **Committed:** Yes
- **Contains:** All HTML/JS/CSS/images as base64 strings in a TypeScript array

### `packages/opencode/migration/`

- **Purpose:** Drizzle SQL migration files
- **Generated:** Yes, by `bun run db generate --name {slug}`
- **Committed:** Yes
- **Format:** `{timestamp}_{slug}/migration.sql` + `snapshot.json`

### `hosts/vscode-plugin/out/`

- **Purpose:** Compiled VSCode extension JavaScript
- **Generated:** Yes, by `tsc`
- **Committed:** No (in `.gitignore`)

### `hosts/jetbrains-plugin/build/`

- **Purpose:** Gradle build output
- **Generated:** Yes, by Gradle
- **Committed:** No (in `.gitignore`)

### `packages/sdk/js/`

- **Purpose:** Auto-generated TypeScript SDK from OpenAPI spec
- **Generated:** Yes, by `packages/sdk/js/script/build.ts`
- **Committed:** Yes
- **Used by:** WebGUI `sdkClient.ts` imports `@opencode-ai/sdk/client`

---

_Structure analysis: 2026-04-12_
