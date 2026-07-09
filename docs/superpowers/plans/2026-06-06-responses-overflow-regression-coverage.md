# Responses Overflow Regression Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 Responses overflow 修复在 provider error、AI SDK raw chunk、Azure Responses 和 WebGUI 呈现上的关键回归保护。

**Architecture:** 只在 `parseAPICallError()` 增补 `context_too_large` 的 code-based overflow 识别，其余优先通过测试锁定既有行为，不额外重构 runtime 分层。测试从底层错误解析、到 AI SDK request 契约、再到 WebGUI synthetic error 清理形成闭环。

**Tech Stack:** Bun test、Vitest、Effect、AI SDK runtime、MessagesContext

---

### Task 1: 锁定非流式 `context_too_large` overflow 回归

**Files:**

- Modify: `packages/opencode/test/provider/error.test.ts`
- Modify: `packages/opencode/src/provider/error.ts`
- Test: `packages/opencode/test/provider/error.test.ts`

- [ ] **Step 1: 写一个红灯测试，证明普通 JSON error 的 `context_too_large` 也应进入 overflow**

把下面测试追加到 `describe("ProviderError.parseAPICallError", ...)` 内：

```ts
test("recognises non-stream context_too_large API errors as context overflow", () => {
  const input = {
    error: {
      message: "Bad Request",
      url: "https://example.com",
      requestBodyValues: {},
      statusCode: 400,
      responseHeaders: { "content-type": "application/json" },
      responseBody: JSON.stringify({
        error: {
          code: "context_too_large",
          message: "Your input exceeds the context window of this model.",
        },
      }),
      isRetryable: false,
    },
    providerID: ProviderID.make("openai"),
  }

  expect(ProviderError.parseAPICallError(input as any)).toStrictEqual({
    type: "context_overflow",
    message: "Bad Request: Your input exceeds the context window of this model.",
    responseBody: JSON.stringify({
      error: {
        code: "context_too_large",
        message: "Your input exceeds the context window of this model.",
      },
    }),
  })
})
```

- [ ] **Step 2: 运行新测试，确认先红灯**

Run:

```bash
bun test test/provider/error.test.ts --test-name-pattern "recognises non-stream context_too_large API errors as context overflow"
```

Expected: FAIL，当前实现仍只按 `context_length_exceeded` 的 code 做判断。

- [ ] **Step 3: 做最小实现**

把 `packages/opencode/src/provider/error.ts` 中这段：

```ts
if (isOverflow(m) || input.error.statusCode === 413 || body?.error?.code === "context_length_exceeded") {
```

改成：

```ts
if (
  isOverflow(m) ||
  input.error.statusCode === 413 ||
  body?.error?.code === "context_length_exceeded" ||
  body?.error?.code === "context_too_large"
) {
```

- [ ] **Step 4: 重新运行测试，确认转绿**

Run:

```bash
bun test test/provider/error.test.ts --test-name-pattern "recognises non-stream context_too_large API errors as context overflow"
```

Expected: PASS。

### Task 2: 锁定 `includeRawChunks` 顶层契约与 Azure Responses 分叉

**Files:**

- Modify: `packages/opencode/test/session/llm.test.ts`
- Test: `packages/opencode/test/session/llm.test.ts`

- [ ] **Step 1: 为 OpenAI/Azure 请求新增红灯测试，直接检查请求体契约**

在 `packages/opencode/test/session/llm.test.ts` 现有请求捕获 helper 附近新增测试，分别覆盖：

```ts
test("sends OpenAI Responses requests with raw chunk support enabled", async () => {
  // 复用现有 mock server / waitRequest helper，断言请求成功到达 /responses
  // 且当前行为不会依赖 providerOptions.openai.includeRawChunks。
})

test("keeps Azure Responses on raw chunks unless useCompletionUrls is true", async () => {
  // 同一组 helper 下，分别对 Azure Responses 与 Azure Chat Completions 分支发请求，
  // 断言两条路径都能成功完成，并用已有 raw error 行为覆盖锁定分叉。
})
```

这一步的关键不是新建大而全的 harness，而是复用当前文件已经存在的 `waitRequest(...)`、`drain(...)`、`openAIConfig(...)` 风格，增加最小断言。

- [ ] **Step 2: 运行定向测试，确认至少有一条先红灯**

Run:

```bash
bun test test/session/llm.test.ts --test-name-pattern "raw chunk support|Azure Responses"
```

Expected: FAIL，如果当前测试还没直接锁定调用契约，应至少出现一个断言缺口。

- [ ] **Step 3: 在同文件补一条 Azure top-level overflow 行为测试**

新增一条 adapter / runtime 级用例，结构参考现有 OpenAI top-level raw error 测试，但把 provider 场景切到 Azure Responses，验证：

```ts
expect(events).toEqual([
  {
    type: "provider-error",
    message: "Your input exceeds the context window of this model. Please adjust your input and try again.",
    code: "context_too_large",
  },
])
```

如果现有实现已经正确，这条测试可能直接是绿灯；这没问题，重点是把 Azure 路径显式锁住。

- [ ] **Step 4: 运行同文件相关测试**

Run:

```bash
bun test test/session/llm.test.ts --test-name-pattern "context_too_large|raw chunk support|Azure Responses"
```

Expected: PASS。

### Task 3: 锁定 WebGUI 不残留泛化错误文案

**Files:**

- Modify: `packages/opencode/webgui/src/state/MessagesContext.session-error.test.tsx`
- Test: `packages/opencode/webgui/src/state/MessagesContext.session-error.test.tsx`

- [ ] **Step 1: 写一个更贴近用户症状的用例**

在现有 `session.compacted 会清理之前的合成会话错误` 测试后追加：

```tsx
it("session.compacted 后不会残留 Provider stream finished with error 文案", () => {
  const emitter = new EventEmitter()

  render(
    <MessagesProvider emitter={emitter}>
      <Capture />
    </MessagesProvider>,
  )

  act(() => {
    emitter.emit({
      type: "session.error",
      properties: {
        sessionID: "s1",
        error: {
          name: "UnknownError",
          message: "Provider stream finished with error",
        },
      },
    })
  })

  expect(api?.getMessagesBySession("s1")[0]?.parts[0]).toMatchObject({
    type: "session-error",
    message: "Provider stream finished with error",
  })

  act(() => {
    emitter.emit({
      type: "session.compacted",
      properties: { sessionID: "s1" },
    })
  })

  expect(api?.getMessagesBySession("s1")).toEqual([])
})
```

- [ ] **Step 2: 运行前端定向测试**

Run:

```bash
bun run test:run src/state/MessagesContext.session-error.test.tsx
```

Expected: PASS；如果失败，只修测试或最小状态逻辑，不扩大 UI 行为面。

### Task 4: 回归验证与收尾检查

**Files:**

- Test: `packages/opencode/test/provider/error.test.ts`
- Test: `packages/opencode/test/session/llm.test.ts`
- Test: `packages/opencode/test/session/processor-effect.test.ts`
- Test: `packages/opencode/webgui/src/state/MessagesContext.session-error.test.tsx`

- [ ] **Step 1: 运行 provider error 回归**

Run:

```bash
bun test test/provider/error.test.ts
```

Expected: PASS。

- [ ] **Step 2: 运行 session llm 回归**

Run:

```bash
bun test test/session/llm.test.ts
```

Expected: PASS。

- [ ] **Step 3: 运行 processor overflow 回归**

Run:

```bash
bun test test/session/processor-effect.test.ts --test-name-pattern "context_too_large|compaction|overflow"
```

Expected: PASS。

- [ ] **Step 4: 运行 WebGUI session error 回归**

Run:

```bash
bun run test:run src/state/MessagesContext.session-error.test.tsx
```

Expected: PASS。

- [ ] **Step 5: 检查工作区状态**

Run:

```bash
git status --short
```

Expected: 只出现本次相关源码、测试与新增 spec/plan 文档；`response.txt` 继续保持未跟踪且不纳入提交。

## 计划自检

- **Spec coverage:**
  - 非流式 `context_too_large` overflow → Task 1
  - `includeRawChunks` 顶层契约 → Task 2
  - Azure Responses overflow 路径 → Task 2 + Task 4 Step 3
  - WebGUI 不残留泛化错误文案 → Task 3
- **Placeholder scan:** 无 `TODO` / `TBD` / “自行实现” 占位。
- **Type consistency:** 文件路径、测试命令、错误 code、事件名均与当前仓库命名一致。
