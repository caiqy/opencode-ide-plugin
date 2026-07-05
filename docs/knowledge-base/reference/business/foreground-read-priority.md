# 能力：前台读取优先级

> **象限**：Reference（能力参考）
> **能力编号**：J1（见 [capabilities-index](../capabilities-index.md)）
> **基线状态**：基线

## 代码真源

| 角色 | 文件 |
|------|------|
| Summary 调度器 | `packages/opencode/src/session/summary-scheduler.ts` |
| foreground 状态函数 | `packages/opencode/src/session/summary-scheduler-foreground.ts` |
| HttpApi foreground helper | `packages/opencode/src/server/routes/instance/httpapi/session.ts` |
| Session 路由 handler | `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` |
| 标准路由兼容出口 | `packages/opencode/src/server/routes/instance/session.ts` |
| 前端 visible sync | `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.ts` |
| 前端会话激活 | `packages/opencode/webgui/src/state/useSessionActivation.ts` |

> 命名交叉核验（Step 5）：J1 对应 [foreground-read-priority](foreground-read-priority.md)，不复制逐文件清单。

## 意图

当前激活会话的首屏消息、历史分页扫描和当前会话 diff 读取，优先于后台 summary/diff 刷新。目标是避免切换会话时被后台任务抢占，导致首屏卡顿或 diff 状态抖动。

## 行为契约

- foreground 保护是计数器，不是单个 boolean；开始递增，结束递减到 0 后才允许恢复调度（`summary-scheduler-foreground.ts` 第 12-23 行）。
- `scheduleSession` 在 `foregroundCount > 0` 时不启动后台任务（`summary-scheduler.ts` 第 87-98 行）。
- `flushState` 在 foreground 或已有 background run 时直接返回，确保后台 summary 不并发抢占（`summary-scheduler.ts` 第 138-145 行）。
- `markDirty` 只标记 dirty、version、messageID；是否调度由 scheduler 统一判断（`summary-scheduler.ts` 第 244-268 行）。
- foreground 结束后会重新 `scheduleDirty + signal`，收口到同一调度器路径（`summary-scheduler.ts` 第 270-281 行）。
- `visibilityReady === false` 时所有 session 视为可见；首次 `syncVisible` 后才切换到真实 visible gating（`summary-scheduler.ts` 第 81 行、第 214-220 行、第 283-299 行）。
- 后台 summarize 期间如果 session 被移出 visible set，会增加 `guardVersion` 并标 dirty；写回通过 `canWrite` 校验丢弃旧结果（`summary-scheduler.ts` 第 157-180 行、第 283-290 行）。
- HttpApi 的 messages 与 diff 读取都通过 `withForegroundRead` 包裹（`handlers/session.ts` 第 97-105 行、第 108-153 行）。
- `withForegroundRead` 用 `acquireUseRelease` 保证读取前 start、读取后 finish（`httpapi/session.ts` 第 19-34 行）。
- 前端 visible sync 会把 `foregroundSessions` 从后台 visible 集合排除，避免当前激活 session 过早进入后台集合（`useSessionVisibilitySync.ts` 第 8-17 行、第 28-29 行）。
- 前端会话激活期间调用 `beginForegroundSession` / `endForegroundSession` 包住 `ensureSession` 与历史扫描（`useSessionActivation.ts` 第 82-104 行、第 120-162 行）。

## 边界与约束

- `packages/opencode/src/server/routes/instance/session.ts` 当前只转出标准路由测试 gate；foreground 主实现位于 HttpApi session helper（`session.ts` 第 1 行）。
- 标准 Hono 路由与 experimental HttpApi 路由都必须保持同一 foreground 语义；新增消息/diff 读取入口时要复用同一 helper 或等价保护。
- foreground 保护不取消底层 summary 计算，只通过 `guardVersion/canWrite` 防旧写回。

## 静态锚点

- foreground 计数开始：`packages/opencode/src/session/summary-scheduler-foreground.ts:12`
- foreground 计数结束：`packages/opencode/src/session/summary-scheduler-foreground.ts:18`
- foreground 阻止 schedule：`packages/opencode/src/session/summary-scheduler.ts:92`
- visibility 默认可见：`packages/opencode/src/session/summary-scheduler.ts:81`
- canWrite 防旧写回：`packages/opencode/src/session/summary-scheduler.ts:158`
- syncVisible guardVersion：`packages/opencode/src/session/summary-scheduler.ts:283`
- diff foreground 包装：`packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:97`
- messages foreground 包装：`packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts:108`
- 前端排除 foreground session：`packages/opencode/webgui/src/hooks/useSessionVisibilitySync.ts:16`
- 激活读取 begin foreground：`packages/opencode/webgui/src/state/useSessionActivation.ts:102`
- 激活读取 finally release：`packages/opencode/webgui/src/state/useSessionActivation.ts:160`

## 维护检查

- 新增 session messages、pagination 或 diff 读取路径时，必须确认是否要进入 foreground 保护。
- 改 visible gating 时，保留首次 sync 前全部可见的默认值，避免启动阶段丢后台刷新。
- 改 summary 写回时，保留 `guardVersion/canWrite`，不要只依赖中断计算。

## 运行时待核验

- [ ] 大会话快速切换时，首屏消息读取是否稳定优先于后台 diff（`待运行时核验`：需要真实 WebGUI + 后端长会话）。
- [ ] 隐藏/显示 tab 后 `syncVisible` 与 foreground session 集合是否无抖动（`待运行时核验`）。

## 相关

- 上游适配总览：[upstream-compatibility](upstream-compatibility.md)
- 会话体验：[session-chat](session-chat.md)
