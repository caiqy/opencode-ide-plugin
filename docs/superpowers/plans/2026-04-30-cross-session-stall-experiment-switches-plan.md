# 跨会话卡顿实验开关 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为长会话卡顿问题增加两个本地实验开关，用最小行为改动快速验证 `summary.summarize()` 与 `summary -> diffFull` 是否是跨会话生成变慢的主要原因。

**Architecture:** 在 `prompt.ts`、`processor.ts`、`summary.ts` 三处增加环境变量控制，只在实验模式下跳过目标路径；同时保留最小 trace 事件，确保实验结果既可体感观察，也能通过 JSONL 时间线验证。测试以 TDD 方式先锁定开关行为，再补 trace 断言，最后回归 typecheck 与关键测试。

**Tech Stack:** TypeScript, Bun, Effect, bun:test, JSONL trace.

---

## 文件结构

- Modify: `packages/opencode/src/session/prompt.ts`
  - 控制首轮 summary 是否跳过。
- Modify: `packages/opencode/src/session/processor.ts`
  - 控制 step-finish 后的 summary 是否跳过。
- Modify: `packages/opencode/src/session/summary.ts`
  - 控制 `diffFull` 是否跳过，并补 `summary.skipped` / `summary.diff.skipped` trace。
- Modify: `packages/opencode/src/util/debug-session-trace.ts`
  - 如有必要，补辅助 trace tag 或 `force` 行为。
- Modify: `packages/opencode/test/util/debug-session-trace.test.ts`
  - 覆盖新 trace tag 的写入行为。
- Modify: `packages/opencode/test/server/httpapi-session.test.ts`
  - 验证实验模式下请求仍会输出 trace 文件。

---

### Task 1: 先用测试锁定实验开关行为

**Files:**

- Modify: `packages/opencode/test/util/debug-session-trace.test.ts`
- Modify: `packages/opencode/test/server/httpapi-session.test.ts`

- [ ] **Step 1: 为 `summary.skipped` / `summary.diff.skipped` 增加失败测试**

```ts
test("writes skipped summary trace rows", async () => {
  await using tmp = await tmpdir()
  const trace = createDebugSessionTrace({ directory: tmp.path, sessionID: TARGET_DEBUG_SESSION_ID })

  await trace.event({ tag: "summary.skipped", sessionID: TARGET_DEBUG_SESSION_ID, meta: { reason: "disabled" } })
  await trace.event({ tag: "summary.diff.skipped", sessionID: TARGET_DEBUG_SESSION_ID, meta: { reason: "skip-diff" } })

  const rows = (await Bun.file(trace.file).text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))

  expect(rows).toEqual([
    expect.objectContaining({ tag: "summary.skipped" }),
    expect.objectContaining({ tag: "summary.diff.skipped" }),
  ])
})
```

- [ ] **Step 2: 运行测试，确认在生产代码支持前先失败**

Run: `bun run --cwd packages/opencode test test/util/debug-session-trace.test.ts`

Expected: FAIL，或缺少对应行为断言。

- [ ] **Step 3: 为 HTTP/session 回归保留最小 trace 断言**

```ts
test("writes forced trace rows for status probes", async () => {
  await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
  const headers = { "x-opencode-directory": tmp.path }

  const response = await app().request(SessionPaths.status, { headers })

  expect(response.status).toBe(200)
  const debugFile = await waitForDebugFile(path.join(tmp.path, ".opencode-debug"))
  expect(debugFile).toBeTruthy()
})
```

- [ ] **Step 4: 运行 HTTP API 测试，确认当前基线仍受保护**

Run: `bun run --cwd packages/opencode test test/server/httpapi-session.test.ts`

Expected: PASS 或仅新断言失败。

---

### Task 2: 实现“禁用 summary”实验开关

**Files:**

- Modify: `packages/opencode/src/session/prompt.ts`
- Modify: `packages/opencode/src/session/processor.ts`
- Modify: `packages/opencode/src/session/summary.ts`

- [ ] **Step 1: 在 `prompt.ts` 首轮 summary 触发前加入环境变量判断**

```ts
const disableSummary = process.env.OPENCODE_DEBUG_DISABLE_SUMMARY === "1" && trace.shouldTrace({ sessionID })

if (step === 1) {
  if (disableSummary) {
    void trace.event({
      tag: "summary.skipped",
      sessionID,
      meta: { reason: "disabled-in-prompt", step },
    })
  } else {
    yield * summary.summarize({ sessionID, messageID: lastUser.id }).pipe(Effect.ignore, Effect.forkIn(scope))
  }
}
```

- [ ] **Step 2: 在 `processor.ts` 的 `finish-step` 后加入相同判断**

```ts
const disableSummary =
  globalThis.process.env.OPENCODE_DEBUG_DISABLE_SUMMARY === "1" && trace.shouldTrace({ sessionID: input.sessionID })

if (disableSummary) {
  void trace.event({
    tag: "summary.skipped",
    sessionID: ctx.sessionID,
    meta: { reason: "disabled-in-processor", messageID: ctx.assistantMessage.parentID },
  })
} else {
  yield *
    summary
      .summarize({
        sessionID: ctx.sessionID,
        messageID: ctx.assistantMessage.parentID,
      })
      .pipe(Effect.ignore, Effect.forkIn(scope))
}
```

- [ ] **Step 3: 跑单测与类型检查，确认开关只影响实验分支**

Run: `bun run --cwd packages/opencode test test/util/debug-session-trace.test.ts && bun run --cwd packages/opencode typecheck`

Expected: PASS。

---

### Task 3: 实现“只跳过 summary diff”实验开关

**Files:**

- Modify: `packages/opencode/src/session/summary.ts`

- [ ] **Step 1: 在 `summary.summarize()` 内为 `diffFull` 加实验判断**

```ts
const skipSummaryDiff =
  process.env.OPENCODE_DEBUG_SKIP_SUMMARY_DIFF === "1" && trace.shouldTrace({ sessionID: input.sessionID })

const diffs = skipSummaryDiff ? [] : yield * computeDiff({ messages: all })

if (skipSummaryDiff) {
  yield *
    Effect.sync(() => {
      void trace.event({
        tag: "summary.diff.skipped",
        sessionID: input.sessionID,
        meta: { messageID: input.messageID },
      })
    })
}
```

- [ ] **Step 2: 保持 `summary.start/finish` 与后续写入逻辑可观测**

```ts
yield *
  Effect.sync(() => {
    void trace.event({
      tag: "summary.finish",
      sessionID: input.sessionID,
      durationMs: Date.now() - startedAt,
      meta: { messageID: input.messageID, diffFiles: diffs.length },
    })
  })
```

- [ ] **Step 3: 回归运行关键测试**

Run: `bun run --cwd packages/opencode test test/util/debug-session-trace.test.ts test/server/httpapi-session.test.ts`

Expected: PASS。

---

### Task 4: 做最终验证并准备 3 轮实验

**Files:**

- Modify: `packages/opencode/src/util/debug-session-trace.ts`
- Modify: `packages/opencode/src/session/prompt.ts`
- Modify: `packages/opencode/src/session/processor.ts`
- Modify: `packages/opencode/src/session/summary.ts`

- [x] **Step 1: 运行最终验证命令**

Run: `bun run --cwd packages/opencode test test/util/debug-session-trace.test.ts && bun run --cwd packages/opencode test test/server/httpapi-session.test.ts && bun run --cwd packages/opencode test test/server/webgui-app-route.test.ts && bun run --cwd packages/opencode typecheck`

Expected: 全部 PASS。

- [x] **Step 2: 记录 3 轮实验命令**

```powershell
# 基线
$env:OPENCODE_DEBUG_DISABLE_SUMMARY=$null
$env:OPENCODE_DEBUG_SKIP_SUMMARY_DIFF=$null

# 关闭 summary
$env:OPENCODE_DEBUG_DISABLE_SUMMARY="1"
$env:OPENCODE_DEBUG_SKIP_SUMMARY_DIFF=$null

# 仅跳过 summary diff
$env:OPENCODE_DEBUG_DISABLE_SUMMARY=$null
$env:OPENCODE_DEBUG_SKIP_SUMMARY_DIFF="1"
```

- [x] **Step 3: 准备实验判读标准**

```text
- 若关闭 summary 后长会话与小会话均明显恢复：优先修复 summary 链路
- 若仅跳过 diffFull 即明显恢复：优先修复 summary -> snapshot.diffFull
- 若两者都无明显改善：转查 snapshot.track/patch、SyncEvent/DB、SSE/前端消费
```

### Task 4 复核产物

#### 最终验证记录

- 时间：2026-04-30
- 命令：`bun run --cwd packages/opencode test test/util/debug-session-trace.test.ts && bun run --cwd packages/opencode test test/server/httpapi-session.test.ts && bun run --cwd packages/opencode test test/server/webgui-app-route.test.ts && bun run --cwd packages/opencode typecheck`
- 结果：PASS

#### 3 轮实验命令

```powershell
# 基线
$env:OPENCODE_DEBUG_DISABLE_SUMMARY=$null
$env:OPENCODE_DEBUG_SKIP_SUMMARY_DIFF=$null

# 关闭 summary
$env:OPENCODE_DEBUG_DISABLE_SUMMARY="1"
$env:OPENCODE_DEBUG_SKIP_SUMMARY_DIFF=$null

# 仅跳过 summary diff
$env:OPENCODE_DEBUG_DISABLE_SUMMARY=$null
$env:OPENCODE_DEBUG_SKIP_SUMMARY_DIFF="1"
```

补充说明：默认目标会话是 `ses_2274347feffeSe8hdZh7osiw0n`。如需对非默认会话做同样实验，额外设置 `OPENCODE_DEBUG_SESSION_TRACE=<sessionID>`。

#### 判读标准

```text
- 若关闭 summary 后长会话与小会话均明显恢复：优先修复 summary 链路
- 若仅跳过 diffFull 即明显恢复：优先修复 summary -> snapshot.diffFull
- 若两者都无明显改善：转查 snapshot.track/patch、SyncEvent/DB、SSE/前端消费
```
