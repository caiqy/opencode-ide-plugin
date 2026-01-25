# ideBridge: Unified Host ↔ UI Messaging

This document explains the unified `ideBridge` used by IDE hosts (JetBrains, VSCode) and the web UI (packages/opencode/webgui). It standardizes bidirectional communication, supports request/response (RPC), centralizes delivery, and handles lifecycle queueing.

## Goals

- Unify the bridge API under `window.ideBridge`
- Request/response semantics (id/replyTo)
- Centralize host→UI delivery (single injection point)
- Use only message-based interaction (no scattered globals)
- Queueing and lifecycle resilience on both sides

We intentionally defer: strict origin checks, schemas, and runtime validation for now.

---

## Message shape

- Common fields:
  - `type: string` – message kind
  - `payload?: any` – arbitrary data per type
  - `id?: string` – present for requests
  - `replyTo?: string` – present for responses
  - `ok?: boolean` and `error?: string` – optional result flags in responses
  - `timestamp?: number`

Example request:

```json
{ "id": "abc123", "type": "openFile", "payload": { "path": "/p/file.ts", "line": 42 }, "timestamp": 1731390000000 }
```

Example response:

```json
{ "replyTo": "abc123", "ok": true }
```

---

## JetBrains host (JCEF)

- Entry point: `paviko.opencode.ui.IdeBridge`
  - Creates a single `JBCefJSQuery` to receive UI→host JSON strings
  - Injects two shims into the page:
    - `__ideBridgeSend(string)` – UI calls this; routes into the JSQuery
    - `__ideBridgeDeliver(any)` – Host uses this to deliver messages to UI
  - Provides host API:
    - `IdeBridge.install(browser, project)` – set up bridge and queues
    - `IdeBridge.send(type, payload)` – host→UI message
    - Handles inbound requests (sample): `openFile { path, line }` -> opens in IDE, replies `{ ok: true }`
  - Queues host→UI messages until WebView is ready; flushes automatically

Converted usages:

- All `executeJavaScript(window.postMessage(...))` replaced by `IdeBridge.send(type, payload)`
- Components updated:
  - `PathInserter` → `IdeBridge.send("insertPaths"|"pastePath", ...)`
  - `IdeOpenFilesUpdater` → `IdeBridge.send("updateOpenedFiles", ...)`
  - `FontSizeSynchronizer` (kept for compatibility) → `IdeBridge.send("setFontSize", { size })`
- Removed legacy per-feature JSQuery bridges and direct observers. `OpenInIdeHandler` is superseded by `IdeBridge` request handler.

---

## Web UI (packages/opencode/webgui)

- File: `src/lib/ideBridge.ts`
  - Exposes:
    - `ideBridge.init()` – binds dispatching to `window.postMessage` and host shims
    - `ideBridge.isInstalled()` – returns `true` when running inside an IDE host (JCEF/VSCode iframe); use to avoid `window.open()` which hangs JCEF
    - `ideBridge.send(msg)` – UI→host fire-and-forget
    - `ideBridge.request(type, payload)` – returns Promise; resolves on `{ replyTo }`
    - `ideBridge.on(handler)` – subscribe to host→UI messages
    - Outbound queue until `__ideBridgeSend` exists, then `flush()`
- Initialize in `src/main.tsx` before React mount
- App code subscribes once and routes messages by `type`

Minimal UI usage:

```ts
import { ideBridge } from "./lib/ideBridge"

ideBridge.init()
ideBridge.on((msg) => {
  switch (msg.type) {
    case "updateOpenedFiles":
      /* update state */ break
    case "insertPaths":
      /* route into UI */ break
  }
})

// Request/response example
await ideBridge.request("openFile", { path: "/p/file.ts", line: 10 })

// Opening URLs safely (avoids window.open() which hangs JCEF)
if (ideBridge.isInstalled()) {
  ideBridge.send({ type: "openUrl", payload: { url } })
} else {
  window.open(url, "_blank")
}
```

---

## VSCode host (iframe-ready)

- The UI expects two shims on the iframe window:
  - `__ideBridgeSend(string)` – UI→extension delivery
  - `__ideBridgeOnMessage(any)` – extension→UI delivery entry
- The extension should forward UI requests to its internal logic and respond with `{ replyTo, ok, ... }`
- No changes needed in `webgui` beyond `ideBridge.init()`

---

## Adding new features

1. Define a new `type` and payload contract
2. UI side:
   - Send: `ideBridge.send({ type, payload })` or `ideBridge.request(type, payload)`
   - Receive: `ideBridge.on(msg => { if (msg.type === 'newType') ... })`
3. Host side (JetBrains):
   - In `IdeBridge.handleInbound`, add case for `type`
   - Perform work, then `replyOk(id)` or `replyError(id, message)`
   - For proactive host→UI updates, call `IdeBridge.send(type, payload)`

---

## Migration notes

- Old direct DOM/JS injection and multiple JSQuery bridges are replaced by one bridge
- Remove any remaining references to `WebViewLoadHandler`, `WebViewScripts`, and `OpenInIdeHandler` in new code paths
- Prefer routing all state/UI sync through message types so VSCode and JetBrains remain aligned

---

## Troubleshooting

- If UI isn’t receiving messages:
  - Ensure `ideBridge.init()` runs before app logic
  - Confirm host injected shims (`__ideBridgeSend`, `__ideBridgeDeliver`) – JetBrains is handled by `IdeBridge.install`
- If requests never resolve:
  - Verify host replies include `replyTo` equal to request `id`

---

## Message types (from implementation)

### JetBrains host (JCEF) → Web UI

- **insertPaths** — payload: `{ paths: string[] }`
- **pastePath** — payload: `{ path: string }`
- **updateOpenedFiles** — payload: `{ openedFiles: string[], currentFile: string | null }`
- **setTooltipPolyfill** — payload: `{ enabled: boolean }` — JetBrains-only: enables CSS tooltip polyfill for `title` tooltips

### Web UI → JetBrains host (handled)

- **openFile** — payload: `{ path: string, line?: number }` → opens file in IDE, responds with `{ replyTo, ok }` or `{ replyTo, ok: false, error }`
- **openUrl** — payload: `{ url: string }` → opens URL in default browser, responds with `{ replyTo, ok }`
- **reloadPath** — payload: `{ path: string, operation: "write" | "edit" }` → reloads file from disk after AI agent modifies it, responds with `{ replyTo, ok }`

### Protocol notes

- **Responses**: `{ replyTo, ok, error? }`
- **Transport shims**: UI uses `__ideBridgeSend` to send and `__ideBridgeOnMessage`/host `__ideBridgeDeliver` to receive
