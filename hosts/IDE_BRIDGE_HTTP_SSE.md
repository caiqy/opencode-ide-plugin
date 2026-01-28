# ideBridge v2: Local HTTP + SSE Transport

This document describes the current IDE <-> Web UI communication mechanism used by:

- JetBrains host: `hosts/jetbrains-plugin`
- VSCode host: `hosts/vscode-plugin`
- Web UI: `packages/opencode/webgui`

This replaces the older CEF/JSQuery/router injection approach and avoids VSCode-specific `postMessage` tunnels for ideBridge traffic.

## Goals

- One transport and one message contract across JetBrains + VSCode
- No CEF `cefQuery_*` bindings, no JS injection ordering sensitivity
- Works with VSCode Remote-SSH via `vscode.env.asExternalUri(...)`

## Message contract

All messages are JSON objects.

Common fields:

- `type: string`
- `payload?: any`
- `timestamp?: number`

Request/response:

- Requests include `id: string`
- Responses include `replyTo: string` matching the request `id`
- Responses include `ok: boolean` and optional `error: string`

Example request:

```json
{ "id": "abc123", "type": "openFile", "payload": { "path": "/p/file.ts", "line": 42 }, "timestamp": 1731390000000 }
```

Example response:

```json
{ "replyTo": "abc123", "ok": true, "timestamp": 1731390000100 }
```

## Transport

The IDE host runs a small HTTP server bound to `127.0.0.1` on an ephemeral port and creates a per-webview session.

Session identifiers:

- `sessionId`: random UUID used in the URL path
- `token`: random UUID used as a query parameter for auth

Base URL shape:

```
http://127.0.0.1:{port}/idebridge/{sessionId}
```

Endpoints:

- `GET  {baseUrl}/events?token=...`
  - SSE stream (`text/event-stream`)
  - Server pushes messages as `event: message` with `data: <json>`
  - Server sends periodic keepalive pings (`: ping`) to prevent proxy/tunnel timeouts

- `POST {baseUrl}/send?token=...`
  - Body: JSON message
  - Response: `204` on success, `401` if token mismatch, `400` on malformed body

Notes:

- CORS is permissive (`Access-Control-Allow-Origin: *`) because the token is unguessable and scoped per session.
- SSE headers include `Cache-Control: no-cache, no-transform` and `X-Accel-Buffering: no` to reduce buffering by proxies.

## Web UI (packages/opencode/webgui)

File: `packages/opencode/webgui/src/lib/ideBridge.ts`

The UI reads two query params from `window.location.search`:

- `ideBridge`: base URL (string)
- `ideBridgeToken`: token

Behavior:

- `ideBridge.init()` opens an `EventSource` to `{ideBridge}/events?token=...`
- UI -> host messages arrive via SSE and are dispatched to subscribers
- UI -> IDE messages are sent via `fetch(POST {ideBridge}/send?token=...)`
- Requests use `id/replyTo` to implement Promise-based RPC
- Includes reconnect logic + bounded retries for transient send failures

If params are missing, `ideBridge.isInstalled()` is `false` and requests are rejected.

## JetBrains host (hosts/jetbrains-plugin)

Server + routing:

- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt`
  - Starts `HttpServer` on `127.0.0.1:0`
  - Creates sessions per project (`createSession(project)`), maps `Project -> sessionId`
  - Implements SSE fan-out to all connected clients per session
  - Implements inbound handlers for `openFile`, `openUrl`, `reloadPath`

URL wiring:

- `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt`
  - Creates a session and appends `ideBridge` and `ideBridgeToken` to the UI URL

Host -> UI updates:

- Utilities call `IdeBridge.send(project, type, payload)` (session is looked up automatically)

## VSCode host (hosts/vscode-plugin)

Server + routing:

- `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
  - Starts a Node HTTP server on `127.0.0.1:0`
  - Creates sessions per webview (`createSession(handlers)`)
  - SSE stream + keepalive pings
  - Inbound handlers call into VSCode logic (`openFile`, `openUrl`, `reloadPath`)

Remote-SSH support:

- `hosts/vscode-plugin/src/ui/WebviewController.ts`
  - Uses `vscode.env.asExternalUri(...)` for both:
    - the backend UI base URL
    - the ideBridge server base URL
  - Passes the externalized URLs into the iframe as query params

Host -> UI updates:

- `CommunicationBridge` can route ideBridge-type host messages via the bridge server once `setBridgeSession(...)` is called.

## Implemented message types

Web UI -> host (handled by both hosts):

- `openFile` payload: `{ path: string, line?: number }`
- `openUrl` payload: `{ url: string }`
- `reloadPath` payload: `{ path: string, operation?: "write" | "edit" | "apply_patch" }`

Host -> Web UI (sent by hosts):

- `insertPaths` payload: `{ paths: string[] }`
- `pastePath` payload: `{ path: string }`
- `updateOpenedFiles` payload: `{ openedFiles: string[], currentFile?: string | null }`

## Troubleshooting

- UI never connects:
  - Confirm the loaded URL includes `ideBridge=` and `ideBridgeToken=`
  - Confirm the host server is started and reachable (ephemeral port on localhost)

- Requests never resolve:
  - Host must reply with `{ replyTo: <id>, ok: true|false }` over SSE

- Remote-SSH drops the connection:
  - Keepalives should prevent idle timeouts; verify they are flowing (`: ping` frames)
  - Ensure `asExternalUri` is applied to the bridge URL in VSCode
