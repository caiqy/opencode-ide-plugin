# Existing Capabilities Overview

**Status**: 基线清单
**Created**: 2026-05-18
**Purpose**: 记录当前功能边界；后续 Spec Kit 工作必须保留这些能力，除非后续 spec 明确要求变更。

## Scope

本文档是轻量基线，不是追溯式实现计划。它记录 OpenCode IDE Plugin 当前行为、受影响客户端和容易退化的区域，供后续 spec、plan、tasks 和评审引用。

覆盖范围：

- opencode core server 适配
- WebGUI React app
- VSCode plugin host
- JetBrains plugin host
- IDE bridge protocol
- build、packaging、update、release 流程

## Capability Map

| Capability                                            | Primary Paths                                                                                                                                                              | Clients                                  | Current Behavior To Preserve                                                                                                            |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Embedded WebGUI serving                               | `packages/opencode/src/server/server.ts`, `packages/opencode/src/webgui/server/app.ts`, `packages/opencode/webgui/`                                                        | opencode core, WebGUI, VSCode, JetBrains | opencode 在 `/app` 提供 React SPA；`/app/*` 支持静态资源和 SPA fallback，并且必须在 workspace routing 拦截前处理。                      |
| Session chat UI                                       | `packages/opencode/webgui/src/App.tsx`, `state/SessionContext.tsx`, `state/MessagesContext.tsx`, `components/MessageInput.tsx`, `components/MessageList.tsx`               | WebGUI, VSCode, JetBrains                | 用户可以创建/切换 session、加载消息、发送 prompt、接收 SSE 更新，并看到 loading/offline/error 状态。                                    |
| Multi-tab and session persistence                     | `state/tabStore.ts`, `state/repo/*Repo.ts`, `state/scopedStorage.ts`, `state/useSessionActivation.ts`                                                                      | WebGUI, VSCode, JetBrains                | 已打开 session、active tab、theme/model/UI preferences、draft 和 scoped storage 在预期导航或 host reload 后按 scope 保留。              |
| IDE bridge protocol                                   | `packages/opencode/webgui/src/lib/ideBridge.ts`, `hosts/vscode-plugin/src/ui/IdeBridgeServer.ts`, `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/IdeBridge.kt` | WebGUI, VSCode, JetBrains                | WebGUI 连接 token-protected local bridge；SSE 接收 host events；POST 发送 host actions；keepalive 避免空闲断连。                        |
| Context insertion from IDE                            | VSCode `commands/*`, JetBrains `actions/*`, WebGUI `MessageInput` bridge handlers                                                                                          | WebGUI, VSCode, JetBrains                | Add file、Add selected lines、Paste path、drag/drop 可把文件路径插入当前 prompt，且不破坏普通文本输入。                                 |
| Backend launch lifecycle                              | VSCode `backend/BackendLauncher.ts`, JetBrains `backendprocess/BackendLauncher.kt`, `TerminalBackendProcess.kt`                                                            | VSCode, JetBrains, opencode core         | 插件为 workspace 启动 `opencode serve`，使用 bundled 或 system binary，支持 custom command fallback，并在 backend ready 后加载 `/app`。 |
| Host webview/browser integration                      | VSCode `ui/ActivityBarProvider.ts`, `ui/WebviewManager.ts`, JetBrains `ChatToolWindowFactory.kt`                                                                           | VSCode, JetBrains, WebGUI                | IDE 在 panel/tool window 内渲染 WebGUI，传入 bridge URL/token，并在 dispose 时清理 session/process。                                    |
| Open file / URL / clipboard / image save host actions | Bridge server handlers in VSCode and JetBrains, WebGUI callers                                                                                                             | WebGUI, VSCode, JetBrains                | WebGUI 可以请求 host 打开文件/URL、写入 clipboard、在支持时保存 generated image，并在不支持时返回清晰错误。                             |
| Version and update gate                               | WebGUI `VersionGate.tsx`, `UpdateContext.tsx`, VSCode `update/*`, JetBrains `update/*`, bridge metadata                                                                    | WebGUI, VSCode, JetBrains                | WebGUI 接收 host version/minimum version metadata，展示 compatibility/update 状态，并在已实现时触发 host-specific update flow。         |
| Generated image route                                 | `packages/opencode/src/server/routes/instance/generated-image`, `/app/generated-image` route                                                                               | opencode core, WebGUI                    | generated image assets 可在 `/app/generated-image` 下访问，并保留 instance context。                                                    |
| VSCode plugin packaging                               | `hosts/scripts/build_vscode.sh`, `hosts/vscode-plugin/package.json`, `memory/context/vscode-packaging.md`                                                                  | VSCode                                   | Windows VSIX packaging 更新 WebGUI 和 extension 版本、构建 backend binary、嵌入 Windows amd64 binary，并验证 VSIX 内容。                |
| JetBrains plugin packaging                            | `hosts/jetbrains-plugin/build.gradle.kts`, `memory/context/gradle.md`, `memory/context/versioning.md`                                                                      | JetBrains                                | Gradle 使用 JDK 21 / IntelliJ Platform 设置构建和测试插件，并遵守 Windows-safe `gradlew.bat` 参数规则。                                 |
| Upstream opencode compatibility                       | `packages/opencode/src/**`, `packages/sdk/js`, `packages/console/**`                                                                                                       | opencode core, TUI, WebGUI, IDE plugins  | upstream opencode 行为和 TUI/client-server routes 保持可用，除非后续 explicit spec 明确变更。                                           |

## Client Boundaries

### opencode Core

- 负责 HTTP routes、session/provider/agent/tool 行为、storage、event bus 和 CLI。
- 在 `/app` 托管 WebGUI，同时不得替换 upstream TUI 或 API 行为。
- 使用 Bun、Hono、Effect、Drizzle，以及本仓库的 Effect 约定。

### WebGUI

- 负责 chat interface、session list、message rendering、command palette、settings、toasts、offline/update banners、subtask drawer、keyboard shortcuts，以及 IDE bridge client 集成。
- 作为 browser SPA 运行，也运行在 IDE webview/JCEF 中。

### VSCode Plugin

- 负责 VSCode activation、activity bar webview、backend binary resolution、`opencode serve` process lifecycle、bridge server、context commands、settings、diagnostics 和 update flow。
- 使用 pnpm 和 VSCode Extension API。

### JetBrains Plugin

- 负责 JetBrains tool window、JCEF browser、terminal-backed backend launch、bridge server、context actions、settings、backend logs、update flow 和 plugin packaging。
- 使用 Kotlin、Gradle Wrapper、JVM 21 和 IntelliJ Platform APIs。

## Existing Spec References

- `specs/v2/session.md` 已记录 V2 方向：移除 dedicated `session.init` compatibility route，改为依赖普通 `/init` command flow。

## Future Spec Kit Use

- 新功能或高风险改动必须创建常规 `spec.md`、`plan.md` 和 `tasks.md`。
- 后续 specs 可引用本基线作为 current behavior 和 no-regression constraints 的来源。
- 如果后续改动有意移除或改变本文列出的能力，future spec 必须明确受影响客户端和 validation evidence。
