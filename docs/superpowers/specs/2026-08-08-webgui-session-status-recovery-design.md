# WebGUI Session Status Recovery Design

## Problem

The WebGUI currently has two writers for session activity:

- `SessionContext` applies `session.status` events and the reconnect status snapshot.
- `MessagesContext.loadLatest` infers activity from the latest assistant message's
  `time.completed` field.

After a plugin restart, the status snapshot and message history load run in
parallel. An incomplete historical assistant message can therefore overwrite an
authoritative idle status, leaving the tab indicator, reasoning label, typing
state, or tool card looking active after execution has ended.

The server status list contains active sessions only. A session missing from a
successful snapshot is idle.

## Requirements

- A successful `session.status` snapshot and subsequent status events are the
  sole authority for session activity.
- A session that is still `busy` or `retry` after restart remains visibly active.
- A session absent from a successful status snapshot is idle.
- Idle sessions never show a pulsing tab status dot.
- Historical reasoning and tool parts that remain incomplete after the session
  is authoritatively idle are displayed as interrupted, without mutating the
  stored message history.
- A failed status snapshot must not classify historical parts as interrupted.

## Design

### Status ownership

`SessionContext` remains the owner of the per-session busy map. On
`server.connected`, it marks status recovery as pending and requests the status
snapshot. A successful snapshot replaces the known active set for untouched
sessions: non-idle entries are busy, while idle or missing entries are idle.
Newer SSE or local status updates retain precedence through the existing status
version checks.

`MessagesContext.loadLatest` continues to merge messages and reasoning parts,
but no longer calls `setSessionIdle`. Message completion timestamps are
historical data, not a reliable process-liveness signal.

Reasoning selectors return true only while the same session is busy. This keeps
stale reasoning-part bookkeeping from reviving an idle indicator.

### Recovery readiness

`SessionContext` exposes whether the latest reconnect status snapshot completed
successfully. It becomes false when a reconnect starts and true only after a
successful snapshot is applied. If the request fails, it remains false and live
SSE updates may still update activity normally.

This readiness flag prevents the UI from briefly labeling a genuinely active
tool as interrupted while the reconnect snapshot is still in flight.

### Display reconciliation

The tab renders its status dot only when the session is busy. Reasoning chooses
the purple color only within that busy state.

Once status recovery is ready, an idle session supplies a display-only
`sessionInterrupted` signal to its message rows:

- A reasoning part with no end time shows `思考已中断`.
- A tool part whose stored state is `pending` or `running` uses a static
  `interrupted` header state and an `已中断` label.
- Completed and errored parts are unchanged.

The message objects received from the server are not rewritten or persisted.

## Error Handling

If status recovery fails, the WebGUI does not infer activity from messages and
does not synthesize interrupted labels. Existing state and later SSE events are
left intact. This avoids replacing an unknown state with a false idle result.

## Tests

- Message loading never writes session idle/busy state, including when an
  incomplete assistant message wins a history merge race.
- A reconnect snapshot restores active sessions and clears untouched sessions
  missing from the active-only snapshot.
- A newer SSE status is not overwritten by an older snapshot.
- Reasoning is false whenever its session is idle.
- A stale reasoning flag cannot render a tab dot for an idle session.
- Incomplete reasoning and tool parts render as interrupted only after status
  recovery confirms the session is idle.

## Out of Scope

- Rewriting persisted assistant messages or tool parts.
- Resuming provider or tool execution after the backend process itself restarts.
- Changing server status persistence or delivery semantics.
