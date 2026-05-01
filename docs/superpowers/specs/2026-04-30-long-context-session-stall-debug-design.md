# 长上下文会话卡顿调试设计

> 日期：2026-04-30
> 状态：待审阅

## 问题

当前存在一个高优先级性能问题：长上下文会话在继续运行时，用户体感会出现明显卡顿，并怀疑它会拖慢其他请求或其他会话。

本次要重点验证的目标会话是：

- `ses_2274347feffeSe8hdZh7osiw0n`

当前已有调查说明：

- 目标会话体量较大，但不是“数据量大到必然锁死后端”的程度
- 先前基于 shell 并发计时得出的“其他请求被卡 90+s”结论不可靠
- 服务端既有日志显示，至少部分 `/session/status` 与小会话消息读取请求在复现期间仍可能是毫秒级
- 当前最强怀疑从“后端 HTTP 被整体锁死”转为两类可能：
  - 后端某条主处理链路真的很慢
  - 高频事件在 ACP / GlobalBus / worker / 前端消费链里被放大，制造出“像是后端全局卡住”的体感

用户希望得到的不是猜测，而是**可验证、可复现、能直接指导修复点的证据**。用户允许增加临时调试代码，并通过本机日志文件回传验证结果。

## 目标

本次设计的目标不是直接修复，而是通过最小必要埋点准确回答以下问题：

1. 目标会话触发“继续”后，后端是否真的发生主链路阻塞
2. 其他探针请求在同一时段是否在服务端真实变慢
3. `message.part.delta` 等高频事件是否出现异常放大
4. ACP 是否存在 `delta -> session.message()` 反查放大链，并且足以解释用户体感卡顿
5. 最终能够把问题清晰归类为：
   - 后端主链路真实卡住
   - 事件风暴/ACP 放大
   - 前端/浏览器体感假象

## 范围

本次只做**调试与验证设计**，不做功能性修复。

包含：

- 针对目标会话的后端定点埋点
- 对关键 HTTP 请求、会话处理、LLM 流、事件广播、ACP 反查链的日志采集
- 设计独立调试日志文件格式
- 设计稳定复现步骤与诊断规则

不包含：

- 修改产品行为、节流策略或事件协议
- 直接优化前端 React 状态更新
- 直接改 ACP 逻辑为增量直传
- 新增长期保留的监控系统或可视化面板
- 对所有会话长期打开高频详细日志

## 复现约束

本次验证以用户当前最方便的方式执行：

- **环境**：本地浏览器 WebGUI
- **工作路径**：`D:\Caiqy\Projects\Github\opencode-ide-plugin`
- **目标会话**：`ses_2274347feffeSe8hdZh7osiw0n`
- **主触发动作**：在该会话中发送一条 `继续`
- **结果回传**：用户打包或更新带埋点的版本后，由本机日志文件回传结果

同时，埋点默认只对目标会话输出详细日志，以减少噪音与对性能的二次干扰。

## 备选方案

### 方案 A：目标会话定点链路埋点

仅对目标会话加详细跟踪，并同步记录少量其他探针请求的真实服务端耗时。

优点：

- 最容易证明“后端真慢”还是“事件链放大”
- 日志量可控，适合用户回传
- 最贴合当前已知怀疑链路

缺点：

- 需要触碰多个关键模块
- 埋点设计必须克制，避免自身制造性能噪音

### 方案 B：粗粒度全局性能计数器

对全局请求数、事件数、路由耗时做系统级统计，但不聚焦单会话。

优点：

- 改动较少
- 适合判断“系统整体是否真的被拖慢”

缺点：

- 难以映射回目标会话
- 难以精准锁定某条放大链

### 方案 C：浏览器 + 后端双端联合追踪

同时给前端和后端打调试埋点，建立发送、SSE 收包、状态更新和后端事件的完整时间线。

优点：

- 证据最完整
- 最容易严谨区分前端卡还是后端卡

缺点：

- 改动面最大
- 当前用户更怀疑后端，前端全面埋点性价比不如后端定点埋点

## 选型

本次采用 **方案 A：目标会话定点链路埋点**。

原因：

- 用户当前最怀疑后端
- 用户明确允许增加调试代码并通过日志验证
- 现有调查已收敛到少数关键怀疑链路，适合做窄而深的验证
- 该方案最容易得到“能直接指导修复”的证据

## 设计

### 设计原则

1. **只追踪目标会话**：详细日志仅记录 `ses_2274347feffeSe8hdZh7osiw0n`
2. **高频事件聚合**：对 `delta` 类事件按时间窗口聚合，而不是逐条刷屏
3. **对照请求保留**：同时记录少量其他请求的服务端真实耗时，用来排除“全局 HTTP 锁死”
4. **独立日志输出**：调试信息写入单独 JSONL 文件，不与普通日志混杂
5. **证据优先**：每个埋点都必须服务于某个待回答的问题，避免“为了多而多”

### 埋点层次

#### 1. 请求入口埋点

目标：确认请求是否进入后端、处理是否真的慢、慢在哪个路由。

建议位置：

- `packages/opencode/src/server/routes/instance/session.ts`
- `packages/opencode/src/server/routes/instance/httpapi/session.ts`

记录字段：

- `reqID`
- `route`
- `method`
- `sessionID`
- `directory`
- `startAt`
- `endAt`
- `durationMs`
- `isTargetSession`

重点覆盖：

- `POST /session/:id/message`
- `POST /session/:id/abort`
- 小会话消息探针读取
- `/session/status` 或同级轻量探针

该层用于回答：

- 请求是不是根本没进后端
- 请求进了后端后是否真的处理慢
- 其他请求在同一时段是否也被拖慢

#### 2. 会话处理主链路埋点

目标：判断卡顿是否发生在 prompt / processor / summary 等主流程内部。

建议位置：

- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/session/processor.ts`
- `packages/opencode/src/session/summary.ts`

记录事件：

- `prompt.enter`
- `step.start`
- `step.finish`
- `summary.start`
- `summary.finish`

附带字段：

- `step`
- `durationMs`
- `messageCount`
- `partCount`
- `visibleContextSummary`（仅摘要，不重复输出整段上下文）

该层用于回答：

- “继续”后会话是否立刻进入处理
- 某一步是否异常长
- 卡顿是否与 summary / compact 有强相关

#### 3. LLM 流式链路埋点

目标：确认是否是模型流本身长时间无产出，或存在异常静默间隔。

建议位置：

- `packages/opencode/src/session/llm.ts`
- `packages/opencode/src/provider/provider.ts`

记录事件：

- `llm.stream.start`
- `llm.stream.firstChunk`
- `llm.stream.lastChunk`
- `llm.stream.finish`
- `llm.stream.error`

附带字段：

- `providerID`
- `modelID`
- `firstChunkDelayMs`
- `totalChunks`
- `silentGapMaxMs`
- `durationMs`

该层用于回答：

- 是否是 LLM 首包迟迟不来
- 流是否其实一直在产出，只是用户体感像卡住
- 事件风暴是否伴随一个“其实很健康”的流式输出链路

#### 4. 高频事件聚合埋点

目标：验证是否存在事件风暴，而不被逐条日志本身淹没。

建议位置：

- `packages/opencode/src/session/session.ts`
- `packages/opencode/src/session/message-v2.ts`
- `packages/opencode/src/bus/index.ts`
- `packages/opencode/src/bus/global.ts`

聚合窗口建议：

- `1000ms`

每个窗口记录：

- `deltaCount`
- `partUpdatedCount`
- `messageUpdatedCount`
- `sessionUpdatedCount`
- `sessionDiffCount`
- `globalEmitCount`
- 可选：`estimatedSerializedBytes`

记录事件名建议：

- `event.window`

该层用于回答：

- 目标会话运行时，事件密度是否异常高
- 高密度事件是否集中在 `message.part.delta` / `message.part.updated`
- GlobalBus 同步广播是否可能成为放大器

#### 5. ACP 放大链埋点

目标：验证当前最强怀疑链路：`message.part.delta -> ACP -> session.message()`。

建议位置：

- `packages/opencode/src/acp/agent.ts`

记录内容：

- 收到目标会话 `message.part.delta` 的次数
- 因 delta 触发的 `sdk.session.message(...)` 反查次数
- 每次反查耗时
- 每个聚合窗口内的反查总次数与总耗时

建议事件名：

- `acp.delta.received`
- `acp.sessionMessage.fetch`
- `acp.window`

该层用于回答：

- ACP 是否真的对每个 delta 做额外反查
- 反查频率是否高到足以放大后端和 bridge 负担
- 该链路是否与用户体感卡顿时段高度重合

### 日志格式

调试日志应写入独立 JSONL 文件，例如：

- `debug-session-trace-YYYYMMDD-HHMMSS.jsonl`

每行一个 JSON 对象，建议统一字段：

```json
{
  "ts": 1714400000000,
  "tag": "llm.stream.firstChunk",
  "sessionID": "ses_2274347feffeSe8hdZh7osiw0n",
  "reqID": "req_123",
  "step": 12,
  "durationMs": 1842,
  "count": 37,
  "meta": {}
}
```

约束：

- 使用单行 JSON，避免复杂格式化开销
- 缺失字段可省略，但 `ts`、`tag`、`sessionID` 应尽量统一
- 高速链路优先写聚合结果，逐条事件只在必要点保留

### 复现步骤

#### 主动作

1. 打开目标会话 `ses_2274347feffeSe8hdZh7osiw0n`
2. 在本地浏览器 WebGUI 中发送一条 `继续`
3. 等待用户体感中的“明显卡顿”时段出现

#### 对照动作

在主动作执行后，同步触发 1~2 个轻量对照：

- 读取或观察会话状态
- 打开一个小会话
- 发起一次轻量消息读取或会话列表读取

重点不是凭体感判断，而是保证日志中同时拥有：

- 目标会话主链路
- 高频事件窗口
- 其他探针请求耗时

## 诊断矩阵

### 情况 A：后端主链路真实卡住

如果最终日志呈现以下组合：

- `POST /session/:id/message` 很快进入
- `prompt` / `processor` / `summary` 某一段耗时异常长
- 同期其他探针请求在服务端日志中也明显升高
- 事件风暴计数不一定高，但主处理段时间特别长

则可判定：

- **后端某条主链路确实在拖慢整体服务能力**

### 情况 B：事件风暴 / ACP 放大链

如果最终日志呈现以下组合：

- `llm.stream.firstChunk` 与后续流式输出整体正常
- `message.part.delta` / `message.part.updated` 聚合计数异常高
- ACP 存在大量 `delta -> session.message()` 反查
- 其他探针请求可能仍是毫秒级，或仅轻度变慢

则可判定：

- **后端不是主处理卡死，而是事件消费与放大链造成了“像被卡住”的整体体感**

### 情况 C：前端 / 浏览器体感假象

如果最终日志呈现以下组合：

- 后端主链路基本正常
- 其他探针请求服务端耗时正常
- ACP 与事件量也不算异常夸张
- 但用户页面端仍明显卡顿

则可判定：

- **主要矛盾不在后端，需要把调查重点转向前端主线程、SSE handler 或高频 React 状态更新**

## 文件改动清单

### 主要埋点文件

- `packages/opencode/src/server/routes/instance/session.ts`
- `packages/opencode/src/server/routes/instance/httpapi/session.ts`
- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/session/processor.ts`
- `packages/opencode/src/session/llm.ts`
- `packages/opencode/src/session/summary.ts`
- `packages/opencode/src/session/session.ts`
- `packages/opencode/src/session/message-v2.ts`
- `packages/opencode/src/bus/index.ts`
- `packages/opencode/src/bus/global.ts`
- `packages/opencode/src/acp/agent.ts`

### 可新增的临时调试辅助

- `packages/opencode/src/util/debug-session-trace.ts`，用于：
  - 判断是否命中目标会话
  - 统一写 JSONL
  - 做 1 秒窗口聚合

## 风险与约束

### 风险

- 调试日志过多，反过来放大性能问题
- 逐条记录 `delta` 导致日志自身成为瓶颈
- 若不限制目标会话，日志会快速失控且难以分析

### 降低风险的方式

- 详细日志仅限目标会话
- 高频事件只写聚合结果
- 采用独立 JSONL 文件，减少普通日志干扰
- 优先输出摘要字段，避免重复写入大块消息正文或上下文内容

## 非目标

本次不处理：

- 直接修复 ACP 逐条反查
- 直接给 `message.part.delta` 做节流或批处理
- 直接修改前端消息状态管理
- 将临时埋点永久保留到正式发布版本

## 成功标准

本次调试设计实施成功，意味着最终日志能够满足以下条件：

1. **至少排除两条错误路径**
   - 例如排除“后端 HTTP 全局锁死”
   - 排除“LLM 首包一直不回来”

2. **明确锁定一条主要瓶颈路径**
   - 例如 `summary/compact`
   - 或 `processor/llm`
   - 或 `message.part.delta -> ACP -> session.message()`

3. **后续修复点可以直接由日志推出**
   - 不再依赖猜测决定先改哪里

## 预期结果

完成本次埋点与复现后，我们应能得到一条清晰结论：

- 要么确认后端某段主链路真实阻塞
- 要么确认事件风暴与 ACP 放大链是主要原因
- 要么确认后端整体并未真实卡住，问题主要是前端体感

无论结论落在哪一类，都应足以支撑下一步写出**针对性的实施计划**，而不是继续在多个怀疑点之间来回猜测。
