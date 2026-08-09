# WebGUI Permission Notification Coalescing Design

## Problem

`MessagesContext` currently deduplicates permission notifications by request ID.
Parallel tool calls create distinct permission request IDs, so one AI turn can
produce several identical system notifications for the same session.

The IDE bridges only receive display requests and do not know when permissions
are resolved. Coalescing therefore belongs in the WebGUI permission event owner.

## Requirements

- While a session has any unresolved permission request, send at most one system
  notification for that session.
- Continue tracking and displaying every permission request independently.
- After all permission requests for a session are resolved, a later request may
  send a new notification.
- Pending permissions in different sessions notify independently.
- Preserve existing foreground and unavailable-bridge suppression without
  replaying a delayed notification.
- Do not change question, session-completion, notification text, or IDE bridge
  behavior.

## Design

`MessagesContext` keeps using its existing request-ID-to-session map. Before
recording a new `permission.asked` event, it checks both that the request ID is
new and that no tracked request already belongs to the same session. Only that
session's first unresolved request calls `sendIdeNotification`.

Every new request is still added to the map, including requests whose
notification is coalesced or suppressed. `permission.replied` and successful
local responses remove each request ID immediately. A successful reconnect
snapshot reconciles the map with authoritative pending permissions without
sending notifications: untouched entries follow the snapshot, while requests
changed by newer SSE or local responses retain precedence. Existing
`session.deleted` cleanup removes all request IDs for the deleted session.

This uses pending state rather than a timer, so notification delivery is not
delayed and no debounce cleanup or host protocol change is required.

## Tests

The focused `MessagesContext` test will verify that:

- distinct concurrent permission requests in one session send one notification;
- another request remains coalesced while any earlier request is unresolved;
- resolving every request allows a later request to notify again;
- a different session can notify while the first session still has pending
  requests;
- permission hydration establishes and clears the session gate without sending
  a delayed notification;
- a successful local response still reopens the gate when its replied SSE is
  missed during reconnect.

Existing tests continue to cover repeated delivery of one request ID,
foreground suppression, bridge readiness, replies, and session deletion.

## Out of Scope

- Delaying notifications to report a request count or combined tool names.
- Deduplicating notifications globally across sessions.
- Changing VS Code, JetBrains, or operating-system notification implementations.
