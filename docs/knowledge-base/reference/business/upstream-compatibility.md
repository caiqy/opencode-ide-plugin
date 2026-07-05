# 能力：上游 opencode 兼容边界

> **象限**：Reference（能力参考）
> **能力编号**：J4（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：基线

## 代码真源

| 角色 | 文件 |
|------|------|
| Config overlay / patch | `packages/opencode/src/config/config.ts` |
| MCP enable / tool-enable | `packages/opencode/src/mcp/index.ts` |
| Provider/SSE 适配 | `packages/opencode/src/provider/provider.ts` |
| `/app` server 挂载 | `packages/opencode/src/server/server.ts` |
| 消息与 compaction | `packages/opencode/src/session/message-v2.ts`、`compaction.ts` |
| Skill / Permission overlay | `packages/opencode/src/skill/index.ts`、`tool-permission.ts` |
| 工具安全边界 | `packages/opencode/src/tool/external-directory.ts` |
| generated image | `packages/opencode/src/session/generated-image.ts` |
| foreground priority | `packages/opencode/src/session/summary-scheduler-foreground.ts` |
| IDE 附件分流 | `packages/opencode/src/session/prompt.ts` |

> 命名交叉核验（Step 5）：J4 是同步风险总览，导航到 [upstream-compatibility](upstream-compatibility.md)，不重复逐文件说明。

## 意图

本 fork 持续跟进上游 opencode，但 IDE/WebGUI 场景有下游适配。本文只记录同步上游时必须保护的边界和最低核验项。

## 不展开的上游能力

- 会话存储、Provider SDK、Bus/SSE、MCP 客户端、Permission 判定、Effect service 是上游底层能力；本知识库只记录本 fork 如何消费或适配它们。
- 上游普通功能不要复制成 business reference；只有影响 IDE 插件可用性的下游差异才进入本目录。

## 必须保留的下游适配点

- `/app` 本地 WebGUI 挂载：见 [embedded-webgui-serving](embedded-webgui-serving.md)。
- Config overlay / MCP / Skill runtime 开关：见 [status-panel](status-panel.md) 与 [agent-config](agent-config.md)。`config.ts` 中 runtime tools/skill overlay 会合并到 config permission（`config.ts` 第 47-90 行）。
- Provider/SSE 兼容与流错误恢复：见 [stream-error-recovery](stream-error-recovery.md)。
- IDE 附件分流：`file://` mention 顺序必须是目录 -> PDF/图片 -> 文本 -> 其他二进制；代码入口是 `prompt.ts`。
- `generate_image` 项目内图片与预览：见 [generated-image](generated-image.md)。
- 工具外部目录边界：见 [tool-safety-boundary](tool-safety-boundary.md)。
- 前台读取优先级：见 [foreground-read-priority](foreground-read-priority.md)。
- non-git project identity：见 [project-identity](project-identity.md)。

## 高风险文件清单

- `packages/opencode/src/config/config.ts`
- `packages/opencode/src/mcp/index.ts`
- `packages/opencode/src/provider/provider.ts`
- `packages/opencode/src/server/server.ts`
- `packages/opencode/src/session/message-v2.ts`
- `packages/opencode/src/session/compaction.ts`
- `packages/opencode/src/skill/index.ts`
- `packages/opencode/src/tool/external-directory.ts`
- `packages/opencode/src/session/generated-image.ts`
- `packages/opencode/src/session/summary-scheduler-foreground.ts`
- `packages/opencode/src/session/tool-permission.ts`
- `packages/opencode/src/session/prompt.ts`

## 同步后最低验证清单

- `/app` 路由仍存在且顺序正确，WebGUI 能打开，SSE 能连接。
- IDE bridge 参数仍能注入并连接，scoped storage 可读写。
- MCP/Skill 开关仍显示并影响下一次请求。
- 插件内写文件后 IDE 能刷新。
- `@文件` mention 对目录、PDF/图片、文本、其他二进制仍按 IDE 契约分流。
- 当前会话首屏消息、历史扫描、当前会话 diff 不被后台 diff 抢占。
- `generate_image` 仍能生成项目内图片附件，Markdown/tool attachment 预览带当前实例目录上下文。
- VSCode `OPENCODE_UI_VERSION` 与 JetBrains `getExtensionVersion` 仍来自宿主真实版本。
- JetBrains 空 Marketplace 查询不会保留旧 cached update。

## 已知漂移

- `external-directory.ts` 不是无条件“拒绝执行”，而是项目外路径触发 `external_directory` permission ask；见 [tool-safety-boundary](tool-safety-boundary.md)。

## 运行时待核验

- [ ] 上游同步后最小验证清单需在真实 VSCode 与 JetBrains 宿主各跑一遍（`待运行时核验`）。
- [ ] `file://` mention 的目录/PDF/图片/文本/其他二进制顺序需用真实附件输入确认（`待运行时核验`）。

## 相关

- 上游适配深度清单：[upstream-compatibility](upstream-compatibility.md)
- 能力索引：[../capabilities-index.md](../capabilities-index.md)
