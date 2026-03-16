---
title: SSE兼容测试
description: 提前发现协议回归，降低线上故障风险
---

# SSE兼容测试

## 背景与问题复盘

线上曾出现 `AI_TypeValidationError`，触发点是 Anthropic SSE 事件 `content_block_start` 缺失 `text` 字段。该问题在流式链路中被放大，最终影响 VSCode 插件侧稳定输出。

根因不是核心业务推理逻辑错误，而是入站事件与期望契约发生漂移。结论是兼容补丁应放在**入站边界**，避免污染核心业务逻辑。

---

## 目标与非目标

### 目标

- 在 CI 内稳定拦截 Anthropic SSE 字段漂移，尤其是 `content_block_start.text` 缺失场景
- 明确三层测试责任：`packages/console/...` 负责解析契约，`packages/opencode/test/...` 负责端到端消费行为
- 将修复约束在入站边界转换层，保证核心业务与上游协议解耦

### 非目标

- 不改造现有业务策略、Agent 编排或对话状态机
- 不追求覆盖所有 Provider，仅聚焦 Anthropic 及其兼容路径
- 不在本阶段引入重型外部回放平台

---

## 比较方案

### 仅做单测

优点是快、便宜、定位精确。缺点是无法覆盖真实分片边界和跨包消费链路。

### 仅做 E2E

优点是真实性高，能发现链路集成问题。缺点是慢、调试成本高，且很难对字段变体做系统枚举。

### 三层组合（契约 + 回放 + 变异）

优点是既能快速定位字段问题，也能覆盖真实流式行为，并持续发现“未显式声明但会炸”的脆弱点。缺点是前期建设成本略高。

### 推荐结论

推荐三层组合，并采用“快测阻断 + 慢测兜底”的 CI 分层。原因是本次事故属于协议边界回归，单层测试无法同时满足速度与真实性。

---

## 设计三层测试

### 第一层：契约测试

在 `packages/console/app/src/routes/zen/util/provider/` 新增 Anthropic SSE 契约测试，直接针对 `fromAnthropicChunk`。测试输入为最小事件片段，断言输出 `CommonChunk` 的结构与容错行为。

重点用例包括 `content_block_start` 缺 `text`、`content_block` 缺失、`index` 缺失、未知 `type`。期望行为是“不抛异常、可降级、保持可继续消费”。

### 第二层：回放测试

在 `packages/opencode/test/session/` 增加回放用例，复用流式消费模式，模拟真实 Anthropic 事件序列。用固定 fixture 回放“正常流”“缺字段流”“混合工具调用流”。

前置任务是先将 `packages/opencode/test/session/llm.test.ts` 内部的 `createEventResponse` 抽取为共享 helper。建议路径为 `packages/opencode/test/fixture/sse.ts`，并同时导出 `createEventStream` 供回放与变异层复用。

断言标准是 `LLM.stream` 能稳定结束、不会抛 `AI_TypeValidationError`，且输出满足机器断言。这里负责验证跨包链路，而不是单点转换细节。

### 第三层：变异测试

在测试阶段对 SSE 事件做轻量变异，自动删除或替换关键字段后再回放。首批变异规则只覆盖高风险字段：`content_block_start.content_block.text`、`content_block_start.content_block.type`、`content_block_delta.delta.text`。

断言是“系统降级而非崩溃”，并记录变异标签用于回归追踪。变异层用于持续发现未被人工想到的边界。

### 边界策略

兼容补丁统一落在入站边界转换函数（如 `fromAnthropicChunk`）与其上游解析包装层。核心业务层只接收规范化结构，不感知上游字段脏数据。

---

## 建立测试矩阵

| 事件类型            | 字段变体           | 分片边界     | 预期行为                       |
| ------------------- | ------------------ | ------------ | ------------------------------ |
| content_block_start | text 缺失          | 单包完整     | 不抛错，发出空内容起始 delta   |
| content_block_start | content_block 缺失 | 单包完整     | 忽略该块并继续后续事件         |
| content_block_start | index 缺失         | 跨两包切分   | 默认 index=0，链路继续         |
| content_block_delta | delta.text 缺失    | 单包完整     | 不产出 content delta，但不中断 |
| content_block_delta | partial_json 分片  | 多包随机切分 | tool 参数可累计，最终可解析    |
| message_delta       | stop_reason 未知值 | 单包完整     | finish_reason 置空并安全结束   |
| message_delta       | usage 仅部分字段   | 单包完整     | usage 按可用字段归一化         |
| message_stop        | 提前到达           | 跨包切分     | 正常收尾，不重复结束           |

矩阵中的每一行至少对应 1 条契约测试和 1 条回放测试。高风险行再追加变异测试。

---

## 推进实施

### 阶段一：补齐契约层（1-2 天）

先在 `packages/console/...` 建立最小契约集，覆盖本次事故与同类字段缺失。里程碑是新增用例全部稳定通过，且能复现并拦截已知故障。

### 阶段二：接入回放层（2-3 天）

在 `packages/opencode/test/session/` 加入 Anthropic 回放测试，接入现有 Bun 流式测试基建。里程碑是三条主流程（纯文本、工具调用、异常字段）全部通过。

### 阶段三：上线变异层（2 天）

新增轻量变异器和基础规则，先跑 nightly。里程碑是 nightly 失败可定位到“事件类型 + 字段 + 变异规则”。

### CI 策略

#### 与现有流水线对齐

测试命令按包目录执行，不在仓库 root 直接跑测试。推荐在 `packages/console/app` 下执行 `bun test src/routes/zen/util/provider/anthropic.contract.test.ts`，在 `packages/opencode` 下执行 `bun test test/session/llm.anthropic-*.test.ts`。

若继续使用 `bun turbo test` 聚合，需要把契约测试纳入 turbo task 覆盖。当前仅有 `opencode#test` 与 `@opencode-ai/app#test`，应补充 `@opencode-ai/console-app#test`，否则 PR 无法保证执行到新契约用例。

#### 按触发阶段执行

- PR 必跑：`console-app` 契约测试 + `opencode` 关键回放测试（纯文本、工具调用、缺字段）
- Nightly 必跑：`opencode` 全量回放 + 变异测试（含慢测标签）
- Release 必跑：复用 Nightly 全套，并加跑“最近 3 次 Nightly 失败样本回放”

PR 阶段仅以契约与关键回放作为阻断项。Nightly 与 Release 才启用变异层阻断，避免把慢测噪音直接引入日常提交流程。

---

## 管理风险

主要风险是测试维护成本上升与变异噪音过高。缓解手段是分层标签、失败去重、只保留高价值变异规则。

若新补丁引入副作用，优先回滚入站兼容分支并保留测试资产。回滚后通过回放基线快速验证恢复状态。

---

## 定义验收

- 字段断言：`content_block_start.content_block.text` 缺失用例在契约层必须断言 `fromAnthropicChunk` 不抛错，且返回 `type=content_block_start`、`index` 为数字、`text` 回退为空字符串
- 回放断言：`llm.replay.anthropic.missing-text` 必须断言 `LLM.stream` 正常结束、`AI_TypeValidationError` 计数为 0、`assistant` 最终输出满足“`text.length > 0` 或 `toolCalls.length > 0`”
- 失败率阈值：变异测试按规则统计，Nightly 最近 7 次运行中单规则失败率不得高于 5%，超过阈值的规则自动降级为 non-blocking 并打上 `mutation:quarantine`
- 阻断条件：PR 仅阻断契约与关键回放失败；Release 在 PR 条件基础上，额外阻断“Nightly 全量回放失败”或“存在未隔离的高于 5% 失败率变异规则”
- 代码边界：新增兼容分支仅允许出现在入站边界转换层及其测试文件，核心业务目录出现协议特判即判定不通过

---

## 附录

### 建议目录结构

```text
packages/
  console/app/src/routes/zen/util/provider/
    anthropic.ts
    anthropic.contract.test.ts
  opencode/test/
    session/
      llm.anthropic-replay.test.ts
      llm.anthropic-mutation.test.ts
    fixtures/
      anthropic-sse/
        normal.jsonl
        missing-text.jsonl
        tool-mixed.jsonl
```

### 约定用例命名

- 契约层：`anthropic.contract.<event>.<variant>.test.ts`
- 回放层：`llm.replay.anthropic.<scenario>.test.ts`
- 变异层：`llm.mutation.anthropic.<rule>.test.ts`

命名中必须包含 `event` 或 `rule` 关键词，便于 CI 报表聚合。用例名建议直接体现“缺哪个字段”。

### 最小断言模板

```ts
expect(() => fromAnthropicChunk(input)).not.toThrow()
expect(out.type).toBe("content_block_start")
expect(typeof out.index).toBe("number")
expect(out.text ?? "").toBe("")
```

```ts
expect(errs.filter((x) => x.name === "AI_TypeValidationError").length).toBe(0)
expect(done).toBe(true)
expect(finalText.length > 0 || toolCalls.length > 0).toBe(true)
```

### 慢测标签策略

回放与变异用例统一使用 `@replay`、`@mutation`、`@slow` 标签。PR 只选 `@replay` 的关键子集，Nightly 与 Release 执行全量 `@replay + @mutation + @slow`。
