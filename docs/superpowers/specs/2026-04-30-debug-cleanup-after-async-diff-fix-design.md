# 异步 Diff 修复后的排障代码清理设计

## 背景

上一轮为了定位“长上下文会话拖慢同工作区其他会话”的问题，代码库里临时加入了多类排障设施：

- 目标会话 trace helper（`debug-session-trace.ts`）
- `OPENCODE_DEBUG_DISABLE_SUMMARY` / `OPENCODE_DEBUG_SKIP_SUMMARY_DIFF` / `OPENCODE_DEBUG_SESSION_TRACE` 等实验开关
- `summary.skipped` / `summary.diff.skipped` / `http.request.start` / `http.request.finish` 等调试 tag
- 一批只服务这些实验能力的测试

现在正式修复链路已经独立成立：

- `SessionSummaryScheduler`
- `prompt/processor -> markDirty(...)`
- `summary.ts` 的 `canWrite`
- `session.diff.status`
- `/session/visibility`
- `useSessionVisibilitySync`
- `SessionContext.sessionDiffStatus`
- `FileChangesPanel` 的轻提示

因此当前目标不再是继续保留排障设施，而是安全地把这批临时代码与测试清理掉，避免后续维护者混淆“正式修复逻辑”和“排障实验残留”。

## 目标

- 删除运行时代码中的排障专用开关、trace helper 与临时观测分支
- 删除只验证排障设施的测试
- 保留并重新验证正式异步 Diff 修复链路
- 保留排障 spec / plan 文档作为历史记录，不要求同时删除文档

## 非目标

- 本轮不调整正式异步 Diff 修复的产品行为
- 本轮不重构 `SessionSummaryScheduler`、`SessionContext` 或 Diff 面板交互
- 本轮不清理历史文档中的排障描述

## 设计决策

### 1. 一次性清理代码与测试，保留文档历史

采用“一次性硬清理运行时代码与测试，文档保留”的策略：

- 代码库不再保留排障专用 helper、env 开关、debug-only 测试
- 调试 spec / plan 文档继续保留，作为问题定位过程的历史记录

这样能最大限度减少仓库后续噪音，同时不损失历史可追溯性。

### 2. 先删 debug 分支，再删 debug 基础设施

清理顺序必须控制风险：

1. 先从 `prompt.ts` / `processor.ts` / `summary.ts` 删除 debug 开关分支
2. 再删除 `debug-session-trace.ts` 与各调用点
3. 再删除 debug-only 测试
4. 最后删除 `.opencode-debug/` 与本地产物

原因是 helper 和测试都依赖这些分支；顺序反过来会导致难以判断是哪一层删除伤到了正式逻辑。

### 3. 以“目的”而不是“文件名”区分删除对象

删除与保留的判定标准不是文件名，而是用途：

#### 应删除

凡是只为了以下目的存在的代码，应删除：

- 对目标会话写 jsonl trace
- 通过 env 手动切换 summary / diff 实验路径
- 统计调试窗口内事件数与请求时序，服务本次排障
- 只为了验证上述能力存在的测试

#### 必须保留

凡是已经承担正式修复职责的代码，必须保留：

- 后台自动调度
- foreground/visibility/delete/retry 正式语义
- `canWrite` 防写回
- `session.diff.status` 与前端状态链

### 4. 清理后必须重新证明正式修复链路不依赖排障设施

这次清理的成功标准不是“删掉了多少文件”，而是删完后仍能证明：

- 后端后台闭环仍成立
- 前端状态链仍成立
- 构建与类型仍成立
- 仓库里不再有 `OPENCODE_DEBUG_*` / `debug-session-trace` 的残留引用

## 应删除对象

### 运行时代码

- `packages/opencode/src/util/debug-session-trace.ts`
- `getDebugSessionTrace(...)` 的所有生产调用
- `OPENCODE_DEBUG_DISABLE_SUMMARY`
- `OPENCODE_DEBUG_SKIP_SUMMARY_DIFF`
- `OPENCODE_DEBUG_SESSION_TRACE`
- `TARGET_DEBUG_SESSION_ENV`
- `summary.skipped`
- `summary.diff.skipped`
- `http.request.start`
- `http.request.finish`
- 以及本次排障期间加入的临时计数/聚合 trace

### 测试

- `packages/opencode/test/util/debug-session-trace.test.ts`
- `summary.test.ts` 中只验证 debug skip summary diff 的 case
- `prompt.test.ts` / `processor-effect.test.ts` 中只验证 debug disable summary 的 case
- `httpapi-session.test.ts` 中只验证 forced trace / debug file 的 case

### 本地产物

- `.opencode-debug/`
- 只服务本次排障的临时日志产物

## 必须保留对象

### 后端正式修复链路

- `SessionSummaryScheduler`
- `summary.ts` 的 `canWrite`
- `prompt.ts` / `processor.ts` 的 `markDirty(...)`
- 自动 wake / 自动后台执行 / 删除保护 / visibility 调度 / 自动重试
- `session.diff.status`
- `/session/visibility`

### 前端正式链路

- `useSessionVisibilitySync`
- `SessionContext.sessionDiffStatus`
- `events.ts` 里的 `session.diff.status`
- `FooterPanels -> FileChangesPanel` 状态透传
- Diff 面板内 `updating` / `latest` / `failed` 轻提示

### 正式测试

- `summary-scheduler` 的正式行为测试
- `summary.ts` 的真实闭环 / 防写回测试
- `prompt/processor -> markDirty` 的正式回归测试
- `/session/visibility` 的正式接口测试
- `useSessionVisibilitySync` 的正式行为测试
- `SessionContext` / `FileChangesPanel` 的正式状态测试

## 清理顺序

### 第 1 步：删除 debug 分支

优先修改：

- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/session/processor.ts`
- `packages/opencode/src/session/summary.ts`

只删除 debug env 判断和 skip trace，不改正式执行流。

### 第 2 步：删除 debug helper 与调用点

优先修改：

- `packages/opencode/src/util/debug-session-trace.ts`
- `packages/opencode/src/server/routes/instance/trace.ts`
- `packages/opencode/src/server/routes/instance/httpapi/session.ts`
- `packages/opencode/src/session/llm.ts`
- `packages/opencode/src/bus/index.ts`
- `packages/opencode/src/acp/agent.ts`
- 以及其他仅服务该 helper 的调用点

### 第 3 步：删除 debug-only 测试

删除或改写仅服务排障设施的测试，保留正式修复链路回归测试。

### 第 4 步：删除调试产物

删除 `.opencode-debug/` 与本地临时调试日志。

## 风险与防误删策略

### 高风险误删点

#### `summary.ts` 的 `canWrite`

虽然它最初和排障/删除防写回一起被强化，但现在已经是正式逻辑，绝不能随 debug 代码一起删掉。

#### `summary-scheduler.ts` 的自动调度与 visibility 语义

这些不是实验代码，而是正式后台闭环的核心。

#### `SessionContext.sessionDiffStatus`

这是产品状态，不是调试 UI 状态。

#### `/session/visibility`

这是正式调度输入，不是一次性实验接口。

### 防误删原则

- 删实验，不删修复
- 删观测，不删调度
- 删开关，不删正式状态链

## 验证矩阵

### 1. 静态验证

- grep 仓库确认不存在：
  - `OPENCODE_DEBUG_DISABLE_SUMMARY`
  - `OPENCODE_DEBUG_SKIP_SUMMARY_DIFF`
  - `OPENCODE_DEBUG_SESSION_TRACE`
  - `TARGET_DEBUG_SESSION_ENV`
  - `debug-session-trace`
  - `summary.skipped`
  - `summary.diff.skipped`

### 2. 后端回归

- `summary-scheduler` 正式行为测试
- `summary.ts` 真实闭环 / 防写回测试
- `prompt/processor` 正式 `markDirty` 回归
- `/session/visibility` 正式接口测试

### 3. 前端回归

- `useSessionVisibilitySync` 测试
- `SessionContext` diff status 测试
- `FooterPanels` 状态透传测试
- `FileChangesPanel` 轻提示测试

### 4. 构建与类型

- `bun run --cwd packages/opencode typecheck`
- `bun run --cwd packages/opencode/webgui build`

### 5. 最小 smoke

- 源码实例 `/session/visibility` 返回 200 JSON
- 真页面里 Diff 面板状态提示仍正常

## 成功标准

只有同时满足以下条件，才算清理完成：

- 运行时代码里不再保留 `OPENCODE_DEBUG_*` 与 `debug-session-trace` 逻辑
- debug-only 测试已删除或改写
- 正式修复链路的回归测试仍通过
- `typecheck` 通过
- `webgui build` 通过
- 最小 smoke 正常

## 结论

本轮清理不是简单删文件，而是把“排障设施”与“正式修复”彻底解耦。目标是让代码库只保留正式异步 Diff 修复所必需的逻辑，同时用回归与构建验证证明这些修复已经完全不再依赖临时调试开关和 trace helper。
