# 上游适配边界与同步风险

本项目持续跟进上游 opencode，因此需要明确哪些改动不是普通 WebGUI 代码，而是为了 IDE 插件可用而对 opencode 底层做的下游适配。同步上游时必须保留这些适配点。

## 不展开的上游能力

以下能力属于 opencode 底层依赖，不在 RepoWiki 中逐条梳理：

- 会话创建、消息存储、Agent 执行。
- Provider SDK 内部实现。
- Bus/SSE 事件系统整体设计。
- MCP 客户端连接细节。
- Permission 判定算法。
- Effect service 组合和实例缓存。

RepoWiki 只记录 WebGUI/IDE 如何消费这些能力，以及本 fork 为插件场景做了哪些适配。

## 必须保留的下游适配

### `/app` 本地 WebGUI 挂载

关键文件：

- `packages/opencode/src/webgui/server/app.ts`
- `packages/opencode/src/webgui/embed.generated.ts`
- `packages/opencode/src/server/server.ts`

风险：上游 server 路由重构时，容易丢失 `/app` 或改变挂载顺序。每次同步后都要确认 `/app` 在 workspace middleware 之前。

### Config overlay / patch

关键文件：

- `packages/opencode/src/config/config.ts`
- `packages/opencode/src/config/paths.ts`

用途：WebGUI 的 MCP/Skills/工具开关、配置文件打开等依赖项目配置 patch/overlay 语义。

风险：上游 config 加载路径或 schema 改动可能导致 IDE 中开关不生效或配置文件定位错误。

### MCP enable / tool-enable

关键文件：

- `packages/opencode/src/mcp/index.ts`
- `packages/opencode/src/server/routes/mcp.ts`
- `packages/opencode/webgui/src/lib/api/sdkClient.ts`

用途：状态面板支持 MCP server 和 tool 级启停。

风险：上游 MCP 路由或工具列表结构变化会影响 WebGUI 状态面板和下次请求的工具过滤。

### Skill permission overlay

关键文件：

- `packages/opencode/src/config/config.ts`
- `packages/opencode/src/permission/index.ts`
- `packages/opencode/src/server/routes/instance/index.ts`
- `packages/opencode/src/server/routes/instance/httpapi/instance.ts`
- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/session/system.ts`
- `packages/opencode/src/skill/index.ts`
- `packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.ts`

用途：WebGUI 可展示和切换 Skills。主 Hono 路由和 experimental HttpApi 都必须让 `GET /skill` 返回由后端权限系统计算的 effective `enabled`，前端只消费这个结果；`PATCH /skill/:name/enabled` 负责持久化 `permission.skill` 并设置同实例 runtime overlay。runtime overlay 还需要进入 `Skill.available()`、`SystemPrompt.skills()` 和 tool permission ask，确保禁用/启用在不触发 `Instance.dispose()` 的情况下立即影响下次 agent 行为。`Permission.ask()` 的顺序必须让当前 config deny 压过历史 persisted approval，并让 runtime overlay 压过二者，避免 UI 显示禁用但 skill tool 仍因旧 “always allow” 执行。修改此契约后必须同步 `packages/sdk/openapi.json` 和 v2 `packages/sdk/js/src/v2/gen/**`；legacy `packages/sdk/js/src/gen/**` 仍服务旧客户端形状，除非单独做 SDK 迁移，否则不要在功能修复中重生成以免破坏现有 WebGUI/插件调用方式。

风险：上游 skill 发现、config merge 或 permission 语义变化时，前端开关可能显示成功但实际不生效。同步时尤其要保留 shorthand `permission.skill: "deny"` 转 `{ "*": "deny" }` fallback、overlay 优先级高于 cached/live permission 的顺序，以及 WebGUI 不复刻 wildcard/平台大小写规则的边界。

### Provider / Anthropic SSE 兼容补丁

关键文件：

- `packages/opencode/src/provider/provider.ts`

用途：维持 WebGUI/插件场景下的 provider 兼容性和流式输出稳定。

风险：Provider SDK 升级后 patch 可能失效，表现为消息流中断、工具 part 不完整或错误处理异常。

### Stream timeout auto-retry

关键文件：

- `packages/opencode/src/session/retry.ts`
- `packages/opencode/src/session/status.ts`
- `packages/opencode/webgui/src/components/TypingIndicator.tsx`

用途：部分 provider 会在长流式响应中返回 `stream_timeout`。本 fork 将其作为可重试状态展示，避免一次瞬时流错误直接固化为最终失败。

风险：上游 session status 或 provider error shape 改动时，可能把 retry 状态退化成普通 error，表现为 WebGUI 不再显示重试提示。

### Session prompt 的 IDE 附件处理

关键文件：

- `packages/opencode/src/session/prompt.ts`

用途：IDE 中传入 file/directory、路径 range、LSP symbol 等上下文时，需要服务端正确解析。

当前约定：

- `file://` mention 的固定分流顺序是：目录 → PDF/图片 → 文本文件 → 其他二进制文件。
- 文本文件继续走 `Read`，并保持行号范围语义兼容。
- PDF/图片继续作为 attachment / media 处理。
- 其他二进制只保留路径引用，不自动 `Read`，也不应制造额外 `Session.Error`。

风险：上游 prompt 结构调整可能影响文件/目录 mention、拖拽上下文、范围读取。

### `generate_image` 与 generated image 项目文件

关键文件：

- `packages/opencode/src/tool/generate-image.ts`
- `packages/opencode/src/tool/generate-image/persist.ts`
- `packages/opencode/src/tool/generate-image/input.ts`
- `packages/opencode/src/server/routes/instance/generated-image.ts`
- `packages/opencode/webgui/src/components/parts/ToolPart/ToolImageAttachments.tsx`
- `packages/opencode/webgui/src/components/MarkdownRenderer.tsx`
- `packages/opencode/webgui/src/components/parts/ImageOverlay.tsx`

用途：支持 IDE/WebGUI 内生成图片、保存项目内文件、展示缩略图、点击预览和后续上下文引用。

当前约定：

- 生成图片写入当前项目 `.opencode/generated-images/`，attachment 暴露 `relativePath` 和 generated-image route，不再只依赖 data URL。
- generated-image route 必须校验路径仍在当前项目内，并阻止 symlink/junction 逃逸。
- edit action 接受 project-relative path 或 data URL 图片输入，包括 readonly/frozen array 形式的调用方入参。
- WebGUI Markdown 与 tool attachment 都要使用当前 `directory/worktree` 构造 generated-image URL，避免多项目串图。
- 插件环境保存图片走 IDE bridge `saveImage`，浏览器环境才回退下载。

风险：上游 tool schema、session attachment 或 server route 重构时，容易丢失图片项目内持久化、readonly 输入兼容或 generated-image 专用路由。

### 前台读取优先于后台 diff

关键文件：

- `packages/opencode/src/session/summary-scheduler.ts`
- `packages/opencode/src/server/routes/instance/httpapi/session.ts`
- `packages/opencode/src/server/routes/instance/session.ts`
- `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.ts`
- `packages/opencode/webgui/src/state/useSessionActivation.ts`

用途：保护当前会话首屏读取、历史分页扫描和当前会话 diff 读取，不被后台 summary/diff 抢占。

当前约定：

- `prompt.ts` / `processor.ts` 只负责 `markDirty(...)`，后台 diff 调度由 `SessionSummaryScheduler` 统一处理。
- `SessionPrompt.loop(...)` 运行期间也会显式持有 foreground 保护。
- 前端会避免把当前激活 session 过早纳入 background visible 集合。
- 后端关键读取期间会设置 foreground 保护，foreground 结束后再回到现有 `scheduleDirty + signal` 收口。
- `visibilityReady === false`（首次 `syncVisible` 之前）时，scheduler 默认把所有 session 视为可见；首次 sync 后才切换到真实 visible gating。
- 当 session 在后台 summarize 过程中被隐藏时，scheduler 通过 `guardVersion/canWrite` 丢弃旧结果写回，而不是依赖中断底层计算。

风险：如果上游 session 路由、summary scheduler 或 visibility 语义变化，这条保护链最容易被破坏，表现为切换会话时首屏卡顿、历史扫描被抢占或 diff 状态抖动。

### non-git project identity

关键文件：

- `packages/opencode/src/project/project.ts`
- `packages/opencode/src/project/schema.ts`
- `packages/opencode/test/project/project.test.ts`

用途：IDE 里经常直接打开非 Git 临时目录，这些目录必须按实际目录隔离 project/session/workspace 状态。

当前约定：

- non-git 普通目录使用目录派生 project id，不使用 `ProjectID.global`。
- 同一目录重复打开得到稳定 project id，不同目录得到不同 project id。
- legacy global session 会在运行时迁移到目录派生 project id。

风险：上游 project identity 或 worktree fallback 改动可能把所有 non-git 目录重新合并到 global，导致 tabs、drafts、selection 和 session list 串项目。

### Diff 主线回归测试边界

关键文件：

- `packages/opencode/test/server/httpapi-session.test.ts`
- `packages/opencode/test/session/summary-scheduler.test.ts`
- `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.test.tsx`
- `packages/opencode/webgui/src/state/useSessionActivation.test.tsx`
- `packages/opencode/webgui/src/state/MessagesContext.pagination.test.tsx`
- `packages/opencode/webgui/src/components/MessageInput/FooterPanels.test.tsx`
- `packages/opencode/webgui/src/components/FileChangesPanel.test.tsx`

用途：本仓库对 diff 主线的测试目标不是追求覆盖率数字，而是锁定高风险需求语义。

维护约束：

- 高风险需求优先保留“直接测试”，不要只依赖间接覆盖或 smoke test。
- 重点关注 foreground 期间后台 diff 不启动、foreground 结束后恢复调度、visible gating、真实历史分页路由保护，以及 `session.diff.status -> UI` 的状态链。
- cleanup 类改动不要混入 diff 主线覆盖结论里。
- 标准 Hono 路由与 experimental HttpApi 路由都要保留相同的 foreground 语义，避免只修一套路由。

## 上游同步检查重点

参考：`docs/upstream-sync-checklist.md`

高风险文件：

- `packages/opencode/src/config/config.ts`
- `packages/opencode/src/mcp/index.ts`
- `packages/opencode/src/provider/provider.ts`
- `packages/opencode/src/server/instance/index.ts`
- `packages/opencode/src/server/server.ts`
- `packages/opencode/src/session/message-v2.ts`
- `packages/opencode/src/session/compaction.ts`
- `packages/opencode/src/skill/index.ts`

同步后最低验证：

- 确认 `/app` 路由仍存在且顺序正确。
- 确认 WebGUI 能打开、SSE 能连接。
- 确认 IDE bridge 参数能注入并连接。
- 确认 scoped storage 可读写。
- 确认 MCP/Skill 开关仍能显示并调用。
- 确认插件内写文件后 IDE 能刷新。
- 确认 `@文件` mention 对文本/PDF/图片/其他二进制的分流仍符合 IDE 场景预期。
- 确认切换当前会话时，首屏消息/历史扫描/当前会话 diff 不会被后台 diff 抢占。
- 确认 `generate_image` 仍能生成项目内图片附件，并能编辑 readonly/frozen image input array。
- 确认 generated-image 路由和 Markdown/tool attachment 预览都带当前实例目录上下文。
- 确认 VSCode `OPENCODE_UI_VERSION` 与 JetBrains `getExtensionVersion` 仍来自宿主真实版本。
- 确认 JetBrains 空 Marketplace 查询结果不会保留旧 cached update。

## 维护原则

- 优先同时保留上游逻辑和插件适配逻辑。
- 需要二选一时，不要直接覆盖；先提出方案让维护者选择。
- 不把上游普通功能复制成 wiki；只记录本 fork 的边界、入口和风险。
