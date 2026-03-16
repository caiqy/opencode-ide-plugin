# Anthropic SSE 兼容测试 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Anthropic 流式事件建立“边界兼容 + 回放验证 + 变异兜底”的三层测试体系，确保 `content_block_start.text` 缺失不再触发线上回归。

**Architecture:** 在入站边界 `fromAnthropicChunk` 做最小规范化（仅补齐协议缺失字段），把容错逻辑限定在 provider 适配层。测试分三层：`console-app` 契约层快速阻断、`opencode` 回放层覆盖跨包行为、nightly 变异层持续探测脆弱点。CI 采用 PR 快测阻断 + Nightly 慢测兜底 + Release 前回放门禁。

**Tech Stack:** Bun test、TypeScript、GitHub Actions、Turborepo

---

## Chunk 1: 入站边界兼容 + 契约快测

### Task 1: 为 `fromAnthropicChunk` 添加失败先行的契约测试

**Files:**

- Create: `packages/console/app/test/routes/zen/util/provider/anthropic.contract.test.ts`
- Test: `packages/console/app/test/routes/zen/util/provider/anthropic.contract.test.ts`

- [ ] **Step 1: 写失败测试（先覆盖事故场景）**

```ts
import { describe, expect, test } from "bun:test"
import { fromAnthropicChunk } from "../../../../../src/routes/zen/util/provider/anthropic"

describe("fromAnthropicChunk contract", () => {
  test("content_block_start 提供 text 时应保留该文本", () => {
    const s = [
      "event: content_block_start",
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"hello"}}',
      "",
    ].join("\n")

    const out = fromAnthropicChunk(s) as any
    expect(out.choices?.[0]?.delta?.content).toBe("hello")
  })
})
```

- [ ] **Step 2: 运行测试确认当前失败（红灯）**

Run (workdir=`packages/console/app`):
`bun test test/routes/zen/util/provider/anthropic.contract.test.ts`

Expected: 至少 1 条 FAIL（当前实现会把起始文本置空，无法保留 `content_block.text`）。

- [ ] **Step 3: 补充同组边界测试（仍保持失败/或部分失败）**

```ts
test("content_block_start text 缺失时回退为空字符串", () => {
  const s = [
    "event: content_block_start",
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}',
    "",
  ].join("\n")
  const out = fromAnthropicChunk(s) as any
  expect(out.choices?.[0]?.delta?.content).toBe("")
})
test("index 缺失时回退为 0", () => {
  const s = [
    "event: content_block_start",
    'data: {"type":"content_block_start","content_block":{"type":"tool_use","id":"tool-1","name":"bash"}}',
    "",
  ].join("\n")
  const out = fromAnthropicChunk(s) as any
  expect(out.choices?.[0]?.index).toBe(0)
})
test("message_delta 未知 stop_reason 时 finish_reason 为 null", () => {
  const s = [
    "event: message_delta",
    'data: {"type":"message_delta","delta":{"stop_reason":"unknown_reason"}}',
    "",
  ].join("\n")
  const out = fromAnthropicChunk(s) as any
  expect(out.choices?.[0]?.finish_reason).toBeNull()
})
```

- [ ] **Step 4: 再跑一次单文件测试，确认失败集合稳定**

Run (workdir=`packages/console/app`):
`bun test test/routes/zen/util/provider/anthropic.contract.test.ts`

Expected: 仅与未实现兼容逻辑有关的 FAIL，不出现随机失败。

- [ ] **Step 5: 提交（测试先行）**

```bash
git add packages/console/app/test/routes/zen/util/provider/anthropic.contract.test.ts
git commit -m "test(console-app): add anthropic sse contract red tests"
```

### Task 2: 在入站边界实现最小兼容补丁（只改适配层）

**Files:**

- Modify: `packages/console/app/src/routes/zen/util/provider/anthropic.ts`
- Test: `packages/console/app/test/routes/zen/util/provider/anthropic.contract.test.ts`

- [ ] **Step 1: 先加一个回归断言，锁定空串回退行为**

```ts
test("text block 缺失 text 时补空字符串", () => {
  const s = [
    "event: content_block_start",
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}',
    "",
  ].join("\n")

  const out = fromAnthropicChunk(s) as any
  expect(out.choices?.[0]?.delta?.content).toBe("")
})
```

- [ ] **Step 2: 实现最小代码（仅入站边界）**

```ts
if (json.type === "content_block_start") {
  const cb = json.content_block
  if (cb?.type === "text") {
    const text = typeof cb.text === "string" ? cb.text : ""
    out.choices.push({
      index: json.index ?? 0,
      delta: { role: "assistant", content: text },
      finish_reason: null,
    })
  } else if (cb?.type === "tool_use") {
    out.choices.push({
      index: json.index ?? 0,
      delta: {
        tool_calls: [
          {
            index: json.index ?? 0,
            id: cb.id,
            type: "function",
            function: { name: cb.name, arguments: "" },
          },
        ],
      },
      finish_reason: null,
    })
  }
}
```

约束：

- 不把协议特判扩散到 `LLM`/核心业务层。
- 仅在 `fromAnthropicChunk` 及同文件私有辅助逻辑内处理。
- 仅替换 `text` 分支的 content 赋值逻辑，`tool_use` 分支语义必须保持不变。

- [ ] **Step 3: 跑契约测试验证绿灯**

Run (workdir=`packages/console/app`):
`bun test test/routes/zen/util/provider/anthropic.contract.test.ts`

Expected: PASS。

- [ ] **Step 4: 检查改动边界并运行 typecheck 防回归**

Run (workdir=`D:/Caiqy/Projects/Github/opencode-ide-plugin`):
`git diff --name-only`

Expected: 仅出现 `packages/console/app/src/routes/zen/util/provider/anthropic.ts` 与契约测试文件。

Run (workdir=`packages/console/app`):
`bun typecheck`

Expected: 0 error。

- [ ] **Step 5: 提交（最小实现）**

```bash
git add packages/console/app/src/routes/zen/util/provider/anthropic.ts packages/console/app/test/routes/zen/util/provider/anthropic.contract.test.ts
git commit -m "fix(console-app): normalize anthropic text block start payload"
```

### Task 3: 让契约测试可被 turbo/CI 调度

**Files:**

- Modify: `packages/console/app/package.json`
- Modify: `turbo.json`

- [ ] **Step 1: 为 `@opencode-ai/console-app` 增加 test script（先写失败断言）**

在 `packages/console/app/package.json` 增加：

```json
{
  "scripts": {
    "test": "bun test",
    "test:anthropic": "bun test test/routes/zen/util/provider/anthropic.contract.test.ts"
  }
}
```

- [ ] **Step 2: 更新 turbo task 覆盖**

在 `turbo.json` 增加：

```json
{
  "tasks": {
    "@opencode-ai/console-app#test": {
      "dependsOn": ["^build"],
      "outputs": []
    }
  }
}
```

- [ ] **Step 3: 运行 package 级测试命令**

Run (workdir=`packages/console/app`):
`bun run test:anthropic`

Expected: PASS。

- [ ] **Step 4: 运行 turbo 过滤测试确认可调度**

Run (workdir=`D:/Caiqy/Projects/Github/opencode-ide-plugin`):
`bun turbo test --filter=@opencode-ai/console-app`

Expected: console-app test 任务被执行且通过。

- [ ] **Step 5: 提交（CI 接线）**

```bash
git add packages/console/app/package.json turbo.json
git commit -m "build(ci): wire console app tests into turbo"
```

---

## Chunk 2: 回放层与变异层（opencode）

### Task 4: 抽取共享 SSE helper（先搬运再复用）

**Files:**

- Create: `packages/opencode/test/fixture/sse.ts`
- Modify: `packages/opencode/test/session/llm.test.ts`
- Test: `packages/opencode/test/session/llm.test.ts`

- [ ] **Step 1: 在新 helper 文件写导出函数和最小测试调用（先让引用失败）**

```ts
export function createEventStream(chunks: unknown[], includeDone = false) {
  const lines = chunks.map((x) => `data: ${typeof x === "string" ? x : JSON.stringify(x)}`)
  if (includeDone) lines.push("data: [DONE]")
  const payload = lines.join("\n\n") + "\n\n"
  const enc = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      ctrl.enqueue(enc.encode(payload))
      ctrl.close()
    },
  })
}

export function createEventResponse(chunks: unknown[], includeDone = false) {
  return new Response(createEventStream(chunks, includeDone), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  })
}
```

- [ ] **Step 2: 修改 `llm.test.ts` 引用新 helper 并删除本地重复函数**

```ts
import { createEventResponse, createEventStream } from "../fixture/sse"
```

- [ ] **Step 3: 跑既有 LLM 测试确认无行为变化**

Run (workdir=`packages/opencode`):
`bun test test/session/llm.test.ts --timeout 30000`

Expected: PASS。

- [ ] **Step 4: 跑 typecheck**

Run (workdir=`packages/opencode`):
`bun typecheck`

Expected: 0 error。

- [ ] **Step 5: 提交（基础设施抽取）**

```bash
git add packages/opencode/test/fixture/sse.ts packages/opencode/test/session/llm.test.ts
git commit -m "test(opencode): extract shared sse replay helpers"
```

### Task 5: 新增 Anthropic 回放测试与 fixture

**Files:**

- Create: `packages/opencode/test/session/llm.anthropic-replay.test.ts`
- Create: `packages/opencode/test/fixtures/anthropic-sse/normal.jsonl`
- Create: `packages/opencode/test/fixtures/anthropic-sse/missing-text.jsonl`
- Create: `packages/opencode/test/fixtures/anthropic-sse/tool-mixed.jsonl`
- Modify: `packages/opencode/package.json`
- Test: `packages/opencode/test/session/llm.anthropic-replay.test.ts`

- [ ] **Step 1: 先写失败用例（至少 3 条场景）**

```ts
test("replay normal should finish with assistant text", async () => {
  // 断言：typeErrs===0, done===true, finalText.length>0
})

test("replay missing-text should not throw AI_TypeValidationError", async () => {
  // 断言：typeErrs===0, done===true, finalText.length>0 || toolCalls.length>0
})

test("replay tool-mixed should preserve tool calls", async () => {
  // 断言：typeErrs===0, done===true, toolCalls.length>0
})
```

- [ ] **Step 2: 补 fixture（每行一个 SSE data JSON）**

`missing-text.jsonl` 至少包含：

```json
{"type":"message_start","message":{"id":"msg-1","model":"claude-sonnet-4.6","usage":{"input_tokens":0,"output_tokens":0}}}
{"type":"content_block_start","index":0,"content_block":{"type":"text"}}
{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"你好"}}
{"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"input_tokens":1,"output_tokens":1}}
{"type":"message_stop"}
```

- [ ] **Step 3: 增加脚本并跑回放测试**

在 `packages/opencode/package.json` 增加：

```json
{
  "scripts": {
    "test:anthropic:replay": "bun test test/session/llm.anthropic-replay.test.ts --timeout 30000"
  }
}
```

Run (workdir=`packages/opencode`):
`bun run test:anthropic:replay`

Expected: PASS。

- [ ] **Step 4: 用最小回归断言锁定输出**

```ts
expect(typeErrs).toBe(0)
expect(done).toBe(true)
// normal
expect(finalText.length > 0).toBe(true)
// missing-text
expect(finalText.length > 0 || toolCalls.length > 0).toBe(true)
// tool-mixed
expect(toolCalls.length > 0).toBe(true)
```

- [ ] **Step 5: 提交（回放层）**

```bash
git add packages/opencode/test/session/llm.anthropic-replay.test.ts packages/opencode/test/fixtures/anthropic-sse packages/opencode/package.json
git commit -m "test(opencode): add anthropic sse replay coverage"
```

### Task 6: 新增变异测试（nightly 慢测）

**Files:**

- Create: `packages/opencode/test/session/llm.anthropic-mutation.nightly.ts`
- Modify: `packages/opencode/package.json`
- Test: `packages/opencode/test/session/llm.anthropic-mutation.nightly.ts`

- [ ] **Step 1: 写失败先行的规则驱动测试壳**

```ts
const rules = [
  "drop-content_block.text",
  "set-content_block.type-null",
  "drop-delta.text",
  "set-index-string",
  "drop-message-delta.stop_reason",
  "set-usage-output_tokens-string",
  "drop-content_block",
  "insert-unknown-event",
]

for (const r of rules) {
  test(`@mutation @slow ${r}`, async () => {
    // 每条规则都必须满足：typeErrs===0, done===true, finalText.length>0 || toolCalls.length>0
  })
}
```

- [ ] **Step 2: 实现最小变异器（仅测试内）**

```ts
function mutate(line: any, rule: string) {
  // 基于 rule 复制并改写字段，返回新事件
}
```

- [ ] **Step 3: 增加脚本并执行**

在 `packages/opencode/package.json` 增加：

```json
{
  "scripts": {
    "test:anthropic:mutation": "bun test test/session/llm.anthropic-mutation.nightly.ts --timeout 30000"
  }
}
```

Run (workdir=`packages/opencode`):
`bun run test:anthropic:mutation`

Expected: PASS（全部规则均为 blocking，不允许 non-blocking 旁路）。

- [ ] **Step 4: 标注慢测并准备 CI 分流**

约定：测试名统一含 `@mutation @slow`，并保持文件名为 `.nightly.ts`，确保不会被默认 `bun test` 自动收集到 PR 常规套件。

- [ ] **Step 5: 提交（变异层）**

```bash
git add packages/opencode/test/session/llm.anthropic-mutation.nightly.ts packages/opencode/package.json
git commit -m "test(opencode): add anthropic mutation nightly suite"
```

---

## Chunk 3: CI 分层接入（PR / Nightly / Release）

### Task 7: 在现有 PR 流水线接入快测阻断

**Files:**

- Modify: `.github/workflows/test.yml`

- [ ] **Step 1: 先写预期命令清单（作为 workflow 注释）**

PR 阶段必须执行：

- `bun turbo test --filter=@opencode-ai/console-app --filter=opencode`
- `bun --cwd packages/opencode run test:anthropic:replay`

- [ ] **Step 2: 实现 workflow 变更（unit job 中增加步骤）**

新增步骤示例：

```yaml
# keep existing: Run unit tests -> bun turbo test
- name: Run anthropic contract tests
  run: bun --cwd packages/console/app run test:anthropic

- name: Run anthropic replay tests
  run: bun --cwd packages/opencode run test:anthropic:replay
```

要求：追加步骤，不替换现有 `Run unit tests`，避免回退 `@opencode-ai/app#test` 覆盖。

- [ ] **Step 3: 本地 dry-run 校验 YAML 语法**

Run (workdir=`D:/Caiqy/Projects/Github/opencode-ide-plugin`):
`bunx prettier --check .github/workflows/test.yml`

Expected: `All matched files use Prettier code style!`

- [ ] **Step 4: 验证命令可执行**

Run:

- workdir=`packages/console/app`: `bun run test:anthropic`
- workdir=`packages/opencode`: `bun run test:anthropic:replay`

Expected: 两条命令均 PASS。

- [ ] **Step 5: 提交（PR 快测）**

```bash
git add .github/workflows/test.yml
git commit -m "ci(test): gate pr with anthropic contract and replay suites"
```

### Task 8: 新增 nightly 慢测 + release 前回放门禁

**Files:**

- Create: `.github/workflows/anthropic-sse-nightly.yml`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: 新建 nightly workflow（先只跑 replay+mutation）**

`anthropic-sse-nightly.yml` 最小内容包含：

- `on.schedule`（每日一次）
- setup bun
- `bun --cwd packages/opencode run test:anthropic:replay`
- `bun --cwd packages/opencode run test:anthropic:mutation`

- [ ] **Step 2: 在 release workflow 增加前置门禁步骤**

在构建步骤前增加：

```yaml
- name: Replay gate before release
  run: bun --cwd packages/opencode run test:anthropic:replay
```

- [ ] **Step 3: 校验两个 workflow 格式**

Run (workdir=`D:/Caiqy/Projects/Github/opencode-ide-plugin`):
`bunx prettier --check .github/workflows/anthropic-sse-nightly.yml .github/workflows/release.yml`

Expected: 两文件格式检查通过。

- [ ] **Step 4: 记录阻断策略与降级策略**

在 workflow 注释写明：

- PR 仅阻断 contract/replay
- nightly 阻断 mutation
- mutation 连续波动时可临时隔离规则（不删除测试）

- [ ] **Step 5: 提交（慢测与发布门禁）**

```bash
git add .github/workflows/anthropic-sse-nightly.yml .github/workflows/release.yml
git commit -m "ci(nightly): add anthropic mutation suite and release replay gate"
```

---

## 全量验证清单（实现完成后统一执行）

- [ ] `bun run test:anthropic`（workdir=`packages/console/app`）
- [ ] `bun run test:anthropic:replay`（workdir=`packages/opencode`）
- [ ] `bun run test:anthropic:mutation`（workdir=`packages/opencode`）
- [ ] `bun test test/session/llm.test.ts --timeout 30000`（workdir=`packages/opencode`）
- [ ] `bun typecheck`（workdir=`packages/console/app`）
- [ ] `bun typecheck`（workdir=`packages/opencode`）

预期：全部 PASS，且不从仓库 root 直接执行 `bun test`。

---

## 执行备注

- 每个 Task 完成即提交，避免大批量混合改动。
- 严格遵守 TDD：先红灯，再最小实现，再绿灯。
- 若出现第 2 次以上失败重试，先回到边界输入样本复盘，不叠加“猜测式修复”。
- 完成后再考虑是否合并/压缩提交；当前阶段优先可回溯性。
