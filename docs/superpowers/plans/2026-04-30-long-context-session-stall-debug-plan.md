# 长上下文会话卡顿调试实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为目标会话 `ses_2274347feffeSe8hdZh7osiw0n` 增加最小必要的后端调试埋点，生成可回传的 JSONL 日志，用来严格区分“后端主链路阻塞”“事件风暴/ACP 放大”“前端体感假象”。

**Architecture:** 新增一个轻量级 `debug-session-trace` 辅助模块，负责目标会话过滤、JSONL 追加写入和 1 秒窗口聚合；各业务链路只调用该辅助模块，不直接自己拼日志。随后在 HTTP 路由、会话主流程、LLM 流、高频事件链和 ACP delta 反查链上插入最小追踪点，并用 bun:test 为辅助模块与关键路由行为建立回归保护。

**Tech Stack:** TypeScript, Bun, Hono, Effect, bun:test, JSONL file logging.

---

## 文件结构

- Create: `packages/opencode/src/util/debug-session-trace.ts`
  - 负责目标会话过滤、统一日志格式、文件落盘、事件窗口聚合、请求/链路 trace API。
- Create: `packages/opencode/test/util/debug-session-trace.test.ts`
  - 验证 helper 的目标会话过滤、JSONL 输出和 1 秒聚合逻辑。
- Modify: `packages/opencode/src/server/routes/instance/session.ts`
  - 对 `POST /session/:id/message`、`abort`、消息读取等目标会话请求做入口/出口 trace。
- Modify: `packages/opencode/src/server/routes/instance/httpapi/session.ts`
  - 对 HTTP API 的 `status`、`message`、`messages` 等探针路由做入口/出口 trace。
- Modify: `packages/opencode/src/session/prompt.ts`
  - 记录 `prompt.enter` 与上下文摘要。
- Modify: `packages/opencode/src/session/processor.ts`
  - 记录 `step.start`、`step.finish`、异常结束与耗时。
- Modify: `packages/opencode/src/session/llm.ts`
  - 记录 `llm.stream.start`、`firstChunk`、`lastChunk`、`finish`、`error`。
- Modify: `packages/opencode/src/session/summary.ts`
  - 记录 `summary.start`、`summary.finish`。
- Modify: `packages/opencode/src/session/session.ts`
  - 对目标会话写入会话级事件窗口聚合。
- Modify: `packages/opencode/src/session/message-v2.ts`
  - 对 `message.part.delta`、`message.part.updated` 等高频事件写窗口聚合调用。
- Modify: `packages/opencode/src/bus/index.ts`
  - 对实例 bus 的目标事件写聚合调用。
- Modify: `packages/opencode/src/bus/global.ts`
  - 对 GlobalBus 事件写聚合调用。
- Modify: `packages/opencode/src/acp/agent.ts`
  - 记录 delta 接收、`sdk.session.message()` 反查次数与耗时。

---

### Task 1: 建立调试 helper 与回归测试

**Files:**

- Create: `packages/opencode/src/util/debug-session-trace.ts`
- Test: `packages/opencode/test/util/debug-session-trace.test.ts`

- [ ] **Step 1: 写失败测试，锁定“只追踪目标会话 + 1 秒聚合 + JSONL 输出”行为**

```ts
import { afterEach, describe, expect, test } from "bun:test"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { createDebugSessionTrace, TARGET_DEBUG_SESSION_ID } from "../../src/util/debug-session-trace"

describe("debug-session-trace", () => {
  test("ignores non-target sessions and writes target events", async () => {
    await using tmp = await tmpdir()
    const trace = createDebugSessionTrace({
      directory: tmp.path,
      sessionID: TARGET_DEBUG_SESSION_ID,
      now: () => 1_000,
    })

    await trace.event({ tag: "prompt.enter", sessionID: "ses_other", meta: { a: 1 } })
    await trace.event({ tag: "prompt.enter", sessionID: TARGET_DEBUG_SESSION_ID, meta: { a: 2 } })

    const text = await Bun.file(trace.file).text()
    const lines = text.trim().split("\n")

    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0] as string)).toMatchObject({
      tag: "prompt.enter",
      sessionID: TARGET_DEBUG_SESSION_ID,
      meta: { a: 2 },
    })
  })

  test("flushes one aggregated event window per second", async () => {
    await using tmp = await tmpdir()
    let now = 10_000
    const trace = createDebugSessionTrace({
      directory: tmp.path,
      sessionID: TARGET_DEBUG_SESSION_ID,
      now: () => now,
    })

    await trace.count({ sessionID: TARGET_DEBUG_SESSION_ID, bucket: "event.window", field: "deltaCount", value: 1 })
    await trace.count({ sessionID: TARGET_DEBUG_SESSION_ID, bucket: "event.window", field: "deltaCount", value: 2 })
    now = 11_500
    await trace.flush()

    const text = await Bun.file(trace.file).text()
    const rows = text
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))

    expect(rows).toEqual([
      expect.objectContaining({
        tag: "event.window",
        sessionID: TARGET_DEBUG_SESSION_ID,
        count: 3,
        meta: expect.objectContaining({ deltaCount: 3, windowMs: 1000 }),
      }),
    ])
  })
})
```

- [ ] **Step 2: 运行测试，确认当前 helper 缺失导致失败**

Run: `bun run --cwd packages/opencode test test/util/debug-session-trace.test.ts`

Expected: FAIL，报 `Cannot find module '../../src/util/debug-session-trace'` 或缺少导出。

- [ ] **Step 3: 实现最小 helper，提供目标会话过滤、JSONL 写入和 1 秒窗口聚合**

```ts
import path from "node:path"
import { mkdir } from "node:fs/promises"

export const TARGET_DEBUG_SESSION_ID = "ses_2274347feffeSe8hdZh7osiw0n"

type TraceEvent = {
  tag: string
  sessionID?: string
  reqID?: string
  step?: number
  durationMs?: number
  count?: number
  meta?: Record<string, unknown>
}

type WindowState = {
  startedAt: number
  fields: Record<string, number>
}

export function createDebugSessionTrace(input?: { directory?: string; sessionID?: string; now?: () => number }) {
  const now = input?.now ?? Date.now
  const root = input?.directory ?? process.cwd()
  const file = path.join(root, ".opencode-debug", `debug-session-trace-${Date.now()}.jsonl`)
  const windows = new Map<string, WindowState>()

  const ensure = async () => {
    await mkdir(path.dirname(file), { recursive: true })
  }

  const shouldTrace = (sessionID?: string) => sessionID === TARGET_DEBUG_SESSION_ID

  const append = async (payload: TraceEvent & { ts?: number }) => {
    await ensure()
    const row = JSON.stringify({ ts: now(), ...payload }) + "\n"
    await Bun.write(file, row, { createPath: true, append: true })
  }

  const flushBucket = async (bucket: string, sessionID: string) => {
    const key = `${bucket}:${sessionID}`
    const state = windows.get(key)
    if (!state) return
    windows.delete(key)
    await append({
      tag: bucket,
      sessionID,
      count: Object.values(state.fields).reduce((sum, value) => sum + value, 0),
      meta: { ...state.fields, windowMs: 1000, startedAt: state.startedAt },
    })
  }

  return {
    file,
    shouldTrace,
    async event(event: TraceEvent) {
      if (!shouldTrace(event.sessionID)) return
      await append(event)
    },
    async count(input: { sessionID?: string; bucket: string; field: string; value?: number }) {
      if (!shouldTrace(input.sessionID)) return
      const sessionID = input.sessionID!
      const key = `${input.bucket}:${sessionID}`
      const current = windows.get(key)
      const ts = now()
      if (current && ts - current.startedAt >= 1000) await flushBucket(input.bucket, sessionID)
      const next = windows.get(key) ?? { startedAt: ts, fields: {} }
      next.fields[input.field] = (next.fields[input.field] ?? 0) + (input.value ?? 1)
      windows.set(key, next)
    },
    async flush() {
      for (const key of [...windows.keys()]) {
        const [bucket, sessionID] = key.split(":")
        await flushBucket(bucket!, sessionID!)
      }
    },
  }
}

export const DebugSessionTrace = createDebugSessionTrace()
```

- [ ] **Step 4: 再跑 helper 测试，确认通过**

Run: `bun run --cwd packages/opencode test test/util/debug-session-trace.test.ts`

Expected: PASS。

---

### Task 2: 给 HTTP 入口与会话主链路接入 trace

**Files:**

- Modify: `packages/opencode/src/server/routes/instance/session.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/session.ts`
- Modify: `packages/opencode/src/session/prompt.ts`
- Modify: `packages/opencode/src/session/processor.ts`
- Modify: `packages/opencode/src/session/summary.ts`
- Test: `packages/opencode/test/server/httpapi-session.test.ts`

- [ ] **Step 1: 写失败测试，锁定目标会话请求会产生 trace 文件**

```ts
test("writes trace rows for target session message reads", async () => {
  await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
  const headers = { "x-opencode-directory": tmp.path }
  const session = await createSession(tmp.path, { title: "trace-target" })
  const message = await createTextMessage(tmp.path, session.id, "hello")

  process.env.OPENCODE_DEBUG_SESSION_TRACE = session.id

  const response = await app().request(
    pathFor(SessionPaths.message, { sessionID: session.id, messageID: message.info.id }),
    {
      headers,
    },
  )

  expect(response.status).toBe(200)
  const debugDir = path.join(tmp.path, ".opencode-debug")
  const files = await Array.fromAsync(new Bun.Glob("debug-session-trace-*.jsonl").scan({ cwd: debugDir }))
  expect(files.length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: 运行测试，确认当前没有 trace 文件而失败**

Run: `bun run --cwd packages/opencode test test/server/httpapi-session.test.ts`

Expected: FAIL，断言 `debug-session-trace-*.jsonl` 不存在。

- [ ] **Step 3: 在路由入口与会话主链路加最小 trace 调用**

```ts
// session.ts / httpapi/session.ts
const reqID = crypto.randomUUID()
const startedAt = Date.now()
await DebugSessionTrace.event({
  tag: "http.request.start",
  reqID,
  sessionID,
  meta: { route: c.req.path, method: c.req.method, directory },
})
try {
  const response = await nextWork()
  await DebugSessionTrace.event({
    tag: "http.request.finish",
    reqID,
    sessionID,
    durationMs: Date.now() - startedAt,
    meta: { route: c.req.path, method: c.req.method, status: response.status },
  })
  return response
} catch (error) {
  await DebugSessionTrace.event({
    tag: "http.request.error",
    reqID,
    sessionID,
    durationMs: Date.now() - startedAt,
    meta: { route: c.req.path, method: c.req.method, error: error instanceof Error ? error.message : String(error) },
  })
  throw error
}

// prompt.ts
yield *
  Effect.promise(() =>
    DebugSessionTrace.event({
      tag: "prompt.enter",
      sessionID: input.sessionID,
      meta: {
        messageCount: input.messages.length,
        partCount: input.messages.reduce((sum, item) => sum + item.parts.length, 0),
      },
    }),
  )

// processor.ts
const startedAt = Date.now()
yield * Effect.promise(() => DebugSessionTrace.event({ tag: "step.start", sessionID, step }))
yield *
  stepEffect.pipe(
    Effect.ensuring(
      Effect.promise(() =>
        DebugSessionTrace.event({ tag: "step.finish", sessionID, step, durationMs: Date.now() - startedAt }),
      ),
    ),
  )

// summary.ts
yield * Effect.promise(() => DebugSessionTrace.event({ tag: "summary.start", sessionID }))
// summary work...
yield * Effect.promise(() => DebugSessionTrace.event({ tag: "summary.finish", sessionID, durationMs }))
```

- [ ] **Step 4: 再跑 HTTP API 测试，确认 trace 文件生成且原测试仍通过**

Run: `bun run --cwd packages/opencode test test/server/httpapi-session.test.ts`

Expected: PASS。

---

### Task 3: 给 LLM 流、高频事件窗口与 ACP 反查链接入 trace

**Files:**

- Modify: `packages/opencode/src/session/llm.ts`
- Modify: `packages/opencode/src/session/session.ts`
- Modify: `packages/opencode/src/session/message-v2.ts`
- Modify: `packages/opencode/src/bus/index.ts`
- Modify: `packages/opencode/src/bus/global.ts`
- Modify: `packages/opencode/src/acp/agent.ts`
- Test: `packages/opencode/test/util/debug-session-trace.test.ts`

- [ ] **Step 1: 先扩充 helper 测试，锁定窗口计数与 ACP fetch 计时格式**

```ts
test("records acp fetch timing and aggregate counters", async () => {
  await using tmp = await tmpdir()
  let now = 20_000
  const trace = createDebugSessionTrace({ directory: tmp.path, sessionID: TARGET_DEBUG_SESSION_ID, now: () => now })

  await trace.event({ tag: "acp.sessionMessage.fetch", sessionID: TARGET_DEBUG_SESSION_ID, durationMs: 42 })
  await trace.count({ sessionID: TARGET_DEBUG_SESSION_ID, bucket: "acp.window", field: "fetchCount", value: 1 })
  await trace.count({ sessionID: TARGET_DEBUG_SESSION_ID, bucket: "acp.window", field: "fetchDurationMs", value: 42 })
  now = 21_500
  await trace.flush()

  const rows = (await Bun.file(trace.file).text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
  expect(rows).toEqual([
    expect.objectContaining({ tag: "acp.sessionMessage.fetch", durationMs: 42 }),
    expect.objectContaining({
      tag: "acp.window",
      meta: expect.objectContaining({ fetchCount: 1, fetchDurationMs: 42 }),
    }),
  ])
})
```

- [ ] **Step 2: 运行 helper 测试，确认新增格式约束先失败**

Run: `bun run --cwd packages/opencode test test/util/debug-session-trace.test.ts`

Expected: FAIL，如果 helper 还未支持所需字段或聚合格式。

- [ ] **Step 3: 在 LLM、事件链和 ACP 反查链接入最小 trace**

```ts
// llm.ts
const startedAt = Date.now()
let firstChunkAt: number | undefined
let lastChunkAt: number | undefined
let totalChunks = 0
await DebugSessionTrace.event({ tag: "llm.stream.start", sessionID, meta: { providerID, modelID } })

for await (const chunk of stream) {
  totalChunks += 1
  const now = Date.now()
  if (!firstChunkAt) {
    firstChunkAt = now
    await DebugSessionTrace.event({
      tag: "llm.stream.firstChunk",
      sessionID,
      durationMs: now - startedAt,
      meta: { providerID, modelID },
    })
  }
  lastChunkAt = now
}

await DebugSessionTrace.event({
  tag: "llm.stream.finish",
  sessionID,
  durationMs: Date.now() - startedAt,
  count: totalChunks,
  meta: { firstChunkDelayMs: firstChunkAt ? firstChunkAt - startedAt : undefined, silentGapMaxMs },
})

// message-v2.ts / session.ts / bus/index.ts / bus/global.ts
void DebugSessionTrace.count({ sessionID, bucket: "event.window", field: "deltaCount", value: 1 })
void DebugSessionTrace.count({ sessionID, bucket: "event.window", field: "partUpdatedCount", value: 1 })
void DebugSessionTrace.count({ sessionID, bucket: "event.window", field: "globalEmitCount", value: 1 })

// acp/agent.ts
await DebugSessionTrace.event({
  tag: "acp.delta.received",
  sessionID: props.sessionID,
  meta: { messageID: props.messageID, partID: props.partID, field: props.field },
})

const fetchStartedAt = Date.now()
const message = await this.sdk.session.message(/* existing args */)
await DebugSessionTrace.event({
  tag: "acp.sessionMessage.fetch",
  sessionID: props.sessionID,
  durationMs: Date.now() - fetchStartedAt,
  meta: { messageID: props.messageID },
})
await DebugSessionTrace.count({ sessionID: props.sessionID, bucket: "acp.window", field: "fetchCount", value: 1 })
await DebugSessionTrace.count({
  sessionID: props.sessionID,
  bucket: "acp.window",
  field: "fetchDurationMs",
  value: Date.now() - fetchStartedAt,
})
```

- [ ] **Step 4: 再跑 helper 测试，确认事件/ACP 聚合格式通过**

Run: `bun run --cwd packages/opencode test test/util/debug-session-trace.test.ts`

Expected: PASS。

---

### Task 4: 全量验证、生成物检查与手工复现说明

**Files:**

- Verify only

- [ ] **Step 1: 运行受影响测试集**

Run:

```bash
bun run --cwd packages/opencode test test/util/debug-session-trace.test.ts
bun run --cwd packages/opencode test test/server/httpapi-session.test.ts
bun run --cwd packages/opencode test test/server/webgui-app-route.test.ts
```

Expected: PASS。

- [ ] **Step 2: 运行受影响包类型检查**

Run: `bun run --cwd packages/opencode typecheck`

Expected: PASS。

- [ ] **Step 3: 进行本地手工复现并确认日志产物**

Run:

```bash
bun run --cwd packages/opencode --conditions=browser src/index.ts web --hostname 127.0.0.1 --port 4096 --print-logs
```

Manual steps:

1. 在浏览器打开 `http://127.0.0.1:4096/app`
2. 确认 `/path` 返回的 `worktree` 与 `directory` 都是 `D:\Caiqy\Projects\Github\opencode-ide-plugin`
3. 打开会话 `ses_2274347feffeSe8hdZh7osiw0n`
4. 发送一条 `继续`
5. 在体感卡顿期间，触发一个轻量对照动作：查看状态或打开一个小会话
6. 结束后收集 `.opencode-debug/debug-session-trace-*.jsonl`

Expected: 生成至少一个 JSONL 日志文件，且其中同时包含：

- `http.request.start` / `http.request.finish`
- `prompt.enter`
- `step.start` / `step.finish`
- `llm.stream.*`
- `event.window`
- `acp.sessionMessage.fetch` 或 `acp.window`

- [ ] **Step 4: 准备回传说明，指导后续日志分析**

交付给验证者的最小说明应包含：

```text
请回传 .opencode-debug/debug-session-trace-*.jsonl。
复现时请只围绕会话 ses_2274347feffeSe8hdZh7osiw0n 操作，主动作是发送“继续”。
如果页面出现卡顿，请在卡顿期间额外做一个轻量对照动作（如打开小会话或查看状态），这样日志里能同时看到目标链路与探针请求。
```

---

## 计划自检

- **Spec coverage:**
  - 目标会话定点埋点 → Task 1-3
  - 独立 JSONL 文件 → Task 1
  - HTTP / prompt / processor / llm / summary / event / ACP 覆盖 → Task 2-3
  - 复现与日志回传流程 → Task 4
- **Placeholder scan:** 已去除 TBD/TODO 类表述，所有任务都给出明确文件、命令与预期结果。
- **Type consistency:** helper 统一使用 `createDebugSessionTrace`、`DebugSessionTrace`、`TARGET_DEBUG_SESSION_ID` 这组命名，后续任务保持一致。
