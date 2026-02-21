# Session Tab Bar Design

Replace the dropdown-based session selector with a browser-style tab bar.

## Requirements

- Unclosed tabs persist in the tab bar, ordered left (old) to right (new)
- Drag-to-reorder support
- New session auto-appends to the rightmost position
- The original dropdown trigger moves to the right of the new-session button, restyled as a history (clock) icon
- Tabs can be closed (removed from tab bar, session is NOT deleted)
- Tabs show busy/reasoning status indicators
- Double-click to rename, right-click context menu for other actions

## Architecture

### Tab State Management

Independent `useTabStore` hook in `state/tabStore.ts`, decoupled from `SessionContext`.

Data model stored in KV (`webgui_tabs`):

```ts
{
  openTabs: string[]   // ordered session IDs, left→right = old→new
  activeTab: string    // currently active tab ID
}
```

Exposed API:

- `openTabs: string[]`
- `activeTab: string`
- `openTab(sessionId)` — append to end if not present, activate
- `closeTab(sessionId)` — remove from array, switch to adjacent tab
- `reorderTabs(from, to)` — drag reorder
- `setActiveTab(sessionId)` — activate without reordering

### Persistence

KV API (`sdk.kv`) with debounced writes:

- `openTab` / `closeTab` → immediate KV write (low frequency)
- `reorderTabs` → debounce 500ms
- KV write failure → silent ignore (tab state is UI preference, not critical)

### Coordination with SessionContext

- Subscribe to session deletions → auto-remove from openTabs
- `setActiveTab` → calls `SessionContext.switchSession()`
- Virtual session materialize → replace virtual ID with real session ID in openTabs
- Fork session → auto-open forked session as new tab

## Layout

```
┌─────────────────────────────────────────────────────────┐
│ [Tab1][Tab2][Tab3]...←scrollable→...  | 🟢 [+] [🕒] [⋮] │
│   ← tab area (flex-1, overflow-x) →  │← fixed actions →│
└─────────────────────────────────────────────────────────┘
```

Header height remains `h-9` (36px).

### Tab Area (left, `flex-1`)

- Horizontal scroll, mouse wheel mapped to horizontal
- Gradient shadow hints on overflow edges
- No native scrollbar (`scrollbar-width: none`)

### Fixed Action Area (right)

- `StatusIndicator` (connection dot)
- `+` new session button
- 🕒 history button (clock icon, opens session dropdown)
- `⋮` more menu (theme, command palette, settings, share)

### Single Tab Structure

```
┌──────────────────────┐
│ [●] Tab title...  [×] │
│ status  truncated  close│
└──────────────────────┘
```

- `min-w-[120px]`, `max-w-[200px]`
- Active tab: 2px blue bottom border
- Busy/reasoning: pulsing/spinning status dot on left
- Close button: visible on hover (always visible for active tab)

## Interactions

### Drag and Drop

Native HTML5 Drag and Drop API (no extra dependencies).

- Dragged tab: `opacity-50`
- Drop target: 2px blue vertical line indicator
- On drop: `reorderTabs(fromIndex, toIndex)`

### Right-click Context Menu

- Close tab
- Close other tabs
- Close tabs to the right
- ─── (separator)
- Rename
- Delete session
- Share / Unshare
- Open share link (only if shared)

### Double-click Rename

Double-click tab title → inline `<input>` edit mode. Enter to save, Escape to cancel, blur to auto-save. Reuses existing `updateSessionTitle` logic.

### History Panel

The existing `SessionDropdown` triggered by the history (clock) button instead of the title+chevron. Clicking a session in history calls `openTab(sessionId)` instead of direct `switchSession`.

## Edge Cases

### Startup Restore

1. Load `webgui_tabs` from KV
2. Filter out deleted session IDs against current `sessions` list
3. Empty openTabs → auto-create virtual session tab
4. activeTab not in openTabs → activate last tab

### Session Lifecycle

- Virtual `virtual-xxx` materialized → replace ID in openTabs
- Session deleted (local or SSE event) → auto-remove from openTabs
- Fork → auto-open result as new tab

### KV Write Strategy

- Open/close tab → immediate write
- Drag reorder → debounce 500ms
- Write failure → silent ignore

### Extreme Cases

- 50+ tabs → no perf issue (string array), horizontal scroll handles display
- KV data corrupted → fallback to empty tab list, new virtual session

## File Changes

### New Files

- `state/tabStore.ts` — useTabStore hook
- `components/CompactHeader/TabBar.tsx` — tab bar container (scroll, wheel mapping)
- `components/CompactHeader/Tab.tsx` — single tab (display, drag, double-click edit, right-click)
- `components/CompactHeader/TabContextMenu.tsx` — right-click context menu

### Modified Files

- `components/CompactHeader/index.tsx` — layout: left side from dropdown trigger to `<TabBar />`, right side button reorder
- `components/CompactHeader/ActionButtons.tsx` — add history button (clock icon), reorder buttons
- `components/CompactHeader/SessionDropdown.tsx` — triggered by history button, click behavior → `openTab`
- `App.tsx` — `handleNewSession` also calls `tabStore.openTab()`

### Unchanged Files

- `SessionContext.tsx` — no changes, tab logic does not invade session core
- `SessionList.tsx` / `SessionItem.tsx` — unchanged, used inside history panel
- `useSessionDropdown.ts` / `useSessionActions.ts` — unchanged
