# WebGUI merge 审计

## 背景

本审计面向 merge commit `e647ea761`，该提交是在隔离 worktree 中把 `opencode/dev` 合并进来。目标不是罗列所有改动，而是只确认“当前插件 WebGUI 运行链路里，已经被代码证实会受影响”的部分。

---

## 目标

1. 判断这次 merge 是否对当前插件 WebGUI 产生实际影响。
2. 把直接影响、明确排除项、未来风险分开，避免把 `packages/app` 的变化误判为插件影响。
3. 给出后续处理顺序，优先覆盖用户可见行为和 Gemini 兼容边界。

---

## 非目标

1. 不把未接入链路上的改动，提前认定为当前插件回归。
2. 不把 `packages/app`、v2 SDK 生成代码、workspace 路由演进，直接当作当前插件 WebGUI 已受影响的证据。
3. 不在本文内提交修复代码或执行 git 提交。

---

## 关键架构结论

当前插件实际加载的不是 `packages/app`，而是 `packages/opencode/webgui` 构建后经 `/app` 提供的 embedded WebGUI。`packages/app` 的会话、导航、composer 改动，不能直接作为插件 WebGUI 已受影响的证据。

关键证据：

- VSCode 宿主在拿到后端地址后，把 UI 基址固定成 `${baseUrl}/app`，见 `hosts/vscode-plugin/src/backend/BackendLauncher.ts:334-347`。
- VSCode Webview 最终加载的 iframe 也是 `connection.uiBase`，见 `hosts/vscode-plugin/src/ui/WebviewController.ts:176-188`。
- JetBrains 宿主同样把地址拼成 `$baseUrl/app` 并直接加载，见 `hosts/jetbrains-plugin/src/main/kotlin/paviko/opencode/ui/ChatToolWindowFactory.kt:167-180,207-220`。
- 后端 `/app` 与 `/app/*` 路由调用 `serveWebGuiPath` 返回静态资源，见 `packages/opencode/src/server/server.ts:562-571`。
- `serveWebGuiPath` 读取的是 `embeddedWebGui`，不是 `packages/app` 产物，见 `packages/opencode/src/webgui/server/app.ts:1-3,46-49`。
- WebGUI 构建基址固定为 `/app`，输出到 `webgui-dist`，见 `packages/opencode/webgui/vite.config.ts:9-14`。
- 构建脚本会把 `webgui-dist` 编进 `src/webgui/embed.generated.ts`，见 `packages/opencode/script/build.ts:22-25,45-61`。

---

## 已证实的当前影响

### P1：会话执行链的 overflow / auto-compaction / error handling 语义变化

这次 merge 里，真正落在当前插件 WebGUI 运行链上的，是 `packages/opencode` 内部会话执行与错误语义的变化。当前 embedded WebGUI 通过 `@opencode-ai/sdk/client` 直接调用同源后端，且真实使用了 `session.prompt`、`session.command`、`session.summarize`，见 `packages/opencode/webgui/src/lib/api/sdkClient.ts:6-11` 与 `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts:84-145,224-281`。

用户可见影响已经能从前后链路闭合出来：

- 前端发送超长上下文、大附件或边缘 prompt/command 请求时，会进入当前会话 API 链路，见 `packages/opencode/webgui/src/state/SessionContext.tsx:889-956` 与 `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts:84-170`。
- 后端把 provider 错误重新归类为 `ContextOverflowError` 或更具体的 `APIError`，见 `packages/opencode/src/provider/error.ts:8-23,80-92,179-200` 与 `packages/opencode/src/session/message-v2.ts:827-883`。
- 会话处理器在 token/usage 条件下会标记 `needsCompaction`，并在异常分支走新的错误/重试/停止语义，见 `packages/opencode/src/session/processor.ts:285-294,365-430`。
- 前端已经对 `session.compacted` 做了提示，对发送失败做了 toast，对 `session.idle` 做了状态切换，见 `packages/opencode/webgui/src/App.tsx:399-421` 与 `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts:153-170`。

因此，当前插件 WebGUI 已被代码证实会受影响的范围，是：

1. 超长上下文触发的 `context overflow` 归类与提示语义。
2. 自动 compaction 触发时机与前端可见提示。
3. `summarize`、`command`、`prompt` 在大输入和 provider 边缘错误下的失败表现、重试边界与 idle 恢复行为。

建议解决方案：

1. 先为当前插件 WebGUI 补一组面向大上下文/大附件/`summarize`/`command` 的回归用例，锁定 merge 后的真实可见行为。
2. 如果你希望保持当前插件旧体验，就在前端错误展示层或后端错误归类层做一层兼容适配，不要直接假设上游新语义等于你当前产品语义。
3. 把这类场景当成当前 merge 的最高优先级人工回归面，优先确认是否存在“提示变了但用户无法理解”“自动 compact 后状态切换异常”“idle 恢复时机变动”这三类回归。

### P2：Gemini 的 tool / MCP schema 兼容边界变化

第二个已证实影响点，是 Google/Gemini 下 tool 与 MCP schema 变换语义的变化。当前插件 WebGUI 允许用户从 embedded WebGUI 里选择 provider/model，并经 `session.prompt` 或 `session.command` 进入 provider 执行链，见 `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts:84-145`。

后端当前会把内建 tools 与 MCP tools 的 schema 都经过 `ProviderTransform.schema(...)`，见 `packages/opencode/src/session/prompt.ts:791-843`。而 `ProviderTransform.schema` 对 `google` / `gemini` 明确做了 enum 转字符串、required 过滤、array/items 修正、非 object 类型移除 `properties/required` 等兼容处理，见 `packages/opencode/src/provider/transform.ts:898-977`。

这意味着，只要当前插件 WebGUI 通过 `session.prompt` / `session.command` 命中 Gemini provider，这次 merge 中 schema 变换语义的变化就会直接落到运行时兼容边界上。实际风险不在 `packages/app`，而在当前 embedded WebGUI 触发的 provider 请求是否还能被 Gemini 接受。

建议解决方案：

1. 把 Gemini 作为独立回归矩阵，至少覆盖一个内建 tool 场景和一个 MCP tool 场景。
2. 如果你当前插件已有依赖 Gemini 的稳定工具流，优先补 provider-transform 兼容测试，再决定是否需要在 schema 生成层增加向后兼容分支。
3. 只有在实际回归中确认 Gemini tool/MCP 失败时，才对 `ProviderTransform.schema` 做定向适配；不要提前扩大改动面。

---

## 明确排除项

以下项不应计入“当前插件 WebGUI 已受影响”：

1. `hosts/jetbrains-plugin` 未出现在本次 merge 的改动清单里，不构成宿主侧新增影响证据。
2. `hosts/vscode-plugin` 未出现在本次 merge 的改动清单里，不构成宿主侧新增影响证据。
3. `packages/opencode/webgui` 未出现在本次 merge 的改动清单里，不构成 embedded WebGUI 前端代码直接变化。
4. `packages/app` 的会话、导航、composer 改动不应算作插件 WebGUI 直接影响，因为插件加载的是 `/app` 下的 embedded WebGUI，而不是 `packages/app`。
5. v2 SDK 生成代码变化不等于当前插件运行链路变化；当前 WebGUI 仍显式依赖 `@opencode-ai/sdk/client`，见 `packages/opencode/webgui/src/lib/api/sdkClient.ts:6-11`。

说明：以上第 1-3 项可由 merge commit `e647ea761` 的改动清单反证，本次真正变化集中在 `packages/opencode/src/**`、`packages/app/**`、`packages/sdk/js/**` 等路径，而非当前插件宿主与 embedded WebGUI 本体。

---

## 未来风险

这些不是当前已落地影响，只在后续接入后才成立：

1. workspace query/header 接入后，`session`/`workspace` 路由语义才会真正进入插件链路。相关能力已出现在 merge 中的 `packages/opencode/src/control-plane/workspace-router-middleware.ts:17-18,39-49` 与 `packages/opencode/src/server/routes/workspace.ts`，但当前 embedded WebGUI 既未传 workspace 头，也未在 `sdkClient` 中切到这套路由语义。
2. 若未来把插件 WebGUI 从 `@opencode-ai/sdk/client` 迁到 v2 client，需要重新审计协议面。当前 v2 生成代码已存在于 `packages/sdk/js/src/v2/gen/sdk.gen.ts`、`packages/sdk/js/src/v2/gen/types.gen.ts` 等路径，但这不等于当前插件已切换运行链。

---

## 建议拆解顺序

1. 先验证会话执行链：超长上下文、大附件、`session.summarize`、斜杠命令、普通 prompt。
2. 再验证 Gemini：至少覆盖 `session.prompt`、`session.command`、一个内建 tool、一个 MCP tool。
3. 最后补未来项跟踪：为 workspace 接入与 v2 client 迁移各留一个重新审计入口，不提前修不存在的问题。

---

## 验收标准

1. 文档只保留两类已证实当前影响：会话执行链语义变化、Gemini schema 兼容边界变化。
2. 文档明确写出并用代码证据支撑：插件加载的是 `packages/opencode/webgui` 通过 `/app` 提供的 embedded WebGUI，而不是 `packages/app`。
3. 文档明确排除宿主未改、`packages/opencode/webgui` 未改、`packages/app` 不能直接作证、v2 SDK 生成代码不等于当前运行链变化。
4. 文档把 workspace 路由与 v2 client 仅归入未来风险，不误报为当前插件已受影响。
