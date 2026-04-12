# Architecture

**Analysis Date:** 2026-04-12

## System Overview

The system is an AI-powered development tool built on the open-source **opencode** project, extended with IDE plugin support. It follows a **client-server architecture with embedded web UI**:

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

## Component Map

### 1. Opencode Core (`packages/opencode/`)

The main backend: a CLI tool and HTTP server built with Bun and Hono.

- **Purpose:** AI agent orchestration, session management, code editing, tool execution
- **Entry Point:** `packages/opencode/src/index.ts` (CLI via yargs)
- **Server:** `packages/opencode/src/server/server.ts` (Hono HTTP server with SSE)
- **Key Subsystems:**
  - `src/agent/` - AI agent definitions and orchestration
  - `src/session/` - Chat session lifecycle and message management
  - `src/provider/` - AI model provider integrations (Anthropic, OpenAI, Google, etc.)
  - `src/tool/` - Tool implementations for file editing, shell commands, etc.
  - `src/bus/` - Internal event bus (Effect PubSub-based)
  - `src/config/` - Configuration management (`opencode.json`)
  - `src/storage/` - SQLite database (Drizzle ORM)
  - `src/mcp/` - Model Context Protocol server/client
  - `src/project/` - Project/workspace detection and management
  - `src/server/` - HTTP API server with routes

### 2. WebGUI (`packages/opencode/webgui/`)

A React 19 SPA that provides the chat UI. Built with Vite, served either:

- **Embedded:** Pre-built and base64-encoded into `packages/opencode/src/webgui/embed.generated.ts`, served at `/app` by the opencode server
- **Development:** Vite dev server with proxy to opencode backend

- **Purpose:** Chat interface, session management, settings, file browsing
- **Entry Point:** `packages/opencode/webgui/src/main.tsx`
- **Key Areas:**
  - `src/components/` - React components (MessageList, MessageInput, CommandPalette, etc.)
  - `src/state/` - React Context providers (SessionContext, MessagesContext, ThemeContext, etc.)
  - `src/lib/api/` - SDK client and SSE event stream
  - `src/lib/ideBridge.ts` - IDE bridge client for host communication
  - `src/hooks/` - Custom React hooks

### 3. VSCode Plugin (`hosts/vscode-plugin/`)

TypeScript extension that hosts the WebGUI in a VSCode webview.

- **Purpose:** Integrate opencode into VSCode as an activity bar panel
- **Entry Point:** `hosts/vscode-plugin/src/extension.ts`
- **Key Components:**
  - `src/backend/BackendLauncher.ts` - Spawns `opencode serve` as a child process
  - `src/ui/ActivityBarProvider.ts` - VSCode `WebviewViewProvider` for sidebar
  - `src/ui/WebviewController.ts` - Manages webview lifecycle, iframe loading, bridge setup
  - `src/ui/IdeBridgeServer.ts` - Local HTTP+SSE server for IDE<->WebGUI communication
  - `src/ui/CommunicationBridge.ts` - Routes messages between IDE and webview
  - `src/commands/` - VSCode commands (add file to context, paste path, etc.)
  - `src/settings/SettingsManager.ts` - VSCode settings integration

### 4. JetBrains Plugin (`hosts/jetbrains-plugin/`)

Kotlin/JVM plugin that hosts the WebGUI in a JCEF browser panel.

- **Purpose:** Integrate opencode into JetBrains IDEs as a tool window
- **Entry Point:** `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`
- **Key Components:**
  - `backendprocess/BackendLauncher.kt` - Launches `opencode serve` in an IDE terminal
  - `ui/IdeBridge.kt` - Local HTTP+SSE server (same protocol as VSCode)
  - `ui/ChatToolWindowFactory.kt` - JCEF browser setup and backend coordination
  - `ui/DragAndDropInstaller.kt` - Drag-and-drop file support
  - `ui/IdeOpenFilesUpdater.kt` - Tracks open files and sends updates to WebGUI
  - `actions/` - IDE actions (add to context, paste path, etc.)
  - `settings/OpenCodeSettings.kt` - Plugin settings

### 5. SDK (`packages/sdk/js/`)

Auto-generated TypeScript SDK from the OpenAPI spec.

- **Purpose:** Type-safe client for the opencode HTTP API
- **Source:** `packages/sdk/openapi.json` (generated from Hono route metadata)
- **Used by:** WebGUI (`packages/opencode/webgui/src/lib/api/sdkClient.ts`)

## Data Flow

### Chat Message Flow

1. User types in WebGUI `MessageInput` component
2. WebGUI calls `sdk.session.prompt()` via HTTP POST to `/session/{id}/message`
3. Opencode server routes request through `WorkspaceRouterMiddleware` to `SessionRoutes`
4. Backend creates agent task, streams responses via the event bus
5. Bus publishes `message.part.updated`, `message.part.delta` events
6. Events flow to WebGUI via SSE at `/event` endpoint
7. `useEventStream` hook in `events.ts` receives events via `EventSource`
8. `EventEmitter` dispatches to `MessagesContext` which updates React state
9. `MessageList` component re-renders with new/updated message parts

### IDE Plugin Lifecycle (VSCode)

1. Extension activates, `OpenCodeExtension.initialize()` called
2. `ActivityBarProvider` registered as `WebviewViewProvider` for `opencode.main`
3. On first webview resolve:
   a. `BackendLauncher.launchBackend()` spawns `opencode serve` process
   b. Parses stdout for `opencode server listening on http://...` to get port
   c. `IdeBridgeServer` starts on ephemeral port, creates session with handlers
   d. `WebviewController.load()` builds iframe URL with bridge params
   e. WebGUI loads in iframe, connects to opencode server and IDE bridge

### IDE Plugin Lifecycle (JetBrains)

1. `ChatToolWindowFactory.createToolWindowContent()` called
2. `BackendLauncher.launchBackend()` launches `opencode serve` in IDE terminal
3. Terminal output parsed for server URL
4. JCEF browser created, `IdeBridge.createSession()` provides bridge params
5. Browser loads WebGUI URL with `ideBridge` and `ideBridgeToken` query params

### IDE Bridge Communication

Both IDE plugins use identical HTTP+SSE transport (documented in `hosts/IDE_BRIDGE_HTTP_SSE.md`):

1. **WebGUI -> IDE:** HTTP POST to `{bridgeBase}/send?token=...`
   - Message types: `openFile`, `openUrl`, `reloadPath`, `clipboardWrite`, `storageGet`, `storageSet`, `restartHost`, `ensureAndOpenFile`
2. **IDE -> WebGUI:** SSE stream at `{bridgeBase}/events?token=...`
   - Message types: `insertPaths`, `pastePath`, `updateOpenedFiles`
3. **Request/Response:** JSON messages with `id`/`replyTo` for RPC-style calls
4. **Auth:** Per-session random UUID token in query params

### State Management (WebGUI)

- **SessionContext:** Current session selection, session CRUD, session list management
- **MessagesContext:** Per-session message store, handles SSE events for live updates
- **ThemeContext:** Light/dark mode detection and synchronization
- **ProjectContext:** Current project directory info
- **ProvidersContext:** AI provider configuration
- **UISettingsContext:** User preferences (persisted via IDE bridge storage)
- **TabStore:** Multi-tab session management
- **SubtaskDrawerContext:** Agent subtask visualization

State flows down via React Context. Server events flow up via SSE -> EventEmitter -> Context updates.

## Key Patterns

### Event-Driven Architecture

The opencode core uses an **Effect-based PubSub event bus** (`src/bus/index.ts`):

- All domain events are defined as `BusEvent.define()` with Zod schemas
- Components publish events; the SSE `/event` route subscribes to all events and streams them
- `Bus.subscribeAll()` is the primary pattern for SSE consumers
- Heartbeats every 10s prevent stale connections

### Instance/Workspace Isolation

The server supports multiple concurrent workspaces via `WorkspaceRouterMiddleware`:

- Each request carries a `directory` query param or `x-opencode-directory` header
- `Instance.provide()` sets up AsyncLocalStorage context per request
- `InstanceState` (Effect `ScopedCache`) manages per-directory state with automatic cleanup

### Embedded Web UI Pattern

The WebGUI is compiled to static assets, then base64-encoded into a generated TypeScript file:

- Build: `packages/opencode/webgui/` -> Vite build -> `packages/opencode/webgui-dist/`
- Embed: Generated into `packages/opencode/src/webgui/embed.generated.ts`
- Serve: `packages/opencode/src/webgui/server/app.ts` resolves paths, serves from memory
- Routes: `/app` and `/app/*` on the Hono server

### Unified IDE Bridge Protocol

Both VSCode and JetBrains plugins implement the same HTTP+SSE bridge protocol:

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

---

_Architecture analysis: 2026-04-12_
