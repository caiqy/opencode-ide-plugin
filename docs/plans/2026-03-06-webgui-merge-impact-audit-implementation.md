# WebGUI merge 影响约束 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 只针对 merge 审计里已证实的两项影响补齐回归约束，并为必要的兼容修复预留最小入口。

**Architecture:** 先用现有测试文件把后端错误分类、auto-compaction、WebGUI 可见反馈、Gemini schema 边界逐项锁死，再只在对应运行链入口做最小修复。实现范围严格收敛在 `packages/opencode` 与 embedded WebGUI 当前已接入路径，不扩展到 workspace 路由或 v2 client 迁移。

**Tech Stack:** Bun test、Vitest、TypeScript、embedded WebGUI、OpenCode session/provider pipeline。

---

### Task 1: 锁定后端 overflow/error 分类回归测试

**Files:**

- Modify: `packages/opencode/test/session/message-v2.test.ts`
- Modify: `packages/opencode/test/session/retry.test.ts`
- Modify: `packages/opencode/src/provider/error.ts`
- Modify: `packages/opencode/src/session/message-v2.ts`

**Step 1: 写失败测试**

在 `packages/opencode/test/session/message-v2.test.ts` 追加两条用例，先把 merge 后必须稳定的分类语义锁住：

```ts
test("keeps gemini overflow api errors as ContextOverflowError", () => {
  const error = new APICallError({
    message: "The input token count (1196265) exceeds the maximum number of tokens allowed (1048575)",
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent",
    requestBodyValues: {},
    statusCode: 400,
    responseHeaders: { "content-type": "application/json" },
    responseBody: '{"error":{"code":400,"message":"context overflow"}}',
    isRetryable: false,
  })

  const result = MessageV2.fromError(error, { providerID: "google" })
  expect(result.name).toBe("ContextOverflowError")
})

test("keeps non-overflow provider failures as APIError", () => {
  const error = new APICallError({
    message: "Quota exceeded. Check your plan and billing details.",
    url: "https://example.com",
    requestBodyValues: {},
    statusCode: 429,
    responseHeaders: { "content-type": "application/json" },
    responseBody: '{"error":{"code":"insufficient_quota"}}',
    isRetryable: false,
  })

  const result = MessageV2.fromError(error, { providerID: "google" })
  expect(result.name).toBe("APIError")
})
```

在 `packages/opencode/test/session/retry.test.ts` 追加一条用例，锁定 overflow 不进入 retry：

```ts
test("does not retry gemini overflow api errors", () => {
  const error = new MessageV2.ContextOverflowError({
    message: "The input token count exceeds the maximum number of tokens allowed",
    responseBody: '{"error":{"code":"context_length_exceeded"}}',
  }).toObject()

  expect(SessionRetry.retryable(error)).toBeUndefined()
})
```

**Step 2: 运行失败测试确认约束缺口**

Run (workdir=`packages/opencode`):

```bash
bun test test/session/message-v2.test.ts --test-name-pattern "keeps gemini overflow api errors as ContextOverflowError|keeps non-overflow provider failures as APIError"
bun test test/session/retry.test.ts --test-name-pattern "does not retry gemini overflow api errors"
```

Expected: 至少一条 FAIL，暴露当前 overflow 判定或错误映射还没有完全覆盖审计确认的语义边界。

**Step 3: 写最小实现**

只在以下入口补最小兼容修复，不扩散到别的 provider 语义：

- `packages/opencode/src/provider/error.ts`：把 overflow 判定继续限定在 `ProviderError.parseAPICallError(...)` 内，必要时只补充 Gemini/Google 已证实的 message 模式或 `responseBody` 解析分支。
- `packages/opencode/src/session/message-v2.ts`：保持 `parsed.type === "context_overflow"` 时统一产出 `MessageV2.ContextOverflowError`，其余错误继续落到 `MessageV2.APIError`。

最小实现目标：

```ts
if (parsed.type === "context_overflow") {
  return new MessageV2.ContextOverflowError({
    message: parsed.message,
    responseBody: parsed.responseBody,
  }).toObject()
}
```

**Step 4: 再验证**

Run (workdir=`packages/opencode`):

```bash
bun test test/session/message-v2.test.ts
bun test test/session/retry.test.ts
```

Expected: 新增用例 PASS，且已有 `ContextOverflowError`/retry 相关用例不回退。

**Step 5: Commit**

```bash
git add packages/opencode/test/session/message-v2.test.ts packages/opencode/test/session/retry.test.ts packages/opencode/src/provider/error.ts packages/opencode/src/session/message-v2.ts
git commit -m "test(session): lock overflow classification and retry boundaries"
```

---

### Task 2: 锁定 compaction/processor 行为回归测试

**Files:**

- Modify: `packages/opencode/test/session/compaction.test.ts`
- Modify: `packages/opencode/test/session/retry.test.ts`
- Modify: `packages/opencode/src/session/processor.ts`

**Step 1: 写失败测试**

先在 `packages/opencode/test/session/compaction.test.ts` 补两条更贴近当前审计结论的约束：

```ts
test("reserves output headroom when limit.input is present", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const model = createModel({ context: 200_000, input: 200_000, output: 32_000 })
      const tokens = { input: 180_000, output: 15_000, reasoning: 0, cache: { read: 3_000, write: 0 } }
      expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
    },
  })
})

test("treats cache.read as part of auto-compaction threshold", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const model = createModel({ context: 100_000, input: 80_000, output: 16_000 })
      const tokens = { input: 60_000, output: 2_000, reasoning: 0, cache: { read: 10_000, write: 0 } }
      expect(await SessionCompaction.isOverflow({ tokens, model })).toBe(true)
    },
  })
})
```

再在 `packages/opencode/test/session/retry.test.ts` 补一条 processor 结果边界用例说明，名字直接约束后续实现方向：

```ts
test("context overflow remains stop-or-compact boundary instead of retry", () => {
  const error = new MessageV2.ContextOverflowError({
    message: "Input exceeds context window of this model",
    responseBody: '{"error":{"code":"context_length_exceeded"}}',
  }).toObject()

  expect(SessionRetry.retryable(error)).toBeUndefined()
})
```

**Step 2: 运行失败测试确认问题存在**

Run (workdir=`packages/opencode`):

```bash
bun test test/session/compaction.test.ts --test-name-pattern "reserves output headroom when limit.input is present|treats cache.read as part of auto-compaction threshold"
bun test test/session/retry.test.ts --test-name-pattern "context overflow remains stop-or-compact boundary instead of retry"
```

Expected: `compaction.test.ts` 至少一条 FAIL，证明 auto-compaction 阈值还没有被完整锁死。

**Step 3: 写最小实现**

实现只落在 `packages/opencode/src/session/processor.ts` 的现有决策点，不引入新流程：

- 保持 `needsCompaction` 只由 `SessionCompaction.isOverflow({ tokens, model })` 控制。
- 保持异常分支对 `ContextOverflowError` 不走 retry。
- 保持尾部返回顺序优先 `"compact"`，再 `"stop"`，避免 compaction 场景被错误吞成普通停止。

最小实现检查点：

```ts
if (await SessionCompaction.isOverflow({ tokens: usage.tokens, model: input.model })) {
  needsCompaction = true
}

const retry = SessionRetry.retryable(error)
if (retry !== undefined) {
  // only retry true APIError path
}

if (needsCompaction) return "compact"
if (input.assistantMessage.error) return "stop"
```

**Step 4: 再验证**

Run (workdir=`packages/opencode`):

```bash
bun test test/session/compaction.test.ts
bun test test/session/retry.test.ts
```

Expected: compaction 阈值、overflow 非重试、processor 返回边界全部稳定通过。

**Step 5: Commit**

```bash
git add packages/opencode/test/session/compaction.test.ts packages/opencode/test/session/retry.test.ts packages/opencode/src/session/processor.ts
git commit -m "fix(session): preserve compaction and overflow processor boundaries"
```

---

### Task 3: 锁定 WebGUI 对 overflow/compaction 的可见行为

**Files:**

- Modify: `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.test.tsx`
- Modify: `packages/opencode/webgui/src/App.test.tsx`
- Modify: `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts`
- Modify: `packages/opencode/webgui/src/App.tsx`

**Step 1: 写失败测试**

在 `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.test.tsx` 追加两条用例，锁定用户可见反馈：

```tsx
it("prompt overflow 时展示后端返回文案并恢复 idle", async () => {
  mocks.prompt.mockRejectedValue(new Error("Input exceeds context window of this model"))

  const { result } = renderHook(() =>
    useMessageInput({
      sessionID: "s-overflow",
      editor,
      isEmpty: false,
      selectedProviderId: "google",
      selectedModelId: "gemini-2.5-pro",
      selectedAgent: "build",
      selectedVariant: undefined,
      extractMessageParts: vi.fn(() => [{ type: "text", text: "x".repeat(10) }]),
    }),
  )

  await act(async () => {
    await result.current.handleSubmit()
  })

  expect(mocks.showToast).toHaveBeenCalledWith("Input exceeds context window of this model", expect.any(Object))
  expect(mocks.setSessionIdle).toHaveBeenCalledWith("s-overflow", true)
})

it("summarize 返回错误时显示压缩失败 toast", async () => {
  mocks.summarize.mockResolvedValue({
    data: null,
    error: { data: { message: "Input exceeds context window of this model" } },
  })

  await act(async () => {
    await result.current.handleCompact(vi.fn())
  })

  expect(mocks.showToast).toHaveBeenCalledWith("Input exceeds context window of this model", expect.any(Object))
})
```

在 `packages/opencode/webgui/src/App.test.tsx` 追加一条事件侧用例，锁定 compaction 可见提示：

```tsx
it("session.compacted 仅对当前会话显示中文提示", () => {
  const showToast = vi.fn()
  const setSessionIdle = vi.fn()

  handleSessionUiEvent(
    { type: "session.compacted", properties: { sessionID: "s1" } },
    { currentSessionID: "s1", showToast, setSessionIdle },
  )

  expect(showToast).toHaveBeenCalledWith("会话历史已压缩以节省空间", {
    title: "会话已压缩",
    variant: "info",
    duration: 5000,
  })
})
```

**Step 2: 运行失败测试**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/MessageInput/hooks/useMessageInput.test.tsx
bun run test:run src/App.test.tsx
```

Expected: 至少一条 FAIL，说明当前 WebGUI 还缺少稳定的 overflow/compaction 可见行为约束，或缺少可测试入口。

**Step 3: 写最小实现**

只补现有 UI 分支，不重做消息流：

- `packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts`：保持发送失败直接展示后端 message，并确保失败后总会 `setSessionIdle(sessionID, true)`。
- `packages/opencode/webgui/src/App.tsx`：把 `session.idle` / `session.compacted` 的 UI 分支抽成一个最小 helper，例如 `handleSessionUiEvent(...)`，只为测试复用，不改变运行时行为。

最小实现目标：

```ts
showToast(error.message, {
  title: "发送失败",
  variant: "error",
  duration: 8000,
})
setSessionIdle(sessionID, true)
```

```ts
if (event.type === "session.compacted" && currentSessionID === event.properties.sessionID) {
  showToast("会话历史已压缩以节省空间", {
    title: "会话已压缩",
    variant: "info",
    duration: 5000,
  })
}
```

**Step 4: 再验证**

Run (workdir=`packages/opencode/webgui`):

```bash
bun run test:run src/components/MessageInput/hooks/useMessageInput.test.tsx src/App.test.tsx
```

Expected: overflow toast、idle 恢复、compaction 提示都稳定通过，且不影响现有 WebGUI 测试。

**Step 5: Commit**

```bash
git add packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.test.tsx packages/opencode/webgui/src/App.test.tsx packages/opencode/webgui/src/components/MessageInput/hooks/useMessageInput.ts packages/opencode/webgui/src/App.tsx
git commit -m "test(webgui): lock overflow and compaction user-visible behavior"
```

---

### Task 4: 锁定 Gemini tool/MCP schema 回归测试与最小兼容修复

**Files:**

- Modify: `packages/opencode/test/provider/transform.test.ts`
- Modify: `packages/opencode/src/provider/transform.ts`

**Step 1: 写失败测试**

在 `packages/opencode/test/provider/transform.test.ts` 新增两组用例，分别代表内建 tool 与 MCP tool 的 Gemini 边界：

```ts
test("stringifies numeric enum for gemini builtin tool schema", () => {
  const model = { providerID: "google", api: { id: "gemini-2.5-pro" } } as any
  const schema = {
    type: "object",
    properties: {
      level: { type: "integer", enum: [0, 1, 2] },
    },
    required: ["level"],
  } as any

  const result = ProviderTransform.schema(model, schema) as any
  expect(result.properties.level.type).toBe("string")
  expect(result.properties.level.enum).toEqual(["0", "1", "2"])
})

test("drops dangling required and repairs nested array items for gemini mcp schema", () => {
  const model = { providerID: "google", api: { id: "gemini-2.5-pro" } } as any
  const schema = {
    type: "object",
    properties: {
      payload: {
        type: "object",
        properties: {
          rows: {
            type: "array",
            items: {
              type: "array",
              items: {},
              required: ["bad"],
            },
          },
        },
        required: ["rows", "missing"],
      },
    },
  } as any

  const result = ProviderTransform.schema(model, schema) as any
  expect(result.properties.payload.required).toEqual(["rows"])
  expect(result.properties.payload.properties.rows.items.items.type).toBe("string")
  expect(result.properties.payload.properties.rows.items.required).toBeUndefined()
})
```

**Step 2: 运行失败测试**

Run (workdir=`packages/opencode`):

```bash
bun test test/provider/transform.test.ts --test-name-pattern "stringifies numeric enum for gemini builtin tool schema|drops dangling required and repairs nested array items for gemini mcp schema"
```

Expected: 若 merge 引入了新的 schema 形态但清洗逻辑还不完整，这里会直接 FAIL。

**Step 3: 写最小实现**

只在 `packages/opencode/src/provider/transform.ts` 的 `sanitizeGemini(...)` 内补兼容，不改 schema 调用链：

- 保持 numeric enum 全量转字符串。
- 只在 `type === "object"` 时保留 `properties`/`required`。
- 对 Gemini nested array 缺失 `items` 的场景补最小 `type`。
- 过滤掉指向不存在字段的 `required`。

最小实现目标：

```ts
if (key === "enum" && Array.isArray(value)) {
  result[key] = value.map((v) => String(v))
  if (result.type === "integer" || result.type === "number") result.type = "string"
}

if (result.type === "object" && result.properties && Array.isArray(result.required)) {
  result.required = result.required.filter((field) => field in result.properties)
}

if (result.type === "array") {
  if (result.items == null) result.items = {}
  if (typeof result.items === "object" && !Array.isArray(result.items) && !result.items.type) {
    result.items.type = "string"
  }
}
```

**Step 4: 再验证**

Run (workdir=`packages/opencode`):

```bash
bun test test/provider/transform.test.ts
```

Expected: 新增 Gemini builtin/MCP schema 用例与现有 transform 用例一起通过。

**Step 5: Commit**

```bash
git add packages/opencode/test/provider/transform.test.ts packages/opencode/src/provider/transform.ts
git commit -m "fix(provider): keep gemini tool and mcp schema compatibility"
```

---

### 暂不实施项

- 不在本计划内实现 workspace 路由接入或 workspace header 透传。
- 不在本计划内实施 v2 client 迁移，也不把 v2 SDK 生成代码变化当作当前 embedded WebGUI 回归修复的一部分。
- 若后续需要处理这两项，只新开跟踪计划，并在当前四个任务完成后重新审计影响面。

---

### 后续跟踪

- 回归执行顺序固定为 Task 1 → Task 2 → Task 3 → Task 4，先锁后端语义，再锁前端可见行为，最后收口 Gemini 兼容入口。
- 每个任务完成后都先跑对应最小命令，再跑对应整文件回归，避免一次性扩大排查面。
- 若 Task 4 验证后仍发现 Gemini 运行时问题，只允许继续收敛在 `packages/opencode/src/provider/transform.ts`，不要顺势扩展到 workspace 或 v2 client 方案。
