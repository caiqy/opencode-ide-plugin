# Codebase Concerns

**Analysis Date:** 2026-04-12

## Tech Debt

**Pervasive `any` type usage in WebGUI:**

- Issue: 434+ occurrences of `any` across the webgui codebase including `as any` casts, `any` function parameters, and untyped event payloads
- Files: `packages/opencode/webgui/src/lib/api/events.ts` (14 `any` types in `ServerEvent`), `packages/opencode/webgui/src/lib/api/sdkClient.ts` (6 `any` types), `packages/opencode/webgui/src/state/SessionContext.tsx` (numerous `any` casts in event handlers), `packages/opencode/webgui/src/lib/dnd.ts` (heavy `as any` throughout)
- Impact: Type safety is largely absent for server events, SDK interactions, and DOM APIs. Runtime errors from unexpected shapes are not caught at compile time. Makes refactoring risky.
- Fix approach: Define proper TypeScript interfaces for all `ServerEvent` property types in `events.ts`. Replace `as any` casts in `dnd.ts` with declared types for DataTransfer APIs. Gradually type `SessionContext.tsx` event handlers.

**SDK client hand-rolled API wrappers instead of generated SDK:**

- Issue: `packages/opencode/webgui/src/lib/api/sdkClient.ts` (566 lines) manually wraps raw `fetch()` calls for many endpoints (session list, global config, MCP tools, skills, permissions, questions) instead of using the generated `@opencode-ai/sdk`. The file has an explicit TODO: "Remove once SDK is regenerated with Stainless" (line 252).
- Files: `packages/opencode/webgui/src/lib/api/sdkClient.ts`
- Impact: Duplicated API logic, no type safety on responses, brittle to server API changes. Every new endpoint requires manual wiring.
- Fix approach: Regenerate the SDK with `./packages/sdk/js/script/build.ts` to include missing endpoints, then remove manual wrappers.

**Hardcoded Chinese UI strings (no i18n):**

- Issue: 1682+ occurrences of Chinese characters in WebGUI source files. All user-facing text is hardcoded in Chinese directly in component files, with no internationalization framework.
- Files: `packages/opencode/webgui/src/components/parts/ToolPart/utils.tsx` (tool name labels), `packages/opencode/webgui/src/components/settings/` (settings UI), `packages/opencode/webgui/src/state/SessionContext.tsx` (messages), virtually all component files
- Impact: The UI is Chinese-only. Adding any other language requires touching hundreds of files. Test assertions also use Chinese strings.
- Fix approach: Introduce an i18n library (e.g., react-i18next), extract strings into locale files, and replace inline text with i18n keys.

**Silent error swallowing (`catch {}`):**

- Issue: 36+ instances of empty catch blocks across the codebase (19 in webgui, 17 in vscode-plugin)
- Files: `packages/opencode/webgui/src/lib/dnd.ts` (14 instances), `packages/opencode/webgui/src/lib/keyboardHandler.ts` (9 instances), `hosts/vscode-plugin/src/ui/WebviewManager.ts`, `hosts/vscode-plugin/src/ui/ActivityBarProvider.ts`, `hosts/vscode-plugin/src/ui/WebviewController.ts`
- Impact: Errors are silently swallowed, making debugging extremely difficult. Real failures in drag-and-drop, keyboard handling, and webview lifecycle are invisible.
- Fix approach: At minimum log to console in catch blocks. In vscode-plugin, use `logger.appendLine()`. In webgui, use `console.warn()`.

**Excessive console.log in production code:**

- Issue: 109+ `console.log`/`console.warn`/`console.error` calls scattered across webgui source
- Files: `packages/opencode/webgui/src/state/SessionContext.tsx` (~40 calls), `packages/opencode/webgui/src/state/MessagesContext.tsx` (~15 calls), `packages/opencode/webgui/src/lib/api/events.ts`, `packages/opencode/webgui/src/App.tsx`
- Impact: Noisy browser console in production, potential information leakage, no way to control log levels
- Fix approach: Introduce a lightweight logger utility with configurable log levels. Replace raw console calls with logger calls that can be silenced in production builds.

**Upstream TODOs in core opencode package:**

- Issue: 24+ TODO comments in `packages/opencode/src/` indicating incomplete or hacky implementations
- Files: `packages/opencode/src/provider/provider.ts` (lines 348, 566 - direct process.env usage workaround), `packages/opencode/src/session/llm.ts` (line 268 - urgent compatibility verification needed), `packages/opencode/src/session/prompt.ts` (lines 361, 1940), `packages/opencode/src/plugin/copilot.ts` (lines 44-45 - "hacky-ness"), `packages/opencode/src/sync/index.ts` (line 162 - empty TODO)
- Impact: These represent known shortcuts and incomplete implementations in the upstream code. They won't break during normal use but may cause subtle bugs.
- Fix approach: These are upstream concerns. Track which TODOs are in files you've modified vs. pure upstream. Avoid touching upstream TODOs unless they directly affect plugin functionality.

## Risk Areas

**Dual package manager / workspace isolation:**

- Issue: Root monorepo uses `bun` (1.3.11) with bun workspaces, but `hosts/vscode-plugin` uses `pnpm` (9.0.0) with its own `pnpm-lock.yaml` and separate `package-lock.json`. WebGUI is a bun workspace member but has different TypeScript (5.9.3) than root (5.8.2). VSCode plugin uses TypeScript 5.0.0.
- Files: Root `package.json` (bun workspaces), `hosts/vscode-plugin/package.json` (pnpm), `packages/opencode/webgui/package.json`
- Impact: Dependency resolution inconsistencies between the two package managers. Lock file drift. Different TypeScript versions may surface type incompatibilities. CI/CD must handle both package managers correctly.
- Fix approach: Document the dual-package-manager setup clearly. Consider migrating vscode-plugin to the bun workspace or standardizing on one package manager.

**Backend process lifecycle management:**

- Issue: `BackendLauncher` spawns a child process for the opencode backend with a 300-second (5 minute) timeout for connection info parsing. If the process hangs, stalls, or exits unexpectedly, the extension is stuck in a loading state for up to 5 minutes.
- Files: `hosts/vscode-plugin/src/backend/BackendLauncher.ts` (line 333 - 300000ms timeout)
- Impact: Users may perceive the extension as frozen if backend startup is slow or fails silently. The forceNew option spawns additional processes without tracking them in `currentProcess`, so they can leak.
- Fix approach: Reduce timeout, add progress updates during wait, track all spawned processes for proper cleanup.

**VSCode webview Service Worker InvalidState bug workaround:**

- Issue: Both `WebviewManager` and `WebviewController` implement retry loops with 30-second deadlines to work around a known Chromium/VSCode bug (microsoft/vscode#125993) where Service Worker registration fails during rapid webview dispose/recreate cycles.
- Files: `hosts/vscode-plugin/src/ui/WebviewManager.ts` (lines 28-30, 159-226), `hosts/vscode-plugin/src/ui/WebviewController.ts` (lines 71-106)
- Impact: Duplicate retry logic in two places. The 30-second retry loop means users may wait up to 30 seconds when switching projects rapidly. If upstream fixes the bug, this code becomes dead weight.
- Fix approach: Consolidate retry logic into a single utility. Add feature flag to disable retry when upstream fix is confirmed.

**IdeBridgeServer CORS wildcard:**

- Issue: The HTTP server handling IDE bridge communication sets `Access-Control-Allow-Origin: *`
- Files: `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts` (line 148)
- Impact: Any page running on the same machine could make requests to the bridge server. The token-based auth mitigates this somewhat, but the token is passed as a URL parameter visible in browser history and logs.
- Fix approach: Restrict CORS origin to the specific webview origin. Consider using headers instead of URL params for the token.

**Patched dependencies:**

- Issue: 4 upstream dependencies are running with local patches that may break during upgrades
- Files: `patches/@ai-sdk%2Fanthropic@3.0.64.patch`, `patches/@ai-sdk%2Fprovider-utils@4.0.21.patch`, `patches/@standard-community%2Fstandard-openapi@0.2.9.patch`, `patches/solid-js@1.9.10.patch`
- Impact: Any dependency upgrade must verify patches still apply. Patches may mask bugs that the upstream has since fixed differently. The `@solidjs/start` dependency uses a direct PR URL (`https://pkg.pr.new/@solidjs/start@dfb2020`) which is ephemeral.
- Fix approach: Track upstream issues for each patch. Test patch applicability as part of dependency update process. Replace PR URL dependency with a release version when available.

## Complexity Hotspots

**SessionContext.tsx (1,209 lines):**

- Files: `packages/opencode/webgui/src/state/SessionContext.tsx`
- Why complex: Single file manages all session state including creation, deletion, forking, reverting, retrying, model/agent preferences, idle tracking, reasoning state, SSE event handling, and diff loading. Contains 5+ event handler registrations, complex preference loading/saving logic, and race condition guards.
- Safe modification: Changes to session state logic have cascading effects on the entire UI. Always verify event handler cleanup. Test with rapid session switching.

**MessagesContext.tsx (1,130 lines):**

- Files: `packages/opencode/webgui/src/state/MessagesContext.tsx`
- Why complex: Manages message pagination, SSE streaming updates, part updates/deltas, permission handling, question handling, tool call tracking, and selection restore. Pagination logic with cursor-based loading across multiple sessions.
- Safe modification: Message ordering and deduplication logic is fragile. Test pagination boundary conditions carefully.

**ErrorHandler.ts (1,043 lines):**

- Files: `hosts/vscode-plugin/src/utils/ErrorHandler.ts`
- Why complex: God-class pattern. Handles all error types, generates recovery options, manages error history, shows user notifications, sets up global error handlers, validates settings, resets extension state, and generates diagnostic reports. Has singleton pattern with test mode detection.
- Safe modification: Adding a new error category requires changes in 4+ methods. The auto-recovery feature can trigger recursive error handling. The global `unhandledRejection`/`uncaughtException` handlers affect the entire VS Code extension host.

**sdkClient.ts (566 lines):**

- Files: `packages/opencode/webgui/src/lib/api/sdkClient.ts`
- Why complex: Manually wraps 15+ API endpoints with ad-hoc error handling. Mixes generated SDK methods with hand-rolled fetch calls. OAuth state management via module-level Map. Complex message retry logic that reconstructs message history.
- Safe modification: Any server API change requires updating this file. The retry logic (lines 264-329) is particularly fragile as it reconstructs message history and re-prompts.

**CommunicationBridge.ts (656 lines):**

- Files: `hosts/vscode-plugin/src/ui/CommunicationBridge.ts`
- Why complex: Implements VSCode-to-WebUI messaging protocol including file operations, path insertion, drag-and-drop forwarding, settings synchronization, and bridge session routing. Combines functionality from 5 separate JetBrains classes.
- Safe modification: Message types must stay in sync between CommunicationBridge and the WebGUI ideBridge client. Changes to the message protocol require updates in both places.

## Missing Features / Gaps

**No automated end-to-end test pipeline:**

- Issue: WebGUI has unit tests via vitest, and vscode-plugin has mocha tests, but there's no automated E2E testing that verifies the full flow: VSCode extension -> backend launch -> webview load -> IDE bridge communication. The file `hosts/vscode-plugin/src/test/suite/endToEndIntegration.test.ts` exists but relies on mocks.
- Impact: Integration bugs between the three components (extension, backend, webview) are only caught manually. Regressions in the IDE bridge protocol go undetected.

**No Windows-native build support:**

- Issue: Build scripts are Unix shell scripts (`.sh`). While `.bat` equivalents exist, they may not be maintained in sync. The `build_vscode.sh` script uses bash-specific features (`shopt`, `set -e`, process substitution).
- Files: `hosts/scripts/build_vscode.sh`, `hosts/scripts/build_vscode.bat`, `hosts/scripts/build_opencode.sh`, `hosts/scripts/build_opencode.bat`
- Impact: Windows developers may have difficulty building the extension without WSL/Git Bash.

**No error recovery for bridge disconnection:**

- Issue: If the IdeBridge SSE connection drops (e.g., backend restart), the webview continues to function but commands like `openFile`, `addToContext` silently fail. The `ideBridge.ts` has reconnect logic but no mechanism to notify the user or retry failed commands after reconnection.
- Files: `packages/opencode/webgui/src/lib/ideBridge.ts` (reconnect logic), `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`
- Impact: Users lose IDE integration features without visible feedback. Files dropped on the webview are silently lost during disconnection.

**Windows arm64 binary not built:**

- Issue: The build script produces binaries for windows/amd64, macos/amd64, macos/arm64, linux/amd64, linux/arm64, but not windows/arm64. The `ResourceExtractor.ts` maps `arm64` architecture but may fail to find a binary on Windows ARM devices.
- Files: `hosts/scripts/build_opencode.sh` (binary matrix), `hosts/vscode-plugin/src/backend/ResourceExtractor.ts`
- Impact: Extension won't work natively on Windows ARM (Surface Pro X, Snapdragon laptops) without x64 emulation.

## Upstream Sync Concerns

**Divergent UI framework:**

- Issue: Upstream opencode uses SolidJS for its web UI (`packages/opencode/src/cli/cmd/tui/` and `packages/app/`), while the IDE plugin's WebGUI uses React. The WebGUI is a new parallel implementation, not a fork of the upstream web UI.
- Files: Root `package.json` (SolidJS in catalog), `packages/opencode/webgui/package.json` (React dependencies)
- Impact: Features added to the upstream SolidJS UI must be manually reimplemented in React for the WebGUI. Two codebases to maintain for the same conceptual UI. API changes in the upstream server require updates in both UIs.

**Upstream API evolution:**

- Issue: The WebGUI depends on `@opencode-ai/sdk` (workspace reference) which is generated from the upstream server API. When upstream adds/changes API endpoints, the SDK must be regenerated and the manual wrappers in `sdkClient.ts` must be updated.
- Files: `packages/opencode/webgui/src/lib/api/sdkClient.ts`, `packages/sdk/js/` (SDK package)
- Impact: Every upstream API change is a two-step process: regenerate SDK, then update manual wrappers. Missing endpoints in the generated SDK led to the current tech debt of manual fetch wrappers.

**Upstream dependency patches:**

- Issue: The project patches 4 upstream dependencies including `@ai-sdk/anthropic`, `@ai-sdk/provider-utils`, `solid-js`, and `@standard-community/standard-openapi`. These patches must be re-evaluated with every dependency update.
- Files: `patches/` directory, root `package.json` `patchedDependencies` field
- Impact: Upstream dependency updates may conflict with patches. The patches may become unnecessary or need modification.

**Upstream config/schema changes:**

- Issue: The WebGUI settings system reads/writes opencode configuration (models, providers, agents) via the server API. Changes to the upstream config schema (`packages/opencode/src/config/config.ts`) can break the WebGUI settings panels without any compile-time errors due to the `any` typing.
- Files: `packages/opencode/webgui/src/components/settings/`, `packages/opencode/webgui/src/lib/api/sdkClient.ts`

## Security Considerations

**CSP with `unsafe-inline` and `unsafe-eval`:**

- Risk: The VSCode webview Content Security Policy allows `'unsafe-inline'` for scripts and styles, and `'unsafe-eval'` for scripts. This weakens XSS protection.
- Files: `hosts/vscode-plugin/resources/webview/index.html` (line 8), `hosts/vscode-plugin/src/ui/WebviewManager.ts` (lines 123-124)
- Current mitigation: The webview loads content from localhost only. Token-based authentication on the IdeBridge server.
- Recommendations: Investigate whether `unsafe-eval` can be removed by configuring Vite to avoid eval-based source maps. Use nonce-based CSP for inline scripts instead of `unsafe-inline`.

**Token in URL parameters:**

- Risk: IdeBridge authentication token is passed as a URL query parameter (`?token=...`), which may be logged by proxies, appear in browser history, and is visible in DevTools network tab.
- Files: `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts` (line 169 - reads from query), `packages/opencode/webgui/src/lib/ideBridge.ts` (line 25 - reads from URL params, line 195 - sends in URL)
- Current mitigation: Server binds to 127.0.0.1 only, reducing network exposure. Token is per-session and random.
- Recommendations: Move token to request headers (Authorization header) instead of URL parameters.

**ensureAndOpenFile creates files from webview requests:**

- Risk: The IdeBridge `ensureAndOpenFile` handler creates files on disk (including creating parent directories) based on paths received from the webview. A compromised webview could write files to arbitrary locations.
- Files: `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts` (lines 290-316)
- Current mitigation: Token-based authentication. Path expansion only handles `~` prefix.
- Recommendations: Validate paths are within the workspace directory. Add path traversal protection (reject `..` components).

## Performance Considerations

**Large context state re-renders:**

- Problem: `SessionContext` (1,209 lines) and `MessagesContext` (1,130 lines) are React context providers that trigger re-renders across the entire component tree when any state changes. With many messages in a session, every incoming SSE event triggers state updates.
- Files: `packages/opencode/webgui/src/state/SessionContext.tsx`, `packages/opencode/webgui/src/state/MessagesContext.tsx`
- Cause: Single large context with many consumers. No memoization granularity between different state slices.
- Improvement path: Split contexts into smaller, focused providers (session metadata vs. session list vs. idle state). Use `useMemo`/`useCallback` more aggressively. Consider a state management library like Zustand for fine-grained subscriptions.

**SSE reconnect with infinite retry:**

- Problem: The SSE event stream reconnects with exponential backoff up to 30 seconds, with `maxAttempts: Infinity`. If the backend is down, the client will keep reconnecting forever, consuming resources.
- Files: `packages/opencode/webgui/src/lib/api/events.ts` (line 138 - `maxAttempts: Infinity`)
- Cause: No circuit breaker pattern. Infinite retry was designed for resilience but has no upper bound.
- Improvement path: Add a maximum retry count or total retry duration. Show a "connection lost" banner after N failures. Provide a manual reconnect button.

**Binary extraction on every extension host start:**

- Problem: `ResourceExtractor` deletes and re-copies the opencode binary from the extension bundle to a temp directory on every extension host process start (line 49: "Wipe the previous directory so a stale binary is never reused").
- Files: `hosts/vscode-plugin/src/backend/ResourceExtractor.ts` (lines 46-52)
- Cause: Defensive approach to ensure the latest binary is always used after extension updates.
- Improvement path: Use a version check (compare hash or version string) before re-extracting. Skip extraction if the existing binary matches.

---

_Concerns audit: 2026-04-12_
