# Webgui Tab Bridge Persistence Design

## Problem

Tab state (`openTabs`, `activeTab`) is persisted only through `localStorage` via `sdk.kv`. When the webview origin changes (port shift, VS Code webview storage reset), all open tabs are lost and users must re-find sessions from history.

## Solution

Move tab persistence into `uiBridgeState`, which uses `ideBridge.setState()` to store state through VS Code's `webview.setState()` API. This channel survives webview recreation and is not tied to a specific HTTP origin.

## Data Model

Upgrade `UiBridgeState` from v2 to v3, adding two fields:

```ts
type UiBridgeState = {
  v: 3
  sessionID: string | null
  providerId: string | null
  modelId: string | null
  agent: string | null
  variant: string | null
  drafts: Record<string, string>
  openTabs: string[] // new
  activeTab: string // new
}
```

`uiBridgeHydrate()` must handle v2 payloads (missing `openTabs`/`activeTab`) by falling back to `[]` / `""`.

## Sync Strategy

### Startup

1. `uiBridgeHydrate()` restores full state from VS Code webview state, including `openTabs`/`activeTab`.
2. `tabStore` initializes by checking `uiBridgeState()` first. If bridge state has non-empty `openTabs`, use it. Otherwise fall back to `sdk.kv.get()` (localStorage).
3. Priority: bridge state > localStorage.

### Runtime

- `tabStore.save()` continues calling `sdk.kv.update()` (localStorage, unchanged).
- `tabStore.save()` additionally calls `uiBridgeUpdate({ openTabs, activeTab })` to sync into bridge state.
- Bridge state debounces and sends to VS Code via `ideBridge.setState()`.

### Ownership

`tabStore` is the sole driver of tab operations. `uiBridgeState` passively receives and persists; it never pushes tab changes back to `tabStore`.

## Edge Cases

- **Virtual tabs**: Filter `virtual-*` IDs when syncing to bridge state (consistent with `sanitizeSession` behavior).
- **Non-IDE environment**: When `ideBridge.isInstalled()` returns false, bridge sync is a no-op. Behavior matches current localStorage-only path.
- **Deleted sessions**: Restored `openTabs` may contain stale session IDs. Not addressed here (existing tabStore also doesn't validate against session list).

## Testing

- `uiBridgeState.test.ts`: `uiBridgeHydrate()` correctly parses v3 `openTabs`/`activeTab`; falls back on v2 input.
- `uiBridgeState.test.ts`: `uiBridgeUpdate()` with `openTabs` change triggers `send`.
- `tabStore.test.ts`: Init prefers bridge state over empty localStorage.
- `tabStore.test.ts`: `save()` calls `uiBridgeUpdate` alongside `sdk.kv.update`.
