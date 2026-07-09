# 异步 Diff 修复后的排障代码清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 删除这次长会话排障专用的 debug 开关、trace helper、debug-only 测试与本地产物，同时完整保留并重新验证正式异步 Diff 修复链路。

**Architecture:** 这次不是改产品行为，而是把“实验设施”与“正式修复”彻底解耦。实现上先删 `prompt/processor/summary` 里的 debug 分支，再删 `debug-session-trace` 基础设施及其测试，最后重新验证 `SessionSummaryScheduler`、`/session/visibility`、`session.diff.status` 和 Diff 面板轻提示仍按正式链路工作。

**Tech Stack:** TypeScript、Effect、Hono/HttpApi、React 19、Vitest、Bun test

---

## 文件结构

### 后端将修改

- `packages/opencode/src/session/prompt.ts` — 删除 `OPENCODE_DEBUG_DISABLE_SUMMARY` 分支与 `summary.skipped` trace，保留 `markDirty(...)` 正式路径
- `packages/opencode/src/session/processor.ts` — 删除 `OPENCODE_DEBUG_DISABLE_SUMMARY` 分支与 `summary.skipped` trace，保留 `markDirty(...)` 正式路径
- `packages/opencode/src/session/summary.ts` — 删除 `OPENCODE_DEBUG_SKIP_SUMMARY_DIFF` 分支与 `summary.diff.skipped` trace，保留 `canWrite` 和真实 summary/diff 闭环
- `packages/opencode/src/session/session.ts` — 如仍仅因 trace 残留而引入 debug helper，则清理相关 import/引用
- `packages/opencode/src/session/llm.ts` — 删除仅服务排障 trace 的 helper 引用与事件写入
- `packages/opencode/src/bus/index.ts` — 删除仅服务排障计数/trace 的 helper 引用与聚合逻辑
- `packages/opencode/src/acp/agent.ts` — 删除仅服务排障 trace 的 helper 引用
- `packages/opencode/src/server/routes/instance/trace.ts` — 删除 `http.request.start/finish` 的 debug trace 写入
- `packages/opencode/src/server/routes/instance/httpapi/session.ts` — 删除 forced trace/debug file 逻辑，保留正式 `/session/visibility` 路由
- `packages/opencode/src/util/debug-session-trace.ts` — 整文件删除

### 后端测试将修改

- `packages/opencode/test/session/prompt.test.ts` — 删除只验证 debug disable summary 的 case，保留正式 `markDirty` / foreground 生命周期测试
- `packages/opencode/test/session/processor-effect.test.ts` — 删除只验证 debug disable summary 的 case，保留正式 `markDirty` 回归
- `packages/opencode/test/session/summary.test.ts` — 删除只验证 skip summary diff 的 case，保留真实闭环 / 防写回测试
- `packages/opencode/test/server/httpapi-session.test.ts` — 删除只验证 forced trace/debug file 的 case，保留 `/session/visibility` 正式接口测试
- `packages/opencode/test/util/debug-session-trace.test.ts` — 整文件删除

### 本地产物将删除

- `.opencode-debug/` — 删除本地调试 trace 产物目录

### 必须保留的正式链路（不要误删）

- `packages/opencode/src/session/summary-scheduler.ts`
- `packages/opencode/src/session/summary.ts` 中的 `canWrite`
- `packages/opencode/src/session/prompt.ts` / `processor.ts` 中的 `markDirty(...)`
- `packages/opencode/src/server/routes/instance/session.ts` / `httpapi/session.ts` 中的 `/session/visibility`
- `packages/opencode/webgui/src/hooks/useSessionVisibilitySync.ts`
- `packages/opencode/webgui/src/lib/api/events.ts` 中的 `session.diff.status`
- `packages/opencode/webgui/src/state/SessionContext.tsx` 的 `sessionDiffStatus`
- `packages/opencode/webgui/src/components/MessageInput/FooterPanels.tsx`
- `packages/opencode/webgui/src/components/FileChangesPanel.tsx`

---

### Task 1: 删除运行时代码里的 debug 开关与 trace helper 引用

**Files:**

- Modify: `packages/opencode/src/session/prompt.ts`
- Modify: `packages/opencode/src/session/processor.ts`
- Modify: `packages/opencode/src/session/summary.ts`
- Modify: `packages/opencode/src/session/session.ts`
- Modify: `packages/opencode/src/session/llm.ts`
- Modify: `packages/opencode/src/bus/index.ts`
- Modify: `packages/opencode/src/acp/agent.ts`
- Modify: `packages/opencode/src/server/routes/instance/trace.ts`
- Modify: `packages/opencode/src/server/routes/instance/httpapi/session.ts`
- Delete: `packages/opencode/src/util/debug-session-trace.ts`

- [ ] **Step 1: 先写/调整失败测试，锁定正式链路仍应工作但 debug 分支不再存在**

```ts
it.live("prompt step 1 always marks dirty without debug env branches", () =>
  provideTmpdirServer(({ url }) =>
    Effect.gen(function* () {
      const marked: Array<{ sessionID: SessionID; messageID: MessageID }> = []
      const scheduler = Layer.succeed(
        SessionSummaryScheduler.Service,
        SessionSummaryScheduler.Service.of({
          markDirty: (input) =>
            Effect.sync(() => void marked.push({ sessionID: input.sessionID, messageID: input.messageID })),
          foregroundStart: () => Effect.void,
          foregroundFinish: () => Effect.void,
          syncVisible: () => Effect.void,
          deleteSession: () => Effect.void,
          flush: () => Effect.void,
        }),
      )

      const prompt = yield* SessionPrompt.Service
      const session = yield* Session.Service
      const chat = yield* session.create({ title: "cleanup prompt" })

      yield* prompt
        .prompt({
          sessionID: chat.id,
          parts: [{ type: "text", text: "继续" }],
          model: ref,
          agent: "build",
        })
        .pipe(Effect.provide(scheduler))

      expect(marked.length).toBeGreaterThan(0)
    }),
  ),
)

it.live("summary always computes diff without skip-summary-diff env path", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const summary = yield* SessionSummary.Service
        const session = yield* Session.Service
        const chat = yield* session.create({ title: "cleanup summary" })
        const user = yield* seedConversation(chat.id, dir)

        yield* summary.summarize({ sessionID: chat.id, messageID: user.id })

        expect(yield* summary.diff({ sessionID: chat.id })).toEqual(fileDiffs)
      }),
    { git: true },
  ),
)
```

- [ ] **Step 2: 运行最小测试，确认当前会因残留 debug 逻辑或断言失效而失败**

Run:

`bun run --cwd packages/opencode test --test-name-pattern "always marks dirty without debug env branches|always computes diff without skip-summary-diff env path" test/session/prompt.test.ts test/session/summary.test.ts`

Expected: FAIL，至少一条失败，表明测试仍依赖 debug env/trace 或生产代码仍保留相关分支。

- [ ] **Step 3: 删除 `prompt.ts` / `processor.ts` / `summary.ts` 的 debug 分支，但保留正式路径**

```ts
// prompt.ts
- const trace = getDebugSessionTrace(ctx.directory)
- const disableSummary = process.env.OPENCODE_DEBUG_DISABLE_SUMMARY === "1" && trace.shouldTrace({ sessionID })
if (step === 1) {
-  if (disableSummary) {
-    yield* Effect.sync(() => {
-      void trace.event({ tag: "summary.skipped", sessionID, meta: { reason: "disabled-in-prompt", step } })
-    })
-  } else {
-    yield* summaryScheduler.markDirty({ sessionID, messageID: lastUser.id, version: Date.now() })
-  }
+  yield* summaryScheduler.markDirty({ sessionID, messageID: lastUser.id, version: Date.now() })
}

// processor.ts
- if (disableSummary) {
-   yield* Effect.sync(() => {
-     void trace.event({ tag: "summary.skipped", sessionID: ctx.sessionID, meta: { reason: "disabled-in-processor", messageID: ctx.assistantMessage.parentID } })
-   })
- } else {
-   yield* summaryScheduler.markDirty({ sessionID: ctx.sessionID, messageID: ctx.assistantMessage.parentID, version: Date.now() })
- }
+ yield* summaryScheduler.markDirty({ sessionID: ctx.sessionID, messageID: ctx.assistantMessage.parentID, version: Date.now() })

// summary.ts
- const trace = getDebugSessionTrace(instance.directory)
- const skipSummaryDiff = process.env.OPENCODE_DEBUG_SKIP_SUMMARY_DIFF === "1" && trace.shouldTrace({ sessionID: input.sessionID })
- const diffs = skipSummaryDiff ? [] : yield* computeDiff({ messages: all })
- if (skipSummaryDiff) { ...summary.diff.skipped... }
+ const diffs = yield* computeDiff({ messages: all })
```

- [ ] **Step 4: 删除仅服务 trace 的 helper 引用与事件写入**

```ts
// llm.ts / bus/index.ts / acp/agent.ts / session.ts / routes/trace.ts / httpapi/session.ts
- import { getDebugSessionTrace } from "@/util/debug-session-trace"
- void trace.event({ tag: "http.request.start", ... })
- void trace.event({ tag: "http.request.finish", ... })
- void trace.count({ sessionID, bucket: "event.window", ... })
```

- [ ] **Step 5: 删除 helper 文件**

```diff
*** Delete File: packages/opencode/src/util/debug-session-trace.ts
```

- [ ] **Step 6: 运行后端类型检查与核心回归**

Run:

`bun run --cwd packages/opencode typecheck`

`bun run --cwd packages/opencode test test/session/summary-scheduler.test.ts test/session/summary.test.ts`

Expected: 两条命令都通过，且没有 `debug-session-trace` / `OPENCODE_DEBUG_*` 相关编译错误。

- [ ] **Step 7: Commit**

```bash
git add packages/opencode/src/session/prompt.ts packages/opencode/src/session/processor.ts packages/opencode/src/session/summary.ts packages/opencode/src/session/session.ts packages/opencode/src/session/llm.ts packages/opencode/src/bus/index.ts packages/opencode/src/acp/agent.ts packages/opencode/src/server/routes/instance/trace.ts packages/opencode/src/server/routes/instance/httpapi/session.ts packages/opencode/src/util/debug-session-trace.ts
git commit -m "refactor: remove debug trace runtime branches"
```

### Task 2: 删除 debug-only 测试并补齐正式回归断言

**Files:**

- Modify: `packages/opencode/test/session/prompt.test.ts`
- Modify: `packages/opencode/test/session/processor-effect.test.ts`
- Modify: `packages/opencode/test/session/summary.test.ts`
- Modify: `packages/opencode/test/server/httpapi-session.test.ts`
- Delete: `packages/opencode/test/util/debug-session-trace.test.ts`

- [ ] **Step 1: 先把正式测试写成不依赖 debug env/trace 的形式**

```ts
// prompt.test.ts
it.live("step 1 marks dirty and never falls back to direct summarize", () =>
  provideTmpdirServer(({ url }) =>
    Effect.gen(function* () {
      const marks: Array<{ source: "prompt" | "processor"; sessionID: SessionID; messageID: MessageID }> = []
      const summarizeCalls: Array<{ sessionID: SessionID; messageID: MessageID }> = []

      yield* withSummary(
        {
          summarize: (input) => Effect.sync(() => void summarizeCalls.push(input)),
        },
        runPromptWithSchedulerRecording({
          onMarkDirty: (source, input) => {
            marks.push({ source, sessionID: input.sessionID, messageID: input.messageID })
          },
        }),
      )

      expect(marks.map((item) => item.source)).toEqual(["prompt", "processor"])
      expect(summarizeCalls).toEqual([])
    }),
  ),
)

// summary.test.ts
it.live("scheduler markDirty auto-runs real summarize and writes summary plus diff", () =>
  provideTmpdirInstance(
    (dir) =>
      Effect.gen(function* () {
        const session = yield* Session.Service
        const scheduler = yield* SessionSummaryScheduler.Service
        const summary = yield* SessionSummary.Service
        const chat = yield* session.create({ title: "real auto summarize" })
        const user = yield* seedConversation(chat.id, dir)

        yield* scheduler.syncVisible([chat.id])
        yield* scheduler.markDirty({ sessionID: chat.id, messageID: user.id, version: Date.now() })
        yield* waitForSummary(chat.id)

        expect((yield* session.get(chat.id)).summary).toEqual(expect.objectContaining({ files: 1 }))
        expect(yield* summary.diff({ sessionID: chat.id })).toEqual(fileDiffs)
      }),
    { git: true },
  ),
)
```

- [ ] **Step 2: 运行这些正式测试，确认当前仍受 debug-only case 影响**

Run:

`bun run --cwd packages/opencode test test/session/prompt.test.ts test/session/processor-effect.test.ts test/session/summary.test.ts --test-name-pattern "marks dirty|real summarize"`

Expected: FAIL 或因旧 debug-only 夹具残留导致需要清理。

- [ ] **Step 3: 删除 debug-only case 与 helper 测试文件**

```diff
// prompt.test.ts / processor-effect.test.ts / summary.test.ts / httpapi-session.test.ts
- import { TARGET_DEBUG_SESSION_ENV, getDebugSessionTrace } from ".../debug-session-trace"
- withEnv("OPENCODE_DEBUG_DISABLE_SUMMARY", ...)
- withEnv("OPENCODE_DEBUG_SKIP_SUMMARY_DIFF", ...)
- expect(rows).toContainEqual(expect.objectContaining({ tag: "summary.skipped" }))
- expect(rows).toContainEqual(expect.objectContaining({ tag: "summary.diff.skipped" }))

*** Delete File: packages/opencode/test/util/debug-session-trace.test.ts
```

- [ ] **Step 4: 只保留正式接口测试，不再检查 debug file / forced trace**

```ts
// httpapi-session.test.ts
test("updates visible sessions through visibility endpoint", async () => {
  await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
  const headers = { "x-opencode-directory": tmp.path, "content-type": "application/json" }

  const response = await app().request(SessionPaths.visibility, {
    method: "PUT",
    headers,
    body: JSON.stringify({ sessionIDs: ["ses_visible_a", "ses_visible_b"] }),
  })

  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ sessionIDs: ["ses_visible_a", "ses_visible_b"] })
})
```

- [ ] **Step 5: 运行后端正式回归**

Run:

`bun run --cwd packages/opencode test test/session/summary-scheduler.test.ts test/session/summary.test.ts test/server/httpapi-session.test.ts`

`bun run --cwd packages/opencode test --test-name-pattern "marking dirty|visibility endpoint" test/session/prompt.test.ts test/session/processor-effect.test.ts test/server/httpapi-session.test.ts`

Expected: 全部通过，且不再出现 `summary.skipped` / `summary.diff.skipped` 相关测试。

- [ ] **Step 6: Commit**

```bash
git add packages/opencode/test/session/prompt.test.ts packages/opencode/test/session/processor-effect.test.ts packages/opencode/test/session/summary.test.ts packages/opencode/test/server/httpapi-session.test.ts packages/opencode/test/util/debug-session-trace.test.ts
git commit -m "test: remove debug-only summary trace coverage"
```

### Task 3: 删除调试产物并做最终验证

**Files:**

- Delete local artifact: `.opencode-debug/`

- [ ] **Step 1: grep 仓库确认无 debug 残留**

Run:

`rg "OPENCODE_DEBUG_DISABLE_SUMMARY|OPENCODE_DEBUG_SKIP_SUMMARY_DIFF|OPENCODE_DEBUG_SESSION_TRACE|TARGET_DEBUG_SESSION_ENV|debug-session-trace|summary\.skipped|summary\.diff\.skipped" packages/opencode/src packages/opencode/test packages/opencode/webgui/src`

Expected: 无结果。

- [ ] **Step 2: 删除本地调试产物目录**

Run: `Remove-Item -Recurse -Force ".opencode-debug"`

Expected: 目录被删除；如果不存在，PowerShell 提示 not found 也可接受，但不要删除别的目录。

- [ ] **Step 3: 跑 WebGUI 正式回归**

Run:

`bun run --cwd packages/opencode/webgui test:run src/hooks/useSessionVisibilitySync.test.tsx src/components/FileChangesPanel.test.tsx src/components/MessageInput/FooterPanels.test.tsx src/state/SessionContext.test.tsx`

Expected: 46 pass, 0 fail（或同等 0 fail 结果）。

- [ ] **Step 4: 跑最终类型检查与构建验证**

Run:

`bun run --cwd packages/opencode typecheck`

`bun run --cwd packages/opencode/webgui build`

Expected: 两条命令都 exit 0。

- [ ] **Step 5: 跑最小 smoke 验证正式链路**

```text
1. 启动源码 server（任选空闲端口，例如 43117）。
2. 访问 `/session/visibility`，确认返回 200 JSON。
3. 打开 `/app` 页面。
4. 用 mock SSE 或真实事件验证 Diff 面板仍能显示：
   - updating
   - latest
   - failed
5. 确认不再依赖任何 debug env / debug trace helper。
```

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "refactor: remove temporary debug summary tracing"
```

## 自检

- Spec coverage：计划覆盖了运行时代码清理、测试清理、产物清理、grep 验证、后端回归、前端回归、构建验证和最小 smoke。
- Placeholder scan：无 `TODO` / `TBD` / “后续补” 占位词。
- Type consistency：计划统一使用 `SessionSummaryScheduler`、`markDirty`、`canWrite`、`session.diff.status`、`sessionDiffStatus`、`/session/visibility` 这些正式命名。
