# Design: Skip Virtual Session When Tabs Restore

## Problem

When VS Code restarts, the tab bridge persistence correctly restores `openTabs`/`activeTab` from the previous session. However, a new virtual tab is still created and opened because:

1. `SessionProvider` synchronously creates `virtual-xxx` as `currentSession` on mount.
2. `tabStore` asynchronously loads and restores `["s1", "s2"]` with `activeTab: "s2"`.
3. CompactHeader Effect 2 (line 293-298) sees `virtual-xxx` not in restored tabs → calls `openTab("virtual-xxx")` → unwanted extra tab.
4. No logic switches `currentSession` to the restored `activeTab`.

## Solution

Modify two Effects in CompactHeader:

### Change 1: Guard Effect 2 against virtual + restored tabs

Effect 2 currently adds `currentSession` to tabs whenever it's not already open. Add a guard: if `currentSession` is virtual and `tabStore` already has restored tabs, skip the `openTab` call.

```
// Effect 2 (line 293-298)
if (currentSession.id.startsWith("virtual-") && tabStore.openTabs.length > 0) return
```

### Change 2: Extend Effect 1 to restore activeTab session

Effect 1 currently handles the "no tabs" case. Extend it: when `tabStore` loads with restored tabs and `currentSession` is still virtual, call `switchSession(activeTab)` to resume the previous session. If `switchSession` fails (session deleted), fall back to `onNewSession()`.

```
// Effect 1 (line 281-291) — new branch
if (currentSession?.id?.startsWith("virtual-") && tabStore.activeTab) {
  switchSession(tabStore.activeTab).catch(() => onNewSession())
  return
}
```

### Interaction with App.tsx bridge restore

App.tsx line 89-96 restores `bridge.sessionID` via `switchSession`. This runs before `tabStore.loaded` becomes true (bridge is synchronous hydrate, tabStore is async kv.get). Two scenarios:

- **Bridge has sessionID**: App.tsx switches session first. By the time tabStore loads, `currentSession` is no longer virtual → Effect 1 and Effect 2 guards are not triggered. No conflict.
- **Bridge has no sessionID** (fresh install or cleared state): `currentSession` stays virtual → Effect 1 kicks in and restores from `tabStore.activeTab`.

### Edge case: activeTab session deleted

`switchSession` fetches from server if session is not in local list. If the session was deleted, the fetch returns nothing and the promise rejects → `catch` calls `onNewSession()` to create a fresh virtual session.

## Files Changed

- `packages/opencode/webgui/src/components/CompactHeader/index.tsx` — modify 2 Effects (~5-6 lines)
- `packages/opencode/webgui/src/components/CompactHeader/index.test.tsx` — add test cases

## Testing

- Tab restore with virtual skip: mock tabStore with restored tabs, verify no virtual tab is opened
- Session switch on restore: verify `switchSession(activeTab)` is called when tabs are restored
- Fallback on failed restore: verify `onNewSession()` is called when `switchSession` rejects
- No regression: existing tests for empty-tab and bridge-restore scenarios still pass
