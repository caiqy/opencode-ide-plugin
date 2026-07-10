## Task 4: 最小兼容修复

你在 `D:\Caiqy\Projects\Github\opencode-ide-plugin` 工作。

### 目标

只修复 Task 3 audit 证明破损的 call path：`session.diff.status` 事件契约缺失。不要做无关重构、格式化或 fork 清理，不提交 commit，不勾选 tasks。

### Broken path

- `packages/opencode/src/session/summary-scheduler.ts` 调用 `events.publish(Session.Event.DiffStatus, { sessionID, status, message })`。
- `packages/opencode/src/session/session.ts` 的 `Event` 只导出 `Created`、`Updated`、`Deleted`、`Diff`、`Error`。
- WebGUI `packages/opencode/webgui/src/state/SessionContext.tsx` 监听 `session.diff.status`，并期望 payload：`{ sessionID, status, message }`。

### 最小修复要求

1. 在 session event owner 附近补最小 `DiffStatus` event definition/export。
2. 事件 type 必须是 `session.diff.status`。
3. payload 必须包含：
   - `sessionID`
   - `status: "scheduled" | "running" | "idle" | "deleted" | "failed"`
   - `message: string`
4. 保持 WebGUI consumer 不动，除非类型修复证明必须调整。
5. 若事件 schema 生成/manifest 需要同步，只运行仓库已有生成命令，不手写大块 generated output。

### 允许修改

- `packages/opencode/src/session/session.ts`
- 与事件定义同步直接相关的最小文件
- 与最小测试相关的 `packages/opencode/test/**` 或 `packages/opencode/webgui/src/state/SessionContext.test.tsx`
- 生成命令实际更新的 event/schema/generated files
- `openspec/changes/sync-opencode-webgui/.comet/task-4-report.md`
- `openspec/changes/sync-opencode-webgui/.comet/build/merge-evidence.md`

### 禁止

- rebase、reset、checkout 丢弃改动、提交 commit、勾选 tasks。
- 重写 WebGUI event handling。
- 修复未被 Task 3 标为 production broken 的 test/support drift，除非它阻止验证这个事件契约。

### RED/GREEN

- RED：记录当前 `Session.Event.DiffStatus` 缺失导致的 typecheck/compile failure 或最小静态检查失败。
- GREEN：修复后至少运行：
  - `bun typecheck` from `packages/opencode`，并记录剩余失败是否仍与本修复无关。
  - 若有可运行的 focused test，运行 session diff status / summary scheduler 相关最小测试。
  - `rg --hidden -n "^(<<<<<<<|=======|>>>>>>>)" --glob "!.git/**" --glob "!node_modules/**"`
  - `git ls-files -u`

### 报告契约

把完整报告写到 `openspec/changes/sync-opencode-webgui/.comet/task-4-report.md`。

最终回复只包含：
- `DONE` | `DONE_WITH_CONCERNS` | `BLOCKED` | `NEEDS_CONTEXT`
- 变更文件
- RED/GREEN 摘要
- 剩余风险
- 顾虑
