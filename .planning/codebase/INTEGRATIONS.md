# External Integrations

**Analysis Date:** 2026-04-12

## APIs & External Services

**AI/LLM Providers (via Vercel AI SDK in `packages/opencode/`):**

- Anthropic — `@ai-sdk/anthropic` 3.0.64
- OpenAI — `@ai-sdk/openai` 3.0.48
- Google AI — `@ai-sdk/google` 3.0.53
- Google Vertex AI — `@ai-sdk/google-vertex` 4.0.95
- AWS Bedrock — `@ai-sdk/amazon-bedrock` 4.0.83
- Azure AI — `@ai-sdk/azure` 3.0.49
- xAI (Grok) — `@ai-sdk/xai` 3.0.74
- Groq — `@ai-sdk/groq` 3.0.31
- Mistral — `@ai-sdk/mistral` 3.0.27
- Cerebras — `@ai-sdk/cerebras` 2.0.41
- Cohere — `@ai-sdk/cohere` 3.0.27
- DeepInfra — `@ai-sdk/deepinfra` 2.0.41
- Together AI — `@ai-sdk/togetherai` 2.0.41
- Perplexity — `@ai-sdk/perplexity` 3.0.26
- Vercel AI Gateway — `@ai-sdk/gateway` 3.0.80 and `@ai-sdk/vercel` 2.0.39
- OpenRouter — `@openrouter/ai-sdk-provider` 2.3.3
- GitLab AI — `gitlab-ai-provider` 6.0.0
- Additional compatible providers via `@ai-sdk/openai-compatible` 2.0.37

**GitHub Integration:**

- `@octokit/rest` 22.0.1 — GitHub REST API client
- `@octokit/graphql` 9.0.2 — GitHub GraphQL API client
- `@actions/core` + `@actions/github` — GitHub Actions integration for CI/CD

**Authentication:**

- `@openauthjs/openauth` 0.0.0-20250322224806 — OAuth provider authentication
- `opencode-gitlab-auth` 2.0.0 — GitLab-specific OAuth
- `opencode-poe-auth` 0.0.1 — Poe authentication
- `google-auth-library` 10.5.0 — Google OAuth/service account credentials
- `@aws-sdk/credential-providers` 3.993.0 — AWS credential resolution for Bedrock

**MCP (Model Context Protocol):**

- `@modelcontextprotocol/sdk` 1.27.1 — MCP client for tool/resource servers
- Endpoint: `/mcp/{name}/tools` — List MCP server tools
- Endpoint: `/mcp/{name}/enabled` — Enable/disable MCP servers

**Agent Client Protocol:**

- `@agentclientprotocol/sdk` 0.14.1 — Agent protocol integration

**Network Discovery:**

- `bonjour-service` 1.3.0 — mDNS service discovery (`packages/opencode/src/server/mdns.ts`)

## IDE Integration Points

### VSCode Extension (`hosts/vscode-plugin/`)

**Extension Entry Point:** `hosts/vscode-plugin/src/extension.ts`

- Activation events: `onView:opencode.main`, commands (openPanel, addFileToContext, addLinesToContext, pastePath, showDiagnostics)
- Main output: `hosts/vscode-plugin/out/extension.js`

**Components:**

- `BackendLauncher` (`hosts/vscode-plugin/src/backend/BackendLauncher.ts`) — Spawns the opencode backend binary, parses stdout for connection info (port + URL), manages process lifecycle
- `ResourceExtractor` (`hosts/vscode-plugin/src/backend/ResourceExtractor.ts`) — Extracts bundled platform-specific opencode binary from extension resources
- `WebviewManager` (`hosts/vscode-plugin/src/ui/WebviewManager.ts`) — Creates and manages VSCode editor-tab webview panels
- `ActivityBarProvider` (`hosts/vscode-plugin/src/ui/ActivityBarProvider.ts`) — `WebviewViewProvider` that renders the WebGUI in the sidebar activity bar
- `WebviewController` (`hosts/vscode-plugin/src/ui/WebviewController.ts`) — Shared controller for webview lifecycle, HTML injection, and retry logic for Chromium SW bugs
- `CommunicationBridge` (`hosts/vscode-plugin/src/ui/CommunicationBridge.ts`) — Bi-directional messaging between VSCode host and webview
- `IdeBridgeServer` (`hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`) — Local HTTP+SSE server for IDE ↔ WebGUI communication
- `SettingsManager` (`hosts/vscode-plugin/src/settings/SettingsManager.ts`) — VSCode settings configuration and synchronization

**Commands:**

- `opencode.openPanel` — Opens the main webview panel with backend launch
- `opencode.addFileToContext` — Adds file/folder to AI context (explorer/editor context menu, keybinding `Ctrl+'`)
- `opencode.addLinesToContext` — Adds selected lines to context (keybinding `Ctrl+Shift+'`)
- `opencode.pastePath` — Pastes directory path into input
- `opencode.showDiagnostics` — Shows extension diagnostic info

**Remote-SSH Support:**

- `WebviewController` uses `vscode.env.asExternalUri(...)` to externalize both the backend UI URL and the ideBridge server URL for SSH tunneling

**Configuration Settings:**

- `opencode.customCommand` — Custom command for the backend process
- `opencode.minVersion` — Minimum required opencode server version (default: `1.1.1`)

### JetBrains Plugin (`hosts/jetbrains-plugin/`)

**Plugin Entry Point:** `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`

- Registers a tool window factory that creates the JCEF webview

**Components:**

- `IdeBridge` (`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`) — Singleton HTTP+SSE server (same protocol as VSCode), manages per-project sessions, handles `openFile`, `openUrl`, `reloadPath`, `clipboardWrite`, storage operations
- `BackendLauncher` (`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/backendprocess/BackendLauncher.kt`) — Launches opencode backend binary
- `BackendProcess` / `TerminalBackendProcess` (`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/backendprocess/`) — Backend process management with terminal integration
- `DragAndDropInstaller` (`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/DragAndDropInstaller.kt`) — File drag-and-drop into the webview
- `IdeOpenFilesUpdater` (`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeOpenFilesUpdater.kt`) — Notifies WebGUI of open editor file changes
- `PathInserter` (`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/PathInserter.kt`) — Sends file paths to WebGUI context
- `IdeBridgeStorageBackend` (`hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridgeStorageBackend.kt`) — Persistent key-value storage backed by IDE properties

**Platform Compatibility:**

- Since build: 243 (IntelliJ 2024.3)
- Until build: 261.\* (forward-compatible)
- Java 21 required

### WebGUI Frontend (`packages/opencode/webgui/`)

**Entry Point:** `packages/opencode/webgui/src/main.tsx`

- Creates React 19 root, initializes ideBridge, tooltip polyfill, global drag-and-drop

**IDE Bridge Client:** `packages/opencode/webgui/src/lib/ideBridge.ts`

- Reads `ideBridge` and `ideBridgeToken` from URL query parameters
- Opens `EventSource` (SSE) to `{bridgeBase}/events?token=...` for host→UI messages
- Sends UI→host messages via `fetch(POST {bridgeBase}/send?token=...)`
- Promise-based RPC via `id`/`replyTo` correlation
- Exponential backoff reconnect (1s → 30s max)
- Storage API: `storageGet(scope, keys)` and `storageSet(scope, key, value)` with scopes: `global`, `workspace`, `mem`

## Communication Protocols

### opencode HTTP API (Backend ↔ WebGUI)

**Server:** Hono-based HTTP server in `packages/opencode/src/server/server.ts`

- Served on an ephemeral port (parsed from stdout: `opencode server listening on http://...`)
- WebGUI static assets served at `/app` path from `packages/opencode/webgui-dist/`
- CORS enabled for localhost origins, `tauri://localhost`, VSCode webview origins
- Optional basic auth via `OPENCODE_SERVER_PASSWORD` / `OPENCODE_SERVER_USERNAME` env vars
- Compression via Hono middleware (skipped for SSE and streaming endpoints)

**SDK Client:** `packages/opencode/webgui/src/lib/api/sdkClient.ts`

- Uses `@opencode-ai/sdk/client` (`createOpencodeClient`) pointed at `window.location.origin`
- Wraps SDK with additional methods: `session.list`, `session.retry`, `mcp.tools`, `config.allProviders`, `auth.*`, `permissions.respond`, `question.reply`

**Key REST Endpoints (consumed by WebGUI):**

- `GET /session` — List sessions (with optional directory, limit, roots params)
- `GET /session/{id}` — Get session details
- `GET /session/{id}/messages` — Get session message history
- `POST /session/{id}/prompt` — Send prompt to session
- `POST /session` — Create new session
- `DELETE /session/{id}` — Delete session
- `GET /event` — SSE event stream for real-time updates
- `GET /global/event` — Global SSE event stream
- `GET /config` / `PATCH /config` — Project config
- `GET /global/config` / `PATCH /global/config` — Global config
- `GET /provider` — List AI providers with connection status
- `GET /provider/auth` — Get auth methods per provider
- `POST /provider/{id}/oauth/authorize` — Start OAuth flow
- `POST /provider/{id}/oauth/callback` — Complete OAuth flow
- `GET /auth/{id}` / `PUT /auth/{id}` / `DELETE /auth/{id}` — Auth credentials management
- `GET /mcp/{name}/tools` — List MCP server tools
- `PATCH /mcp/{name}/enabled` — Toggle MCP server
- `PATCH /mcp/{name}/tools/{toolId}` — Toggle individual MCP tool
- `GET /skill` — List available skills
- `PATCH /skill/{name}/enabled` — Toggle skill
- `GET /path` — Get directory paths (state, config, worktree, directory)
- `POST /permission/{requestID}/reply` — Respond to permission requests
- `POST /question/{requestID}/reply` — Reply to agent questions
- `POST /question/{requestID}/reject` — Reject agent questions

### SSE Event Stream (Backend → WebGUI)

**Endpoint:** `GET /event` via `EventSource` in `packages/opencode/webgui/src/lib/api/events.ts`

- Reconnects with exponential backoff (1s → 30s max, infinite retries)

**Event Types:**

- `server.connected` — Initial connection confirmation
- `session.created` / `session.updated` / `session.deleted` — Session lifecycle
- `session.error` — Session-level errors
- `session.status` — Session status changes (with retry info)
- `session.idle` — Session became idle
- `session.compacted` — Session history compacted
- `session.diff` — File diff updates for a session
- `message.updated` — Message metadata changed
- `message.removed` — Message deleted
- `message.part.updated` — Message part content updated (with optional delta)
- `message.part.delta` — Incremental text delta for streaming
- `message.part.removed` — Message part removed
- `permission.asked` / `permission.replied` — Permission flow events
- `question.asked` / `question.replied` / `question.rejected` — Question flow events
- `file.edited` / `file.updated` — File change notifications
- `lsp.diagnostics` — LSP diagnostic events
- `todo.updated` — Todo list updates

### IDE Bridge Protocol (IDE Host ↔ WebGUI)

**Transport:** HTTP + SSE on `127.0.0.1` with ephemeral port

- Full specification: `hosts/IDE_BRIDGE_HTTP_SSE.md`
- Session-scoped with UUID-based `sessionId` and `token` auth
- SSE keepalive pings every 15 seconds

**WebGUI → IDE Host Messages:**

- `openFile` — Open file in editor: `{ path: string, line?: number }`
- `openUrl` — Open URL in browser: `{ url: string }`
- `reloadPath` — Trigger file reload in IDE: `{ path: string, operation?: "write" | "edit" | "apply_patch" }`
- `clipboardWrite` — Write to system clipboard: `{ text: string }`
- `restartHost` — Restart the IDE/extension host
- `ensureAndOpenFile` — Create file if missing, then open: `{ path: string }`
- `storageGet` — Read from scoped storage: `{ scope, keys }`
- `storageSet` — Write to scoped storage: `{ scope, key, value }`

**IDE Host → WebGUI Messages (via SSE):**

- `insertPaths` — Insert file paths into input: `{ paths: string[] }`
- `pastePath` — Paste single path: `{ path: string }`
- `updateOpenedFiles` — Sync open editor tabs: `{ openedFiles: string[], currentFile?: string | null }`
- `drag-event` — Forward drag-and-drop events (macOS VSCode workaround)

**Request/Response Pattern:**

- Requests include `id: string`
- Responses include `replyTo: string` matching the request `id`, `ok: boolean`, optional `error: string`

### VSCode Webview Communication

**Legacy postMessage (CommunicationBridge):** `hosts/vscode-plugin/src/ui/CommunicationBridge.ts`

- `vscode.Webview.postMessage()` / `webview.onDidReceiveMessage()` for direct VSCode ↔ webview messaging
- Used alongside the ideBridge HTTP+SSE transport
- Handles: file operations, state sync, settings

## Data Storage

**Databases (opencode core):**

- SQLite via Drizzle ORM — Local database for sessions, messages, projects, accounts
  - Schemas: `packages/opencode/src/**/*.sql.ts`
  - Key tables: `session`, `project`, `account`, `workspace`, `share`, `event`, `schema` (storage)
  - Platform-specific DB driver: `packages/opencode/src/storage/db.bun.ts` (Bun) / `db.node.ts` (Node)
  - Migrations: `packages/opencode/migration/` generated by Drizzle Kit

**Cloud Infrastructure (upstream, not IDE plugin):**

- SST (Serverless Stack) 3.18.10 — Infrastructure-as-code in `sst.config.ts`
- Cloudflare (home provider for SST)
- PlanetScale — MySQL-compatible database (via `planetscale` SST provider)
- Stripe — Payment integration (via `stripe` SST provider)
- AWS S3 — `@aws-sdk/client-s3` for file storage

**IDE-level Storage:**

- VSCode `ExtensionContext.globalState` / `workspaceState` — Persisted key-value store accessed via ideBridge `storageGet`/`storageSet`
- VSCode in-memory map — Ephemeral `mem` scope storage
- JetBrains `PropertiesComponent` — IDE properties-based persistent storage (`IdeBridgePropertiesStorageBackend`)
- JetBrains `ConcurrentHashMap` — In-memory `mem` scope per session
- WebGUI `scopedStorage` — Client-side state persistence delegating to IDE storage backend (`packages/opencode/webgui/src/state/scopedStorage.ts`)

**File Storage:**

- Local filesystem for project files, generated code, and configuration
- XDG base directories for config/state paths (`xdg-basedir` 5.1.0)

**Caching:**

- No dedicated cache service — relies on SQLite, in-memory state, and Bun/Node runtime caching

## CI/CD & Deployment

**CI Platform:** GitHub Actions

**Key Workflows:**

- `.github/workflows/test.yml` — Test suite
- `.github/workflows/typecheck.yml` — TypeScript type checking
- `.github/workflows/publish-vscode.yml` — VSCode extension publishing (manual dispatch)
  - Runner: `blacksmith-4vcpu-ubuntu-2404`
  - Publishes via `@vscode/vsce` with `VSCE_PAT` and `OPENVSX_TOKEN` secrets
- `.github/workflows/release.yml` — Release automation
- `.github/workflows/publish.yml` — General publishing
- `.github/workflows/beta.yml` — Beta release channel
- `.github/workflows/containers.yml` — Container builds

**Build Scripts (for IDE plugins):**

- `hosts/scripts/build_vscode.sh` / `build_vscode.bat` — VSCode extension packaging (compiles TS, bundles opencode binary, creates .vsix)
- `hosts/scripts/build_jetbrains.sh` / `build_jetbrains.bat` — JetBrains plugin packaging (Gradle build, bundles opencode binary, creates .zip)
- `hosts/scripts/build_opencode.sh` / `build_opencode.bat` — Builds opencode backend binaries for bundling
- `hosts/scripts/dev_vscode.sh` — Development mode for VSCode extension
- `hosts/scripts/test_vscode.sh` — VSCode extension test runner

**Deployment Targets:**

- VSCode Marketplace — Via `@vscode/vsce` publish
- Open VSX Registry — Via `OPENVSX_TOKEN`
- JetBrains Marketplace — Via Gradle IntelliJ Platform plugin (signed + verified)
- Cloudflare — SST-managed infrastructure for the console/enterprise (upstream)

## Environment Configuration

**Required env vars (noted by existence, values not read):**

- `.env` files present at various levels
- `OPENCODE_BIN` — Override path for the opencode binary in VSCode extension
- `OPENCODE_SERVER_PASSWORD` / `OPENCODE_SERVER_USERNAME` — Optional basic auth for server
- `OPENCODE_DISABLE_SHARE` — Disable sharing functionality
- AI provider API keys — Configured through the opencode config/auth system

**Version Synchronization:**

- WebGUI version: `26.3.301` (`packages/opencode/webgui/package.json`)
- VSCode extension version: `26.3.301` (`hosts/vscode-plugin/package.json`)
- opencode core version: `1.3.3` (`packages/opencode/package.json`)
- SDK version: `1.3.3` (`packages/sdk/js/package.json`)
- Minimum server version enforced by IDE plugins: `1.1.1` (configurable)
- WebGUI `__APP_VERSION__` injected via Vite `define` at build time

---

_Integration audit: 2026-04-12_
