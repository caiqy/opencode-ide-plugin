# Task 3 WebGUI Compatibility Audit

## Status

DONE_WITH_CONCERNS

## Summary

- 审计范围按 `task-3-brief.md` 执行，只审计 merge 后真实代码，未修改源码、generated artifacts、tasks 或 `.comet.yaml`。
- WebGUI core SDK/API、SSE、provider/model/agent/variant、project/path、VSCode bridge、JetBrains bridge、WebGUI `/app` asset serving 大体保留。
- 发现 1 个生产兼容 broken：`SessionSummaryScheduler` 发布 `Session.Event.DiffStatus`，但 `Session.Event` 未导出 `DiffStatus`，会破坏 `session.diff.status` 事件路径并属于 `packages/opencode` 生产源码问题。
- Task 2 剩余红项分类：`packages/tui` 当前剩余为 test/support drift；`packages/opencode` 除 broad test/support drift 外，Task 3 确认存在上述生产兼容问题。

## Audit Items

### SDK/API Calls

- session list/create/update/delete/select/send prompt: pass
  - WebGUI wrapper 和 generated SDK 仍对齐 `/session`、`/session/{id}`、`/session/{id}/message`、diff/fork/revert/unrevert/title routes；调用点使用 `path: { id }`。
- config load/save/fallback: pass
  - `sdk.config.get/update/providers`、`/global/config` fallback 和 `/config/providers/:providerID/models` route 均存在。
- provider/model/agent/variant loading and fallback: pass
  - `SessionContext` 从 workspace selection、recent model、config model、provider first model 逐级 fallback，并校验 unavailable model/variant。
- prompt provider/model/agent/variant payload: pass
  - `useMessageInput` prompt body 使用 `{ model: { providerID, modelID }, agent, variant }`；command body 使用 `model: "provider/model"` 和 `variant`。
- project/path startup context: pass
  - `ProjectContext` 调用 `sdk.project.current()` 和 `sdk.path.get()`；server declares `/project/current` and `/path` with `configFile/worktree/directory`.
- permission reply/reject route: pass
  - WebGUI posts `/permission/:requestID/reply`; server declares `POST /permission/:requestID/reply`.
- question reply/reject route: pass
  - WebGUI posts `/question/:requestID/reply` and `/question/:requestID/reject`; server declares both.
- MCP/skill compatibility routes touched by WebGUI settings: pass
  - WebGUI wrapper has `/mcp/:name/enabled`, `/mcp/:name/tools/:toolId`, `/skill`, `/skill/:name/enabled`; Task 2 evidence shows SDK/OpenAPI regeneration now includes MCP toggle paths.

### SSE Event Handling

- `/event` authentication and lifecycle: pass
  - `EventApi` is `GET /event` with Authorization, workspace routing, instance context; handler emits `server.connected`, heartbeat, and stops on `server.instance.disposed`.
- `message.*` to `MessagesContext`: pass
  - WebGUI subscribes `message.updated`, `message.part.updated`, `message.part.delta`, `message.removed`, `message.part.removed`; schema keeps those legacy event names and payloads.
- `session.*` to `SessionContext`: broken: `packages/opencode/src/session/summary-scheduler.ts:79 publishes Session.Event.DiffStatus, but packages/opencode/src/session/session.ts:323-329 exports no DiffStatus event`
  - `session.created/updated/deleted/status/diff/error/compacted` paths are otherwise present; broken path is specifically `session.diff.status`.
- `permission.*` pending updates: pass
  - `permission.asked` payload has `id/sessionID/tool.callID`; `permission.replied` has `requestID`; WebGUI stores/removes accordingly.
- `question.*` pending updates: pass
  - `question.asked/replied/rejected` payloads match WebGUI's `Map<sessionID, QuestionRequest[]>` flow.
- file/edit/tool-result host reload data: pass
  - WebGUI sends `reloadPath` for completed `write`/`edit` `state.input.filePath` and `apply_patch` metadata `filePath/movePath`.

### IDE Bridge

- bridge token and URL initialization: pass
  - WebGUI reads `ideBridge` and `ideBridgeToken`; VSCode and JetBrains append both query params from per-session bridge servers.
- storageGet/storageSet persistence path: pass
  - WebGUI uses `ideBridge.storageGet/storageSet`; VSCode maps to `workspaceState/globalState/mem`; JetBrains maps to storage backend and session `mem`.
- write/edit/apply_patch reloadPath message: pass
  - Host bridge servers handle `reloadPath`; VSCode calls `CommunicationBridge.handleReloadPath`, JetBrains refreshes VFS path or parent.
- server restart, bridge reconnect, host restart/update tolerance: pass
  - WebGUI bridge reconnects with backoff; VSCode load retries transient SW failures and `restartHost` reloads window after replying; JetBrains sends `restartMode: ide` and supports update/restart messages.
- VSCode WebGUI embedding and packaging assumptions: pass
  - VSCode `WebviewController` loads `resources/webview/index.html`, injects backend `/app` iframe URL and bridge CSP origins; package manifest preserves `resources/*` references.
- JetBrains WebGUI embedding and packaging assumptions: pass
  - JetBrains JCEF loads backend `/app` URL with cache buster and bridge params; Gradle processResources keeps plugin metadata/min-version expansion.
- opencode WebGUI `/app` serving: pass
  - `server.ts` routes `/app` to `serveWebGuiPath`; `embed.generated.ts` contains `index.html` and assets; unknown SPA paths fall back to `index.html`.
- bridge customApi state sync: pass
  - Runtime default is `customApi = true`; VSCode connected metadata omits `customApi`, JetBrains omits it, so one-time React state read does not contradict current host behavior.

## Task 2 Red Item Risk Classification

- production compatibility: broken: `packages/opencode/src/session/summary-scheduler.ts:79 uses missing Session.Event.DiffStatus export, directly affecting the WebGUI session diff status SSE path`
- test/support drift: pass
  - Task 2 reports `packages/tui` typecheck now red only on test event `id` fixture shape in `notifications.test.ts`, `sync.test.tsx`, and `use-event.test.tsx`; production `src/context/project.tsx` was fixed.
- test/support drift: pass
  - Task 2 reports `packages/opencode` typecheck remains red in broad test/support surfaces: `test/server/httpapi-exercise`, stale test imports (`@/bus`, `provider/schema`), and old helper shapes.
- generator/artifact consistency: pass
  - Task 2 final evidence reports legacy SDK generator and root SDK OpenAPI regeneration succeeded, with MCP toggle paths present.

## Broken Items

- broken: `packages/opencode/src/session/summary-scheduler.ts:79 publishes Session.Event.DiffStatus but packages/opencode/src/session/session.ts:323-329 does not export DiffStatus; WebGUI subscribes session.diff.status and will not receive/compile this event path cleanly`

## Task 4 Minimal Fix Suggestions

- Add the smallest `DiffStatus` event contract near the session event owner and export it through `Session.Event`, matching WebGUI's existing payload: `{ sessionID, status: "scheduled" | "running" | "idle" | "deleted" | "failed", message }` and type `"session.diff.status"`.
- After that, run the narrowest check first: `bun typecheck` from `packages/opencode`; then rerun WebGUI/session diff focused tests only if Task 4 changes event schema or generated SDK surface.
- Do not rewrite WebGUI handlers unless the event payload contract changes; current handler already matches the intended payload.

## Read-only Command / Tool Summary

- CodeGraph: `codegraph_context`, `codegraph_files`, `codegraph_explore`, `codegraph_search` for WebGUI SDK/SSE/bridge structure.
- Literal rg/Grep: route/event/bridge names including `/event`, `/session`, `/config`, `/path`, `/permission`, `/question`, `message.*`, `session.*`, `permission.*`, `question.*`, `storageGet`, `storageSet`, `reloadPath`, `ideBridgeToken`.
- Read: Task 3 brief, Task 2 report, merge evidence, WebGUI API/state/bridge files, opencode HttpApi groups/handlers, schema event files, VSCode and JetBrains bridge/packaging files.
- Shell: `git status --short` only; output was large/truncated and used only to confirm this is a broad mid-merge worktree.
