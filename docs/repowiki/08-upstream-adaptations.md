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

- `packages/opencode/src/skill/index.ts`
- `packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.ts`

用途：WebGUI 可展示和切换 Skills。

风险：上游 skill 发现或 permission 语义变化时，前端开关可能显示成功但实际不生效。

### Provider / Anthropic SSE 兼容补丁

关键文件：

- `packages/opencode/src/provider/provider.ts`

用途：维持 WebGUI/插件场景下的 provider 兼容性和流式输出稳定。

风险：Provider SDK 升级后 patch 可能失效，表现为消息流中断、工具 part 不完整或错误处理异常。

### Session prompt 的 IDE 附件处理

关键文件：

- `packages/opencode/src/session/prompt.ts`

用途：IDE 中传入 file/directory、路径 range、LSP symbol 等上下文时，需要服务端正确解析。

风险：上游 prompt 结构调整可能影响文件/目录 mention、拖拽上下文、范围读取。

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

## 维护原则

- 优先同时保留上游逻辑和插件适配逻辑。
- 需要二选一时，不要直接覆盖；先提出方案让维护者选择。
- 不把上游普通功能复制成 wiki；只记录本 fork 的边界、入口和风险。
