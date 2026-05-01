# 跨会话卡顿实验开关设计

> 日期：2026-04-30
> 状态：已确认，待实现

## 问题

当前已经确认一个重要现象：当目标长会话 `ses_2274347feffeSe8hdZh7osiw0n` 缓慢执行时，同一工作区中的其他会话生成也会明显变慢；但轻量级 HTTP 探针（如 `status`、session list）并不总是一起变慢。

已有证据显示：

- `llm.stream.firstChunk` 往往在数毫秒内到达
- 随后出现 `100s+` 的长静默段
- `summary.start/finish` 与静默段时间高度相关
- 浏览器直连 WebGUI 时也能复现，不依赖 IDE bridge
- 目标长会话运行时，其他会话生成也会被拖慢

这说明问题更像是**同一工作区内某条共享重路径被长会话压满**，而不是普通 HTTP 全局锁死，也不像单纯前端假象。

## 目标

本轮目标不是直接修复，而是通过**最小行为开关 + 最少必要埋点**，快速回答：

1. `summary.summarize()` 是否是主要拖慢源
2. `summary.summarize()` 内部的 `snapshot.diffFull()` 是否是主要拖慢源
3. 如果关闭这两类可疑路径后，长会话与其他会话的生成是否明显恢复

## 范围

本轮包含：

- 新增本地实验开关
- 仅用于调试验证的少量 trace 事件
- 基于同一复现动作做 3 轮对照实验

本轮不包含：

- 永久性能修复
- 改写 snapshot 锁模型
- 改写 DB / SyncEvent / SSE 架构
- 长期保留的产品级配置能力

## 备选方案

### 方案 A：继续只补埋点

优点：

- 行为零变更
- 风险最低

缺点：

- 验证速度慢
- 不能直接证明“去掉该路径后是否恢复”

### 方案 B：一次性关闭所有 snapshot 相关路径

优点：

- 对照效果强

缺点：

- 对主流程干扰过大
- 实验结果不干净，难以定位是哪一段恢复了

### 方案 C：增加针对性实验开关

优点：

- 能快速做因果验证
- 只针对当前最高怀疑点
- 改动面可控，可在实验后删除

缺点：

- 属于临时行为改动
- 需要非常克制，避免引入新变量

## 选型

本轮采用 **方案 C：增加针对性实验开关**。

原因：

- 用户明确要求直接做对照实验
- 当前怀疑点已明显收敛到 `summary.summarize()` 与 `summary -> diffFull`
- 通过开关做 3 轮对照，比继续单纯补埋点更快得到因果结论

## 设计

### 设计原则

1. **只动最高怀疑点**：不扩散到无关链路
2. **不做永久配置**：只提供本地调试开关
3. **尽量不破坏主生成流程**：避免全局关闭 snapshot
4. **保留关键 trace**：实验结果不能只靠体感判断

### 实验开关

#### 开关 1：禁用 `summary.summarize()`

建议环境变量：`OPENCODE_DEBUG_DISABLE_SUMMARY=1`

行为：

- 在 `prompt.ts` 首轮异步触发 summary 前判断开关
- 在 `processor.ts` 每次 `finish-step` 异步触发 summary 前判断开关
- 命中时不执行 `summary.summarize(...)`
- 写入一条 `summary.skipped` trace

用途：

- 直接验证后台 summary 链路是否是跨会话拖慢的主要来源

#### 开关 2：仅跳过 `summary` 内部 `diffFull`

建议环境变量：`OPENCODE_DEBUG_SKIP_SUMMARY_DIFF=1`

行为：

- 只在 `summary.summarize()` 内部生效
- 仍保留 `summary.start/finish`
- 仍允许 summary 走后续写入分支，但 `diffs` 直接取空数组
- 命中时写入 `summary.diff.skipped` trace

用途：

- 把“整个 summary 很重”进一步拆成“是不是 `diffFull` 最重”

### 为什么不直接全局关闭 snapshot

不采用“全局关闭 snapshot”的原因：

- 风险太高
- 会影响主生成流程的正确性
- 即使恢复，也无法说明具体是哪一段导致恢复

因此本轮只跳过最怀疑的 `summary -> diffFull`，不动 `snapshot.track()` / `snapshot.patch()` 主链路。

### 配套 trace

即使采用实验开关，本轮仍保留这些关键 trace：

- `summary.start`
- `summary.finish`
- `summary.skipped`
- `summary.diff.skipped`
- `llm.stream.firstChunk`
- `llm.stream.finish`
- 小会话 probe 的 `POST /session/:id/message` 关键链路事件

这样可以同时比较体感与时序证据。

## 实验矩阵

固定执行 3 轮：

1. **基线**：不开任何实验开关
2. **关闭 summary**：`OPENCODE_DEBUG_DISABLE_SUMMARY=1`
3. **仅跳过 summary diff**：`OPENCODE_DEBUG_SKIP_SUMMARY_DIFF=1`

每轮都使用相同复现步骤：

- 打开本地 WebGUI
- 在目标长会话 `ses_2274347feffeSe8hdZh7osiw0n` 发送一条 `继续`
- 同时观察另一个小会话的生成是否也被拖慢
- 回收 `.opencode-debug/debug-session-trace-*.jsonl`

## 成功标准

如果出现以下结果之一，就足以指导下一步修复：

- **关闭 summary 后显著恢复**：说明 `summary.summarize()` 是主嫌疑
- **仅跳过 diffFull 就显著恢复**：说明瓶颈更集中在 `summary -> snapshot.diffFull`
- **两个实验都无明显改善**：说明主因更偏 `snapshot.track/patch`、`DB/SyncEvent`、`SSE/前端消费` 或其他共享路径

## 风险与控制

风险：

- 实验开关可能改变部分 side effect
- 结果若仅看体感，容易误判

控制方式：

- 开关只用于本地实验，不纳入正式用户配置
- 保留关键 trace，用 `silentGapMaxMs`、`step.finish`、对照会话表现共同判断

## 涉及文件

- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/session/processor.ts`
- `packages/opencode/src/session/summary.ts`
- `packages/opencode/src/util/debug-session-trace.ts`
- `packages/opencode/test/util/debug-session-trace.test.ts`
- `packages/opencode/test/server/httpapi-session.test.ts`
