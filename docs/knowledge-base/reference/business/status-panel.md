# 能力：状态面板与运行时开关

> **象限**：Reference（能力参考）
> **能力编号**：D1、D2、D3、D4（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：D1-D4 **新增**（基线 `overview.md` 无状态面板行）

## 代码真源

| 角色 | 文件 |
|------|------|
| 状态面板 UI | `packages/opencode/webgui/src/components/CompactHeader/StatusPopover.tsx` |
| 状态聚合 hook | `packages/opencode/webgui/src/components/CompactHeader/useStatusPopoverData.ts` |
| SDK/兼容 API | `packages/opencode/webgui/src/lib/api/sdkClient.ts` |
| SSE 连接状态 | `packages/opencode/webgui/src/lib/api/events.ts` |
| IDE bridge 状态 | `packages/opencode/webgui/src/lib/ideBridge.ts` |
| MCP 后端服务 | `packages/opencode/src/mcp/index.ts` |
| Skills 后端服务 | `packages/opencode/src/skill/index.ts` |
| Permission 判定 | `packages/opencode/src/permission/index.ts` |
| Skill tool 权限 overlay | `packages/opencode/src/session/tool-permission.ts`、`session/tools.ts` |

## 意图

把 IDE WebGUI 的运行状态集中到 Header 状态面板：Server/SSE/IDE bridge/路径用于排障，MCP 与 Skills 可即时启停，LSP/Plugins 提供可观测入口。

## 行为契约

- 状态面板有 `servers/mcp/lsp/plugins/skills` 五个 tab，打开时重置到默认 tab 并清空展开状态（`StatusPopover.tsx` 第 35-59 行）。
- tab 支持左右方向键切换，打开后默认聚焦第一个 tab（`StatusPopover.tsx` 第 61-75 行、第 108-114 行）。
- Server tab 展示 SSE 连接、后端地址、IDE bridge ready 状态、当前路径；数据来自 `useStatusPopoverData` 聚合后的 `servers.summary`（`StatusPopover.tsx` 第 124-136 行）。
- `StateBox` 统一显示 failed/stale/empty 三类数据状态，failed 可提供重试按钮（`StatusPopover.tsx` 第 287-309 行）。
- 后端地址优先取 Vite 注入的 `__OPENCODE_BACKEND_URL__`，否则浏览器取 `window.location.origin`，SSR fallback 为 `http://localhost:4096`（`useStatusPopoverData.ts` 第 118-142 行）。
- IDE bridge 的 installed/ready/customApi/restartMode 来自 URL 参数与 bridge SSE 连接状态（`ideBridge.ts` 第 22-31 行、第 46-93 行）。
- IDE bridge 断线会 reject pending request 并指数退避重连，状态面板只读取 ready/install 结果（`ideBridge.ts` 第 104-147 行）。
- 打开面板或 SSE connectionState 变化会触发 `refreshAll()`；Server/MCP/LSP 首批并发，Plugins/Skills 后续独立提交（`useStatusPopoverData.ts` 第 347-467 行、第 469-483 行）。
- 失败刷新如果已有旧数据，会把旧数据标为 stale，而不是直接清空（`useStatusPopoverData.ts` 第 144-147 行）。
- MCP tab 展示 server 状态、reason、tool 列表；server/tool 开关都有 busy 锁，toggle 后刷新 MCP 状态（`StatusPopover.tsx` 第 139-221 行；`useStatusPopoverData.ts` 第 288-344 行）。
- 前端 MCP API 走 `/mcp/:name/tools`、`PATCH /mcp/:name/enabled`、`PATCH /mcp/:name/tools/:toolId` 兼容封装（`sdkClient.ts` 第 275-356 行、第 448-459 行）。
- 后端 `MCP.setEnabled` 写 `mcp.<name>.enabled`，disable 会断开 client，enable 会重连并发布 tools changed；`MCP.setToolEnabled` 写 project `tools.<toolID>` 并设置 runtime tools overlay（`mcp/index.ts` 第 666-684 行）。
- MCP `toolsByServer` 只在 server connected 时返回工具，并用 `cfg.tools?.[id] !== false` 计算 enabled（`mcp/index.ts` 第 721-738 行）。
- Skills tab 从 `GET /skill` 读取 effective `enabled`，前端不自行解释 wildcard 或平台大小写规则（`useStatusPopoverData.ts` 第 230-244 行；`sdkClient.ts` 第 597-637 行）。
- `toggleSkill` 有 per-skill busy lock，写完后只刷新 Skills 数据（`useStatusPopoverData.ts` 第 485-519 行）。
- `PATCH /skill/:name/enabled` 后端先确认 skill 存在，把 string shorthand `permission.skill` 转成 `skill.*` fallback，再写 `permission.skill.<name>`，并设置 runtime skill permission overlay（`handlers/instance.ts` 第 87-117 行）。
- Skill overlay 合并进 config 时会压过 persisted config；shorthand skill rule 会被保留为 wildcard fallback（`config/config.ts` 第 65-90 行、第 108-117 行）。
- `Skill.available()` 使用 `Permission.evaluate("skill", name, agent.permission, overlayRules)` 过滤可用 skill（`skill/index.ts` 第 289-299 行）。
- `GET /skill` 返回的 `enabled` 由后端 permission ruleset 计算，不是前端本地缓存（`handlers/instance.ts` 第 87-93 行）。
- 系统 prompt 生成 skills 段时读取 runtime overlay；overlay 中存在 allow 时，即使 agent permission 禁用 skill 也允许继续计算列表（`session/system.ts` 第 65-79 行）。
- 工具权限请求通过 `buildToolPermissionAsk` 接收 `overlayRuleset`，`Permission.ask` 的评估顺序是 approved、当前 ruleset、overrideRuleset，后者优先级最高（`session/tools.ts` 第 67-81 行；`tool-permission.ts` 第 6-24 行；`permission/index.ts` 第 166-183 行）。
- LSP tab 读取 `sdk.lsp.status()`，Plugins tab 读取 config 里的 `plugin` 数组；这两项当前是可观测性入口，不提供编辑动作（`useStatusPopoverData.ts` 第 352-417 行、第 420-448 行；`StatusPopover.tsx` 第 224-246 行）。
- Plugins 为空时显示 empty 状态，不把空数组当失败（`useStatusPopoverData.ts` 第 442-445 行）。

## 边界与约束

- 状态面板不是各能力的唯一真源：它消费 SSE、SDK、IDE bridge、config、MCP、Skill、LSP 等多个来源。
- Skill toggle 不调用 Instance dispose；即时生效依赖 runtime overlay 进入 Skill.available、SystemPrompt.skills 和 tool permission ask。
- Skills 刷新有独立 `sseq`，toggle 后只让旧 Skills 请求失效，不取消并发 refreshAll 中 Server/MCP/LSP/Plugins 的提交（`useStatusPopoverData.ts` 第 168-170 行、第 450-464 行、第 485-519 行）。
- `needs_auth` 与 `needs_client_registration` 状态下 MCP server 开关禁用，避免 UI 发起无效 toggle（`useStatusPopoverData.ts` 第 321-325 行）。

## 运行时待核验

- [ ] MCP server/tool 开关在真实 MCP server 断连、重连、needs_auth 状态下的 UI 状态与后端状态一致性（`待运行时核验`：需要真实 MCP 配置）。
- [ ] Skill toggle 后下一次 agent prompt/tool permission 是否立即按 overlay 生效且未 dispose Instance（`待运行时核验`：需要真实会话验证）。
- [ ] LSP 与 Plugins 在多项目/无插件配置下的 empty/stale/failed 展示是否符合预期（`待运行时核验`：需要多运行态样本）。

## 相关

- 子任务抽屉：[subtask-drawer](subtask-drawer.md)
- 上游兼容边界：[upstream-compatibility](upstream-compatibility.md)
