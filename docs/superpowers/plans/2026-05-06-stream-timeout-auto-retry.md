# Stream Timeout Auto Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户实际遇到的嵌套型 `stream_timeout` SSE error event 在真实会话链路中触发自动重试，即使该信号在 provider adapter 之后被压平成 `stream_timeout` 文本，也仍然能进入现有退避重试链路，而不是立刻沉淀为前端“会话错误”。

**Architecture:** 保留用户截图中的嵌套 SSE error event 作为输入证据，但按真实运行链路修复：当前 `@ai-sdk/openai-compatible` chat adapter 会把 error chunk 压成 `error.message` 继续向下游传递，因此主要改动点放在 `packages/opencode/src/session/retry.ts`，让 `SessionRetry.retryable()` 识别 `stream_timeout` / `"stream_timeout"` 这类真实链路 message。继续复用 `MessageV2.fromError()`、`SessionRetry.retryable()` 和 `SessionProcessor.process()` 的既有退避重试机制，不新增前端逻辑，也不改 provider adapter。

**Tech Stack:** TypeScript、Bun test、Effect、OpenAI-compatible test LLM server

---

> **命令执行目录约定：** 文中的 `bun test ...` 与 `bun run typecheck` 都在 `packages/opencode/` 目录执行；`git add` / `git commit` 在仓库根目录执行。

## File Structure

- `packages/opencode/src/session/retry.ts`
  - 责任：定义 retryable 错误判定与退避策略。
  - 本次改动：增加对真实链路中 `stream_timeout` / `"stream_timeout"` 文本信号的精确识别，不扩大到其他普通 message。

- `packages/opencode/test/session/message-v2.stream-error.test.ts`
  - 责任：验证 `TypeValidationError` / 结构化流错误经过 `MessageV2.fromError()` 后的归一化结果。
  - 本次改动：保留或补充嵌套型 `stream_timeout` 原始 error event 的解析测试，证明用户截图中的证据能被识别。

- `packages/opencode/test/session/retry.test.ts`
  - 责任：验证 `SessionRetry` 的 delay / retryable 判定和 `MessageV2.fromError()` 相关回归。
  - 本次改动：增加真实链路 message 级用例：`stream_timeout` 与 `"stream_timeout"` 应可重试；其他普通文本不应误判。

- `packages/opencode/test/session/processor-effect.test.ts`
  - 责任：验证 `SessionProcessor` 在真实流式会话中的重试、停止、压缩等行为。
  - 本次改动：增加两条集成测试：
    - “嵌套型 SSE / event 行的 `stream_timeout` 错误帧”触发 retry、第二次成功继续输出
    - “adapter 压平后的 `error.message = \"stream_timeout\"`” 也会触发同一 retry 链路

### Task 1: 保留嵌套型 `stream_timeout` 解析回归测试

**Files:**

- Modify/Test: `packages/opencode/test/session/message-v2.stream-error.test.ts:33-81`

- [ ] **Step 1: 确认并保留截图中的嵌套型 `stream_timeout` 解析测试**

确认 `packages/opencode/test/session/message-v2.stream-error.test.ts` 中保留下面这个测试，用于覆盖用户截图中的原始嵌套 SSE error event 证据：

```ts
test("serializes upstream stream_timeout frames as retryable APIError", () => {
  const input = {
    type: "error",
    sequence_number: 0,
    error: {
      type: "upstream_error",
      code: "stream_timeout",
      message: "stream_timeout",
    },
  }
  const err = new TypeValidationError({
    value: input,
    cause: new Error("bad chunk"),
  })

  const result = MessageV2.fromError(err, { providerID })

  expect(result).toStrictEqual({
    name: "APIError",
    data: {
      message: "stream_timeout",
      isRetryable: true,
      responseBody: JSON.stringify(input),
    },
  })
  expect(SessionRetry.retryable(result)).toBe("stream_timeout")
})
```

- [ ] **Step 2: 运行测试，确认这组回归覆盖保持通过**

Run:

```bash
bun test test/session/message-v2.stream-error.test.ts --timeout 30000
```

Expected: PASS，这组测试只用于保留原始嵌套证据的解析覆盖，不是本次核心红灯入口。

- [ ] **Step 3: 不改生产代码，继续进入真实链路红灯测试**

这一任务不新增生产改动，只确认原始嵌套证据的解析覆盖仍然存在。完成后继续执行 Task 2。

- [ ] **Step 4: 不提交当前状态**

不要提交当前状态。继续进入下一个真实链路红灯测试任务。

### Task 2: 添加 `SessionRetry` 真实链路 message 红灯测试

**Files:**

- Modify/Test: `packages/opencode/test/session/retry.test.ts:126-233`

- [ ] **Step 1: 写入失败测试，锁定真实链路里的 `stream_timeout` 文本应触发自动重试**

把下面两个测试插入到 `packages/opencode/test/session/retry.test.ts` 的 `describe("session.retry.retryable", ...)` 中：

```ts
test("retries plain text stream_timeout errors", () => {
  const error = wrap("stream_timeout")
  expect(SessionRetry.retryable(error)).toBe("stream_timeout")
})

test("retries json-stringified stream_timeout errors", () => {
  const error = wrap(JSON.stringify("stream_timeout"))
  expect(SessionRetry.retryable(error)).toBe("stream_timeout")
})
```

- [ ] **Step 2: 运行测试，确认它们先失败**

Run:

```bash
bun test test/session/retry.test.ts --timeout 30000
```

Expected: FAIL，新增的 `stream_timeout` 文本用例当前会返回 `undefined`，因为现有 retry 判定还不认识这类 plain string / quoted string。

- [ ] **Step 3: 保持代码不变，继续进入下一个红灯任务**

这一任务只创建红灯测试，不修改生产代码。

- [ ] **Step 4: 不提交当前状态**

不要提交失败测试。继续执行 Task 3。

### Task 3: 保留 `SessionProcessor` 的原始证据链回归覆盖

**Files:**

- Modify/Test: `packages/opencode/test/session/processor-effect.test.ts:681-862`

- [ ] **Step 1: 保留嵌套型 SSE / event 行的集成覆盖**

把下面这个测试插入到 `packages/opencode/test/session/processor-effect.test.ts` 中，放在现有 `retries recognized structured json errors` 后面、`publishes retry status attempts` 前面：

```ts
it.live("retries upstream stream_timeout structured errors", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const bus = yield* Bus.Service

        yield* llm.push(
          raw({
            head: [
              {
                type: "error",
                sequence_number: 0,
                error: {
                  type: "upstream_error",
                  code: "stream_timeout",
                  message: "stream_timeout",
                },
              },
            ],
          }),
        )
        yield* llm.text("after")

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "retry timeout")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const states: number[] = []
        const off = yield* bus.subscribeCallback(SessionStatus.Event.Status, (evt) => {
          if (evt.properties.sessionID !== chat.id) return
          if (evt.properties.status.type === "retry") states.push(evt.properties.status.attempt)
        })
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "retry timeout" }],
          tools: {},
        })

        off()

        const parts = MessageV2.parts(msg.id)

        expect(value).toBe("continue")
        expect(yield* llm.calls).toBe(2)
        expect(states).toStrictEqual([1])
        expect(parts.some((part) => part.type === "text" && part.text === "after")).toBe(true)
        expect(handle.message.error).toBeUndefined()
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)
```

- [ ] **Step 2: 运行测试，确认这条原始证据链覆盖保持通过**

Run:

```bash
bun test test/session/processor-effect.test.ts --timeout 30000
```

Expected: PASS，这条测试用于保留用户截图中的原始嵌套 SSE error event 证据在集成层仍然成立；它不是 1/A 的核心红灯入口。

- [ ] **Step 3: 不改生产代码，继续进入 1/A 的主修复任务**

这一任务只保留原始证据链的集成覆盖，不修改生产代码。完成时 Task 1 与 Task 3 应保持通过；Task 2 才是 1/A 的核心红灯入口。

- [ ] **Step 4: 不提交当前状态**

不要提交当前状态。直接继续执行 Task 4，实现最小生产修复。

- [ ] **Step 5: 增加一条锁定 1/A 的 processor 集成测试（作为 Task 4 后的绿灯验证）**

在同一文件里再增加一条集成测试，直接模拟 adapter 压平后的 message 链路。这里的 fixture 故意不再提供 `type/code`，只保留 `error.message`，就是为了复现 adapter flatten 后下游真正参与 `SessionRetry.retryable()` 判定的形态：

```ts
it.live("retries adapter-flattened stream_timeout message errors", () =>
  provideTmpdirServer(
    ({ dir, llm }) =>
      Effect.gen(function* () {
        const { processors, session, provider } = yield* boot()
        const bus = yield* Bus.Service

        yield* llm.push(
          raw({
            head: [
              {
                error: {
                  message: "stream_timeout",
                },
              },
            ],
          }),
        )
        yield* llm.text("after")

        const chat = yield* session.create({})
        const parent = yield* user(chat.id, "retry timeout text")
        const msg = yield* assistant(chat.id, parent.id, path.resolve(dir))
        const mdl = yield* provider.getModel(ref.providerID, ref.modelID)
        const states: number[] = []
        const off = yield* bus.subscribeCallback(SessionStatus.Event.Status, (evt) => {
          if (evt.properties.sessionID !== chat.id) return
          if (evt.properties.status.type === "retry") states.push(evt.properties.status.attempt)
        })
        const handle = yield* processors.create({
          assistantMessage: msg,
          sessionID: chat.id,
          model: mdl,
        })

        const value = yield* handle.process({
          user: {
            id: parent.id,
            sessionID: chat.id,
            role: "user",
            time: parent.time,
            agent: parent.agent,
            model: { providerID: ref.providerID, modelID: ref.modelID },
          } satisfies MessageV2.User,
          sessionID: chat.id,
          model: mdl,
          agent: agent(),
          system: [],
          messages: [{ role: "user", content: "retry timeout text" }],
          tools: {},
        })

        off()

        const parts = MessageV2.parts(msg.id)

        expect(value).toBe("continue")
        expect(yield* llm.calls).toBe(2)
        expect(states).toStrictEqual([1])
        expect(parts.some((part) => part.type === "text" && part.text === "after")).toBe(true)
        expect(handle.message.error).toBeUndefined()
      }),
    { git: true, config: (url) => providerCfg(url) },
  ),
)
```

Run（在完成 Task 4 的生产修复后执行）：

```bash
bun test test/session/processor-effect.test.ts --timeout 30000
```

Expected: PASS，并证明本次实现确实锁住了 1/A，而不是仅依赖结构化解析路径。

### Task 4: 在 `SessionRetry` 层实现最小修复

**Files:**

- Modify: `packages/opencode/src/session/retry.ts:54-103`
- Test: `packages/opencode/test/session/message-v2.stream-error.test.ts`
- Test: `packages/opencode/test/session/retry.test.ts`
- Test: `packages/opencode/test/session/processor-effect.test.ts`

- [ ] **Step 1: 在 `SessionRetry.retryable()` 中加入真实链路 `stream_timeout` message 的精确分支**

把 `packages/opencode/src/session/retry.ts` 中 `retryable()` 的 plain text / JSON string 处理段改成下面这样：

```ts
export function retryable(error: Err) {
  // context overflow errors should not be retried
  if (MessageV2.ContextOverflowError.isInstance(error)) return undefined
  if (MessageV2.APIError.isInstance(error)) {
    const status = error.data.statusCode
    if (!error.data.isRetryable && !(status !== undefined && status >= 500)) return undefined
    if (error.data.responseBody?.includes("FreeUsageLimitError")) return GO_UPSELL_MESSAGE
    return error.data.message.includes("Overloaded") ? "Provider is overloaded" : error.data.message
  }

  const msg = error.data?.message
  if (typeof msg === "string") {
    if (msg === "stream_timeout" || msg === JSON.stringify("stream_timeout")) {
      return "stream_timeout"
    }

    const lower = msg.toLowerCase()
    if (
      lower.includes("rate increased too quickly") ||
      lower.includes("rate limit") ||
      lower.includes("too many requests")
    ) {
      return msg
    }
  }

  const json = iife(() => {
    try {
      if (typeof error.data?.message === "string") {
        return JSON.parse(error.data.message)
      }

      return JSON.parse(error.data.message)
    } catch {
      return undefined
    }
  })

  if (!json || typeof json !== "object") return undefined

  const code = typeof json.code === "string" ? json.code : ""

  if (json.type === "error" && json.error?.type === "too_many_requests") {
    return "Too Many Requests"
  }
  if (code.includes("exhausted") || code.includes("unavailable")) {
    return "Provider is overloaded"
  }
  if (json.type === "error" && typeof json.error?.code === "string" && json.error.code.includes("rate_limit")) {
    return "Rate Limited"
  }
  return undefined
}
```

- [ ] **Step 2: 先跑 `SessionRetry` 测试，确认最小修复已让 message 红灯变绿**

Run:

```bash
bun test test/session/retry.test.ts --timeout 30000
```

Expected: PASS，新增的 `stream_timeout` plain text / quoted string 用例通过，且匹配面不再接受前后空白、无关普通文本、包含 `stream_timeout` 子串的文本，或 `{"code":"stream_timeout"}` 这类 JSON 对象。

- [ ] **Step 3: 再跑 processor 测试，确认真实集成链路也变绿**

Run:

```bash
bun test test/session/processor-effect.test.ts --timeout 30000
```

Expected: PASS，新的 `retries upstream stream_timeout structured errors` 用例通过，并且现有 `retries recognized structured json errors`、`publishes retry status attempts`、`requests compaction on structured context overflow` 也保持通过。

- [ ] **Step 4: 暂不提交，先做回归验证**

修复代码已经写完，但先不要提交。先回到 **Task 3 Step 5** 完成 1/A 的 processor 绿灯验证，再进入 Task 5 补齐相关回归和类型检查。

### Task 5: 回归验证并提交最终改动

**Files:**

- Modify/Test: `packages/opencode/test/session/retry.test.ts`
- Verify: `packages/opencode/test/session/retry.test.ts`
- Verify: `packages/opencode/test/session/message-v2.stream-error.test.ts`
- Verify: `packages/opencode/test/session/processor-effect.test.ts`

- [ ] **Step 1: 运行 `SessionRetry` 回归测试**

Run:

```bash
bun test test/session/retry.test.ts --timeout 30000
```

Expected: PASS，现有 `server_error`、`ECONNRESET`、`ZlibError`、5xx 和非 retryable 4xx 用例都保持通过。

- [ ] **Step 2: 补一个最小反例测试，确保不会误重试其他普通文本 message**

在 `packages/opencode/test/session/retry.test.ts` 中补一条最小反例，验证其他普通文本 message 不会被当作 retryable。

建议测试内容：

```ts
test("does not retry unrelated plain text errors", () => {
  const result = wrap("plain_failure")
  expect(SessionRetry.retryable(result)).toBeUndefined()
})

test("does not retry quoted unrelated plain text errors", () => {
  const result = wrap(JSON.stringify("plain_failure"))
  expect(SessionRetry.retryable(result)).toBeUndefined()
})

test("does not retry messages that only contain stream_timeout as a substring", () => {
  const result = wrap("before stream_timeout after")
  expect(SessionRetry.retryable(result)).toBeUndefined()
})

test("does not retry json objects with stream_timeout code", () => {
  const result = wrap(JSON.stringify({ code: "stream_timeout" }))
  expect(SessionRetry.retryable(result)).toBeUndefined()
})
```

Run:

```bash
bun test test/session/retry.test.ts --timeout 30000
```

Expected: PASS，并证明本次 message 级匹配没有把其他普通文本、带引号的普通文本、包含 `stream_timeout` 子串的文本，或 `{"code":"stream_timeout"}` 这类 JSON 对象误判为 retryable。

- [ ] **Step 3: 在最终变更态下运行定向回归套件**

Run:

```bash
bun test test/session/message-v2.stream-error.test.ts test/session/processor-effect.test.ts test/session/retry.test.ts --timeout 30000
```

Expected: PASS，三个文件全部通过，没有新增 flaky 失败。

- [ ] **Step 4: 运行类型检查**

Run:

```bash
bun run typecheck
```

Expected: PASS，无新增 TypeScript 错误。

- [ ] **Step 5: 提交最终改动**

Run:

```bash
git add packages/opencode/src/session/retry.ts packages/opencode/test/session/retry.test.ts packages/opencode/test/session/message-v2.stream-error.test.ts packages/opencode/test/session/processor-effect.test.ts
git commit -m "fix(session): retry upstream stream timeout errors"
```

Expected: commit 成功，提交只包含本次服务端重试判定修复和对应测试。

## Self-Review

- **Spec coverage：**
  - 保留用户截图中的嵌套型 SSE error 证据：Task 1
  - 修复真实链路里的 `stream_timeout` 文本重试：Task 4
  - 保持前端不改：整份计划只改 `packages/opencode/` 服务端与测试
  - retry 判定测试：Task 2
  - 会话级重试行为测试：Task 3
  - 反例与回归验证：Task 5

- **Placeholder scan：**
  - 无 `TODO` / `TBD`
  - 每个代码改动步骤都附了明确代码块
  - 每个验证步骤都附了精确命令与期望结果

- **Type consistency：**
  - 统一使用 `upstream_error`、`stream_timeout`、`api_error`、`SessionRetry.retryable()`、`MessageV2.fromError()` 这些现有命名
  - 测试里的 `message: "stream_timeout"` 与实现返回值完全一致
